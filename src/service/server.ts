import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"
import { SqlClient } from "effect/unstable/sql/SqlClient"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { GitHubBindingCreateRequest, GitHubBindingSummary, GitHubTriggerResponse } from "../domain/github.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { ProjectSummary } from "../domain/project.ts"
import { WorkflowRunState, type WorkflowRunStatus } from "../domain/runtime-state.ts"
import { SecretSummary } from "../domain/secrets.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"
import { Engine } from "../engine/interface.ts"
import { RunController } from "../engine/run-controller.ts"
import { RunUpdate } from "../engine/run-updates.ts"
import { GitHubApiClient } from "../github/api-client.ts"
import { GitHubAppAuth } from "../github/app-auth.ts"
import { GitHubCheckRuns } from "../github/check-runs.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { GitHubBindingStore } from "../github/binding-store.ts"
import { GitHubIntegration } from "../github/integration.ts"
import { GitHubRunLinkStore } from "../github/run-link-store.ts"
import { GitHubSourceSnapshots } from "../github/source-snapshots.ts"
import { GitHubTriggerDeliveryStore } from "../github/trigger-delivery-store.ts"
import { EngineServiceConfig, GitHubAppConfig, GitHubTriggerConfig, StorageRuntimeConfig } from "../runtime/config.ts"
import { logInfo } from "../runtime/logger.ts"
import { Metrics } from "../runtime/metrics.ts"
import { makeServiceEngineLayer } from "../runtime/layers.ts"
import { ObjectStorageClient, sqlClientLayer } from "../runtime/storage.ts"
import { appVersion } from "../runtime/version.ts"
import { SecretStore } from "../secrets/store.ts"
import { ArtifactGc } from "../engine/stores/artifact-gc.ts"
import { ArtifactStore } from "../engine/stores/artifact-store.ts"
import { RunActionRequest, RunSubmissionRequest, SecretSetRequest, ServiceErrorResponse, WorkflowRunSubmissionRequest } from "./contracts.ts"
import { decodeJson, encodeJson } from "./schema-json.ts"

type EngineService = typeof Engine.Service

class RequestBodyInvalid extends Schema.TaggedErrorClass<RequestBodyInvalid>()("RequestBodyInvalid", {
  message: Schema.String,
}) {}

export const makeServiceLayer = () =>
  {
    const engineLayer = makeServiceEngineLayer()
    const bindingStoreLayer = GitHubBindingStore.postgresLayer.pipe(Layer.provideMerge(sqlClientLayer))
    const runLinkStoreLayer = GitHubRunLinkStore.postgresLayer.pipe(Layer.provideMerge(sqlClientLayer))
    const triggerDeliveryLayer = GitHubTriggerDeliveryStore.postgresLayer.pipe(Layer.provideMerge(sqlClientLayer))
    const gitHubConfigLayer = GitHubAppConfig.layer
    const gitHubAuthLayer = GitHubAppAuth.layer.pipe(Layer.provideMerge(gitHubConfigLayer))
    const gitHubApiLayer = GitHubApiClient.layer.pipe(
      Layer.provideMerge(gitHubConfigLayer),
      Layer.provideMerge(gitHubAuthLayer),
    )
    const triggerConfigLayer = GitHubTriggerConfig.layer
    const snapshotLayer = GitHubSourceSnapshots.layer.pipe(
      Layer.provideMerge(triggerConfigLayer),
      Layer.provideMerge(gitHubApiLayer),
    )
    const gitHubChecksLayer = GitHubCheckRuns.layer.pipe(
      Layer.provideMerge(engineLayer),
      Layer.provideMerge(runLinkStoreLayer),
      Layer.provideMerge(gitHubApiLayer),
      Layer.provideMerge(gitHubConfigLayer),
    )
    const gitHubLayer = GitHubIntegration.layer.pipe(
      Layer.provideMerge(engineLayer),
      Layer.provideMerge(bindingStoreLayer),
      Layer.provideMerge(gitHubApiLayer),
      Layer.provideMerge(gitHubChecksLayer),
      Layer.provideMerge(runLinkStoreLayer),
      Layer.provideMerge(triggerDeliveryLayer),
      Layer.provideMerge(snapshotLayer),
      Layer.provideMerge(DslMaterializer.layer),
      Layer.provideMerge(WorkflowModuleLoader.layer),
      Layer.provideMerge(gitHubConfigLayer),
    )

    return Layer.mergeAll(
      engineLayer,
      bindingStoreLayer,
      runLinkStoreLayer,
      triggerDeliveryLayer,
      gitHubConfigLayer,
      gitHubAuthLayer,
      gitHubApiLayer,
      triggerConfigLayer,
      snapshotLayer,
      gitHubChecksLayer,
      DslMaterializer.layer,
      WorkflowModuleLoader.layer,
      gitHubLayer,
      StorageRuntimeConfig.layer,
      EngineServiceConfig.layer,
    )
  }

export const startServiceServer = Effect.gen(function* () {
  const runtimeConfig = yield* StorageRuntimeConfig
  const serviceConfig = yield* EngineServiceConfig
  const engine = yield* Engine
  const runController = yield* RunController
  const gitHubChecks = yield* Effect.serviceOption(GitHubCheckRuns)
  const gitHubIntegration = yield* GitHubIntegration
  const secretStore = yield* SecretStore
  const artifactStore = yield* ArtifactStore
  const sql = yield* Effect.serviceOption(SqlClient)
  const objectStorage = yield* Effect.serviceOption(ObjectStorageClient)
  const metrics = yield* Effect.serviceOption(Metrics)
  const artifactGc = yield* Effect.serviceOption(ArtifactGc)

  if (runtimeConfig.runRecoveryOnStartup) {
    yield* runController.recoverOnStartup()
  }

  yield* Option.match(gitHubChecks, {
    onNone: () => Effect.void,
    onSome: (service) => service.watchRunUpdates.pipe(Effect.forkDetach({ startImmediately: true }), Effect.asVoid),
  })

  yield* Option.match(artifactGc, {
    onNone: () => Effect.succeed(undefined),
    onSome: (service) => service.start(),
  })

  const pendingGitHubWebhooks = new Array<{
    readonly event: string | null
    readonly signature: string | null
    readonly deliveryId: string | null
    readonly rawBody: string
  }>()
  let processingGitHubWebhooks = false

  const drainGitHubWebhooks = async () => {
    if (processingGitHubWebhooks) {
      return
    }

    processingGitHubWebhooks = true

    try {
      while (pendingGitHubWebhooks.length > 0) {
        const next = pendingGitHubWebhooks.shift()!
        try {
          await Effect.runPromise(
            gitHubIntegration.handleWebhook(next).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            ),
          )
        } catch {
          continue
        }
      }
    } finally {
      processingGitHubWebhooks = false

      if (pendingGitHubWebhooks.length > 0) {
        queueMicrotask(() => {
          void drainGitHubWebhooks()
        })
      }
    }
  }

  const enqueueGitHubWebhook = (request: {
    readonly event: string | null
    readonly signature: string | null
    readonly deliveryId: string | null
    readonly rawBody: string
  }) => {
    pendingGitHubWebhooks.push(request)
    queueMicrotask(() => {
      void drainGitHubWebhooks()
    })
  }

  const server = Bun.serve({
    port: serviceConfig.port,
    routes: {
      "/healthz": {
        GET: () => new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } }),
      },
      "/readyz": {
        GET: () => runReadinessEffect(readiness(sql, objectStorage)),
      },
      "/metrics": {
        GET: () =>
          new Response(Option.match(metrics, { onNone: () => "", onSome: (service) => service.renderPrometheus() }), {
            headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
          }),
      },
      "/version": {
        GET: () => new Response(appVersion, { headers: { "content-type": "text/plain; charset=utf-8" } }),
      },
      "/api/workflows/validate": {
        POST: (request) => runJsonEffect(validateWorkflow(engine, request), { noContent: true }),
      },
      "/api/workflows/plan": {
        POST: (request) => runJsonEffect(planWorkflow(engine, request), { schema: ExecutionPlan }),
      },
      "/api/workflows/runs": {
        POST: (request) => runJsonEffect(submitWorkflowRun(engine, request), { schema: WorkflowRunState }),
      },
      "/api/runs": {
        GET: (request) => runJsonEffect(listRuns(engine, request), { schema: Schema.Array(WorkflowRunState) }),
        POST: (request) => runJsonEffect(submitRun(engine, request), { schema: WorkflowRunState }),
      },
      "/api/projects": {
        GET: () => runJsonEffect(gitHubIntegration.listProjects(), { schema: Schema.Array(ProjectSummary) }),
      },
      "/api/secrets": {
        GET: (request) => runJsonEffect(listSecrets(secretStore, request), { schema: Schema.Array(SecretSummary) }),
        POST: (request) => runJsonEffect(setSecret(secretStore, request), { noContent: true, status: 201 }),
      },
      "/api/secrets/:projectId/:key": {
        DELETE: (request) =>
          runJsonEffect(secretStore.deleteSecret(request.params.projectId, request.params.key), { noContent: true }),
      },
      "/api/bindings": {
        GET: () => runJsonEffect(gitHubIntegration.listBindings(), { schema: Schema.Array(GitHubBindingSummary) }),
      },
      "/api/bindings/github": {
        POST: (request) => runJsonEffect(createGitHubBinding(gitHubIntegration, request), { schema: GitHubBindingSummary, status: 201 }),
      },
      "/api/github/webhooks": {
        POST: (request) =>
          runJsonEffect(handleGitHubWebhook(gitHubIntegration, request, enqueueGitHubWebhook), { schema: GitHubTriggerResponse, status: 202 }),
      },
      "/api/triggers/github": {
        POST: (request) =>
          runJsonEffect(handleGitHubWebhook(gitHubIntegration, request, enqueueGitHubWebhook), { schema: GitHubTriggerResponse, status: 202 }),
      },
      "/api/runs/stream": {
        GET: () => runStreamEffect(engine.streamRuns()),
      },
      "/api/runs/:runId": {
        GET: (request) => runJsonEffect(engine.inspectRun(RunId.make(request.params.runId)), { schema: WorkflowRunState }),
      },
      "/api/runs/:runId/stream": {
        GET: (request) => runStreamEffect(runScopedStream(engine, RunId.make(request.params.runId))),
      },
      "/api/runs/:runId/events": {
        GET: (request) =>
          runJsonEffect(engine.readRunEvents(RunId.make(request.params.runId)), { schema: Schema.Array(WorkflowEvent) }),
      },
      "/api/runs/:runId/logs": {
        GET: (request) =>
          runJsonEffect(engine.readLogs(RunId.make(request.params.runId)), { schema: Schema.Array(LogMetadata) }),
      },
      "/api/logs/:logRef": {
        GET: (request) => runTextEffect(engine.readLogPayload(LogRef.make(request.params.logRef))),
        DELETE: (request) => runJsonEffect(engine.deleteLog(LogRef.make(request.params.logRef)), { noContent: true }),
      },
      "/api/runs/:runId/artifacts": {
        GET: (request) =>
          runJsonEffect(engine.readArtifacts(RunId.make(request.params.runId)), { schema: Schema.Array(ArtifactMetadata) }),
      },
      "/api/artifacts/:artifactRef": {
        GET: (request) => runArtifactEffect(artifactStore.readArtifactContent(ArtifactRef.make(request.params.artifactRef))),
        DELETE: (request) => runJsonEffect(engine.deleteArtifact(ArtifactRef.make(request.params.artifactRef)), { noContent: true }),
      },
      "/api/runs/:runId/gc": {
        POST: (request) =>
          runJsonEffect(engine.gcRunArtifacts(RunId.make(request.params.runId)), {
            schema: Schema.Struct({ deletedCount: Schema.Number, bytesFreed: Schema.Number }),
          }),
      },
      "/api/runs/:runId/cancel": {
        POST: (request) => runJsonEffect(cancelRun(engine, request, RunId.make(request.params.runId)), { schema: WorkflowRunState }),
      },
      "/api/runs/:runId/retry": {
        POST: (request) => runJsonEffect(retryRun(engine, request, RunId.make(request.params.runId)), { schema: WorkflowRunState }),
      },
    },
    fetch() {
      return new Response("Not Found", { status: 404 })
    },
  })

  const shutdown = async (signal: string) => {
    await Effect.runPromise(logInfo("shutdown requested", { module: "service", signal }))
    const timedOut = setTimeout(() => process.exit(1), 30_000)
    try {
      server.stop(true)
      await Effect.runPromise(logInfo("server stopped", { module: "service" }))
      clearTimeout(timedOut)
      process.exit(0)
    } catch {
      clearTimeout(timedOut)
      process.exit(1)
    }
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.once("SIGINT", () => void shutdown("SIGINT"))

  yield* logInfo("engine service listening", { module: "service", version: appVersion, url: String(server.url) })
  return server
})

export const serviceProgram = Effect.gen(function* () {
  yield* startServiceServer
  return yield* Effect.never
})

const readiness = (sql: Option.Option<any>, objectStorage: Option.Option<any>) =>
  Effect.gen(function* () {
    const checks: Record<string, string> = {}

    yield* Option.match(sql, {
      onNone: () => Effect.sync(() => {
        checks.postgres = "unavailable"
      }),
      onSome: (client) => client`SELECT 1`.pipe(Effect.tap(() => Effect.sync(() => {
        checks.postgres = "ok"
      }))),
    })
    yield* Option.match(objectStorage, {
      onNone: () => Effect.sync(() => {
        checks.s3 = "unavailable"
      }),
      onSome: (client) => client.checkHealth().pipe(Effect.tap(() => Effect.sync(() => {
        checks.s3 = "ok"
      }))),
    })

    const status = Object.values(checks).every((value) => value === "ok") ? "ok" : "unavailable"
    return { status, checks }
  }).pipe(
    Effect.catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return Effect.fail(
        new ServiceUnavailable({
          message,
        }),
      )
    }),
  )

class ServiceUnavailable extends Schema.TaggedErrorClass<ServiceUnavailable>()("ServiceUnavailable", {
  message: Schema.String,
}) {}

const validateWorkflow = (engine: EngineService, request: Request) =>
  Effect.gen(function* () {
    const definition = yield* parseRequestBody(request, NormalizedWorkflowDefinition)
    yield* engine.validate(definition)
  })

const planWorkflow = (engine: EngineService, request: Request) =>
  Effect.gen(function* () {
    const definition = yield* parseRequestBody(request, NormalizedWorkflowDefinition)
    return yield* engine.plan(definition)
  })

const submitRun = (engine: EngineService, request: Request) =>
  Effect.gen(function* () {
    const submission = yield* parseRequestBody(request, RunSubmissionRequest)
    return yield* engine.submitRun(
      submission.plan,
      submission.options === undefined
        ? undefined
        : {
            ...(submission.options.workspacePath === undefined ? {} : { workspacePath: submission.options.workspacePath }),
            ...(submission.options.inputValues === undefined ? {} : { inputValues: submission.options.inputValues }),
          },
    )
  })

const submitWorkflowRun = (engine: EngineService, request: Request) =>
  Effect.gen(function* () {
    const submission = yield* parseRequestBody(request, WorkflowRunSubmissionRequest)
    return yield* engine.submitDefinition(
      submission.definition,
      submission.options === undefined
        ? undefined
        : {
            ...(submission.options.workspacePath === undefined ? {} : { workspacePath: submission.options.workspacePath }),
            ...(submission.options.inputValues === undefined ? {} : { inputValues: submission.options.inputValues }),
          },
    )
  })

const listRuns = (engine: EngineService, request: Request) =>
  Effect.gen(function* () {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim()
    return yield* engine.listRuns(projectId === undefined || projectId.length === 0 ? undefined : projectId)
  })

const setSecret = (secretStore: typeof SecretStore.Service, request: Request) =>
  Effect.gen(function* () {
    const payload = yield* parseRequestBody(request, SecretSetRequest)
    yield* secretStore.setSecret(payload.projectId, payload.key, payload.value)
  })

const listSecrets = (secretStore: typeof SecretStore.Service, request: Request) =>
  Effect.gen(function* () {
    const projectId = new URL(request.url).searchParams.get("projectId")
    if (projectId === null || projectId.trim().length === 0) {
      return yield* new RequestBodyInvalid({ message: "projectId query parameter is required" })
    }

    return yield* secretStore.listSecrets(projectId)
  })

const createGitHubBinding = (gitHubIntegration: typeof GitHubIntegration.Service, request: Request) =>
  Effect.gen(function* () {
    const binding = yield* parseRequestBody(request, GitHubBindingCreateRequest)
    return yield* gitHubIntegration.addBinding(binding)
  })

const handleGitHubWebhook = (
  gitHubIntegration: typeof GitHubIntegration.Service,
  request: Request,
  enqueueGitHubWebhook: (request: {
    readonly event: string | null
    readonly signature: string | null
    readonly deliveryId: string | null
    readonly rawBody: string
  }) => void,
) =>
  Effect.gen(function* () {
    const rawBody = yield* readRequestText(request)
    const triggerRequest = {
      event: request.headers.get("x-github-event"),
      signature: request.headers.get("x-hub-signature-256"),
      deliveryId: request.headers.get("x-github-delivery"),
      rawBody,
    }

    const accepted = yield* gitHubIntegration.acceptWebhook(triggerRequest)

    yield* Effect.sync(() => {
      enqueueGitHubWebhook(triggerRequest)
    })

    return accepted
  })

const cancelRun = (engine: EngineService, request: Request, runId: RunId) =>
  Effect.gen(function* () {
    const reason = yield* parseOptionalReason(request, runId)
    return yield* engine.cancelRun(runId, reason)
  })

const retryRun = (engine: EngineService, request: Request, runId: RunId) =>
  Effect.gen(function* () {
    const reason = yield* parseOptionalReason(request, runId)
    return yield* engine.retryRun(runId, reason)
  })

const parseRequestBody = <A, I, RD, RE>(request: Request, schema: Schema.Codec<A, I, RD, RE>) =>
  readRequestText(request).pipe(Effect.flatMap((text) => decodeJsonText(text, schema)))

const readRequestText = (request: Request) =>
  Effect.tryPromise({
    try: () => request.text(),
    catch: (error) => new RequestBodyInvalid({ message: error instanceof Error ? error.message : String(error) }),
  })

const decodeJsonText = <A, I, RD, RE>(text: string, schema: Schema.Codec<A, I, RD, RE>) =>
  Effect.try({
    try: () => decodeJson(schema, JSON.parse(text)),
    catch: (error) => new RequestBodyInvalid({ message: error instanceof Error ? error.message : String(error) }),
  })

const parseOptionalReason = (request: Request, runId: RunId) =>
  Effect.tryPromise({
    try: async () => {
      if (request.headers.get("content-length") === "0") {
        return undefined
      }

      const text = await request.text()
      if (text.trim().length === 0) {
        return undefined
      }

      return decodeJson(RunActionRequest, JSON.parse(text)).reason
    },
    catch: () => undefined,
  }).pipe(Effect.map((reason) => reason ?? `Request applied to ${runId}`))

const runScopedStream = (engine: EngineService, runId: RunId) =>
  Stream.unwrap(
    engine.inspectRun(runId).pipe(
      Effect.map((run) =>
        Stream.make(
          new RunUpdate({
            runId: run.runId,
            status: run.status,
            updatedAt: run.updatedAt,
            terminal: isTerminalRun(run.status),
            eventType: "snapshot",
          }),
        ).pipe(Stream.concat(engine.streamRun(runId))),
      ),
    ),
  )

const runJsonEffect = async <A, I, RD, RE>(
  effect: Effect.Effect<A, any, any>,
  options: { readonly schema?: Schema.Codec<A, I, RD, RE>; readonly noContent?: boolean; readonly status?: number },
) => {
  try {
    const value = await Effect.runPromise(effect as Effect.Effect<A, any, never>)

    if (options.noContent) {
      return new Response(null, { status: options.status ?? 204 })
    }

    if (options.schema === undefined) {
      return Response.json(value, { status: options.status ?? 200 })
    }

    try {
      return Response.json(encodeJson(options.schema, value), { status: options.status ?? 200 })
    } catch {
      // Some persisted runtime objects still serialize more faithfully through the native JSON path
      // than through Schema.toCodecJson, especially around optional nested fields.
      return Response.json(value, { status: options.status ?? 200 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}

const runTextEffect = async (effect: Effect.Effect<string, any, any>) => {
  try {
    const value = await Effect.runPromise(effect as Effect.Effect<string, any, never>)
    return new Response(value, { headers: { "content-type": "text/plain; charset=utf-8" } })
  } catch (error) {
    return errorResponse(error)
  }
}

const runArtifactEffect = async (
  effect: Effect.Effect<{ readonly metadata: ArtifactMetadata; readonly payload: Uint8Array; readonly contentType?: string }, any, any>,
) => {
  try {
    const { metadata, payload, contentType } = await Effect.runPromise(effect as Effect.Effect<any, any, never>)
    return new Response(payload, {
      headers: {
        "content-type": contentType ?? "application/octet-stream",
        ...(metadata.name.length === 0 ? {} : { "content-disposition": `inline; filename="${metadata.name}"` }),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

const runReadinessEffect = async (effect: Effect.Effect<{ readonly status: string; readonly checks: Record<string, string> }, any, any>) => {
  try {
    const value = await Effect.runPromise(effect as Effect.Effect<any, any, never>)
    return Response.json(value, { status: value.status === "ok" ? 200 : 503 })
  } catch (error) {
    return errorResponse(error)
  }
}

const runStreamEffect = async (stream: Stream.Stream<RunUpdate, any, any>) => {
  try {
    const readable = Stream.toReadableStream(
      stream.pipe(
        Stream.map((update) =>
          Sse.encoder.write({
            _tag: "Event",
            event: "run-update",
            id: undefined,
            data: JSON.stringify(encodeJson(RunUpdate, update)),
          }),
        ),
      ) as Stream.Stream<string, never, never>,
    )

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

const errorResponse = (error: unknown) => {
  if (isDomainError(error)) {
    return Response.json(encodeJson(DomainError, error), { status: statusForError(error) })
  }

  if (error instanceof RequestBodyInvalid) {
    return Response.json(
      encodeJson(
        ServiceErrorResponse,
        new ServiceErrorResponse({
          error: error.message,
          tag: error._tag,
        }),
      ),
      { status: 400 },
    )
  }

  if (error instanceof ServiceUnavailable) {
    return Response.json(
      encodeJson(
        ServiceErrorResponse,
        new ServiceErrorResponse({
          error: error.message,
          tag: error._tag,
        }),
      ),
      { status: 503 },
    )
  }

  return Response.json(
    encodeJson(
      ServiceErrorResponse,
      new ServiceErrorResponse({
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    { status: 500 },
  )
}

const statusForError = (error: DomainError) => {
  switch (error._tag) {
    case "RunNotFound":
      return 404
    case "WorkflowDefinitionInvalid":
    case "PlanningFailed":
    case "RunControlRejected":
    case "WorkflowInputsInvalid":
      return 400
    case "StoreUnavailable":
    case "EngineUnavailable":
      return 503
    case "GitHubWebhookUnauthorized":
      return 401
    case "GitHubBindingRejected":
      return 400
    case "GitHubConfigMissing":
      return 503
    case "GitHubAuthFailed":
      return 502
    case "GitHubApiFailed":
      return 502
    default:
      return 500
  }
}

const isDomainError = (error: unknown): error is DomainError =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

const isTerminalRun = (status: WorkflowRunStatus) =>
  status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted"
