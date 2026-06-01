import { Console, Effect, Layer, Option, Schema, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { GitHubBindingCreateRequest, GitHubBindingSummary, GitHubTriggerResponse } from "../domain/github.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { WorkflowRunState, type WorkflowRunStatus } from "../domain/runtime-state.ts"
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
import { EngineServiceConfig, GitHubAppConfig, GitHubTriggerConfig, StorageRuntimeConfig } from "../runtime/config.ts"
import { makeServiceEngineLayer } from "../runtime/layers.ts"
import { sqlClientLayer } from "../runtime/storage.ts"
import { RunActionRequest, RunSubmissionRequest, ServiceErrorResponse } from "./contracts.ts"
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
      Layer.provideMerge(snapshotLayer),
      Layer.provideMerge(DslMaterializer.layer),
      Layer.provideMerge(WorkflowModuleLoader.layer),
      Layer.provideMerge(gitHubConfigLayer),
    )

    return Layer.mergeAll(
      engineLayer,
      bindingStoreLayer,
      runLinkStoreLayer,
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

  if (runtimeConfig.runRecoveryOnStartup) {
    yield* runController.recoverOnStartup()
  }

  yield* Option.match(gitHubChecks, {
    onNone: () => Effect.void,
    onSome: (service) => service.watchRunUpdates.pipe(Effect.forkDetach({ startImmediately: true }), Effect.asVoid),
  })

  const server = Bun.serve({
    port: serviceConfig.port,
    routes: {
      "/healthz": {
        GET: () => new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } }),
      },
      "/api/workflows/validate": {
        POST: (request) => runJsonEffect(validateWorkflow(engine, request), { noContent: true }),
      },
      "/api/workflows/plan": {
        POST: (request) => runJsonEffect(planWorkflow(engine, request), { schema: ExecutionPlan }),
      },
      "/api/runs": {
        GET: () => runJsonEffect(engine.listRuns(), { schema: Schema.Array(WorkflowRunState) }),
        POST: (request) => runJsonEffect(submitRun(engine, request), { schema: WorkflowRunState }),
      },
      "/api/bindings": {
        GET: () => runJsonEffect(gitHubIntegration.listBindings(), { schema: Schema.Array(GitHubBindingSummary) }),
      },
      "/api/bindings/github": {
        POST: (request) => runJsonEffect(createGitHubBinding(gitHubIntegration, request), { schema: GitHubBindingSummary, status: 201 }),
      },
      "/api/github/webhooks": {
        POST: (request) => runJsonEffect(handleGitHubWebhook(gitHubIntegration, request), { schema: GitHubTriggerResponse, status: 202 }),
      },
      "/api/triggers/github": {
        POST: (request) => runJsonEffect(handleGitHubWebhook(gitHubIntegration, request), { schema: GitHubTriggerResponse, status: 202 }),
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
      },
      "/api/runs/:runId/artifacts": {
        GET: (request) =>
          runJsonEffect(engine.readArtifacts(RunId.make(request.params.runId)), { schema: Schema.Array(ArtifactMetadata) }),
      },
      "/api/artifacts/:artifactRef": {
        GET: (request) => runTextEffect(engine.readArtifactPayload(ArtifactRef.make(request.params.artifactRef))),
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

  yield* Console.log(`engine service listening on ${server.url}`)
  return server
})

export const serviceProgram = Effect.gen(function* () {
  yield* startServiceServer
  return yield* Effect.never
})

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
      submission.options?.workspacePath === undefined
        ? undefined
        : { workspacePath: submission.options.workspacePath },
    )
  })

const createGitHubBinding = (gitHubIntegration: typeof GitHubIntegration.Service, request: Request) =>
  Effect.gen(function* () {
    const binding = yield* parseRequestBody(request, GitHubBindingCreateRequest)
    return yield* gitHubIntegration.addBinding(binding)
  })

const handleGitHubWebhook = (gitHubIntegration: typeof GitHubIntegration.Service, request: Request) =>
  Effect.gen(function* () {
    const rawBody = yield* readRequestText(request)

    return yield* gitHubIntegration.handleWebhook({
      event: request.headers.get("x-github-event"),
      signature: request.headers.get("x-hub-signature-256"),
      deliveryId: request.headers.get("x-github-delivery"),
      rawBody,
    })
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
      return new Response(null, { status: 204 })
    }

    return Response.json(encodeJson(options.schema!, value), { status: options.status ?? 200 })
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
