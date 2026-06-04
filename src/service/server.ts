import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path"

import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError, ProjectNotFound, ProjectOperationRejected, StoreUnavailable } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { GitHubBindingCreateRequest, GitHubBindingSummary, GitHubInstallationRepository, GitHubTriggerResponse } from "../domain/github.ts"
import { ArtifactRef, LogRef, ProjectId, RunId } from "../domain/ids.ts"
import { LocalProject, ProjectSummary } from "../domain/project.ts"
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
import { LocalProjectStore } from "../projects/local-project-store.ts"
import { EngineServiceConfig, GitHubAppConfig, GitHubTriggerConfig, StorageRuntimeConfig } from "../runtime/config.ts"
import { logInfo } from "../runtime/logger.ts"
import { Metrics } from "../runtime/metrics.ts"
import { makeServiceEngineLayer } from "../runtime/layers.ts"
import { ObjectStorageClient, sqlClientLayer } from "../runtime/storage.ts"
import { appVersion } from "../runtime/version.ts"
import { SecretStore } from "../secrets/store.ts"
import { ArtifactGc } from "../engine/stores/artifact-gc.ts"
import { ArtifactStore } from "../engine/stores/artifact-store.ts"
import { StateStore } from "../engine/stores/state-store.ts"
import { LocalProjectCreateRequest, ProjectRunConfigResponse, ProjectRunRequest, ProjectUpdateRequest, RunActionRequest, RunSubmissionRequest, SecretSetRequest, ServiceErrorResponse, WorkflowRunSubmissionRequest } from "./contracts.ts"
import { decodeJson, encodeJson } from "./schema-json.ts"

type EngineService = typeof Engine.Service

class RequestBodyInvalid extends Schema.TaggedErrorClass<RequestBodyInvalid>()("RequestBodyInvalid", {
  message: Schema.String,
}) {}

export const makeServiceLayer = () =>
  {
    const engineLayer = makeServiceEngineLayer()
    const bindingStoreLayer = GitHubBindingStore.postgresLayer.pipe(Layer.provideMerge(sqlClientLayer), Layer.provideMerge(engineLayer))
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
  const stateStore = yield* Effect.serviceOption(StateStore)
  const localProjectStore = yield* Effect.serviceOption(LocalProjectStore)
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
        GET: () => runJsonEffect(listProjects(gitHubIntegration, localProjectStore), { schema: Schema.Array(ProjectSummary) }),
        POST: (request) =>
          runJsonEffect(
            createLocalProject(localProjectStore, sql, request).pipe(
              Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer)),
            ),
            { schema: ProjectSummary, status: 201 },
          ),
      },
      "/api/projects/:projectId/runs": {
        GET: (request) =>
          runJsonEffect(
            readLocalProjectRunConfig(localProjectStore, request.params.projectId).pipe(
              Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer)),
            ),
            { schema: ProjectRunConfigResponse },
          ),
        POST: (request) =>
          runJsonEffect(
            startLocalProjectRun(localProjectStore, engine, request, request.params.projectId).pipe(
              Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer)),
            ),
            { schema: WorkflowRunState, status: 201 },
          ),
      },
      "/api/projects/:projectId": {
        PATCH: (request) => runJsonEffect(updateProject(localProjectStore, sql, request, request.params.projectId), { noContent: true }),
        DELETE: (request) => runJsonEffect(deleteProject(stateStore, localProjectStore, sql, objectStorage, request.params.projectId), { noContent: true }),
      },
      "/api/workflows/files": {
        GET: () => runJsonEffect(listWorkflowFiles(), { schema: Schema.Array(Schema.String) }),
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
      "/api/bindings/:bindingId": {
        DELETE: (request) => runJsonEffect(gitHubIntegration.deleteBinding(request.params.bindingId), { noContent: true }),
      },
      "/api/github/installations/:installationId/repositories": {
        GET: (request) =>
          runJsonEffect(listGitHubInstallationRepositories(gitHubIntegration, request.params.installationId), {
            schema: Schema.Array(GitHubInstallationRepository),
          }),
      },
      "/api/github/repositories/branches": {
        GET: (request) => runJsonEffect(listGitHubRepositoryBranches(gitHubIntegration, request), { schema: Schema.Array(Schema.String) }),
      },
      "/api/github/repositories/workflows": {
        GET: (request) => runJsonEffect(listGitHubRepositoryWorkflowFiles(gitHubIntegration, request), { schema: Schema.Array(Schema.String) }),
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

const listGitHubInstallationRepositories = (gitHubIntegration: typeof GitHubIntegration.Service, installationId: string) =>
  Effect.gen(function* () {
    const parsedInstallationId = Number(installationId)
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      return yield* new RequestBodyInvalid({ message: "installationId must be a positive integer" })
    }

    return yield* gitHubIntegration.listInstallationRepositories(parsedInstallationId)
  })

const listGitHubRepositoryBranches = (gitHubIntegration: typeof GitHubIntegration.Service, request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const installationId = yield* parsePositiveInteger(url.searchParams.get("installationId"), "installationId")
    const repository = yield* parseRequiredQuery(url.searchParams.get("repository"), "repository")
    return yield* gitHubIntegration.listRepositoryBranches(installationId, repository)
  })

const listGitHubRepositoryWorkflowFiles = (gitHubIntegration: typeof GitHubIntegration.Service, request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const installationId = yield* parsePositiveInteger(url.searchParams.get("installationId"), "installationId")
    const repository = yield* parseRequiredQuery(url.searchParams.get("repository"), "repository")
    const ref = normalizeOptionalQuery(url.searchParams.get("ref"))
    return yield* gitHubIntegration.listRepositoryWorkflowFiles(installationId, repository, ref)
  })

const listProjects = (
  gitHubIntegration: typeof GitHubIntegration.Service,
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
) =>
  Effect.gen(function* () {
    const [gitHubProjects, localProjects] = yield* Effect.all([
      gitHubIntegration.listProjects(),
      Option.match(localProjectStore, {
        onNone: () => Effect.succeed([] as const),
        onSome: (store) => store.listProjects(),
      }),
    ])

    return [...gitHubProjects, ...localProjects].sort((left, right) => (left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0))
  })

const createLocalProject = (
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
  sql: Option.Option<typeof SqlClient.Service>,
  request: Request,
) =>
  Effect.gen(function* () {
    const store = yield* requireService(localProjectStore, "local project storage")
    const sqlClient = yield* requireService(sql, "SQL storage")
    const workflowLoader = yield* WorkflowModuleLoader
    const materializer = yield* DslMaterializer
    const payload = yield* parseRequestBody(request, LocalProjectCreateRequest)
    const workflowModulePath = payload.workflowModulePath.trim()

    if (workflowModulePath.length === 0) {
      return yield* new RequestBodyInvalid({ message: "workflowModulePath must be non-empty" })
    }

    const authored = yield* workflowLoader.load(workflowModulePath)
    const definition = yield* materializer.materialize(authored)
    const resolvedWorkflowModulePath = yield* workflowLoader.resolve(workflowModulePath)
    const projectId = payload.projectId?.trim().length ? payload.projectId.trim() : definition.workflowId
    const workspacePath = payload.workspacePath?.trim().length ? payload.workspacePath.trim() : dirname(resolvedWorkflowModulePath)
    const projectName = payload.name?.trim().length ? payload.name.trim() : (definition.name.trim().length ? definition.name.trim() : definition.workflowId)

    if (yield* projectExists(sqlClient, projectId)) {
      return yield* new ProjectOperationRejected({
        projectId,
        operation: "create",
        message: `Project ${projectId} already exists`,
      })
    }

    const now = new Date()
    yield* store.create(
      new LocalProject({
        projectId: ProjectId.make(projectId),
        name: projectName,
        provider: "local",
        workflowModulePath: toWorkspaceRelativePath(resolvedWorkflowModulePath),
        workspacePath: toWorkspaceRelativePath(workspacePath),
        createdAt: now,
        updatedAt: now,
      }),
    )

    return new ProjectSummary({
      projectId: ProjectId.make(projectId),
      name: projectName,
      provider: "local",
      bindingCount: 0,
      runCount: 0,
    })
  })

const listWorkflowFiles = Effect.fn("Service.listWorkflowFiles")(() =>
  Effect.promise(async () => {
    const patterns = ["**/*workflow*.{ts,tsx,js,jsx,mts,mjs}", "workflows/**/*.{ts,tsx,js,jsx,mts,mjs}"]
    const matches = new Set<string>()

    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern)
      for await (const path of glob.scan({ cwd: process.cwd(), absolute: false, onlyFiles: true })) {
        if (path.includes("node_modules/") || path.includes("/.git/") || path.startsWith("node_modules/") || path.startsWith(".git/")) {
          continue
        }
        matches.add(path)
      }
    }

    return [...matches].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  }),
)

const updateProject = (
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
  sql: Option.Option<typeof SqlClient.Service>,
  request: Request,
  currentProjectId: string,
) =>
  Effect.gen(function* () {
    const localStore = yield* requireService(localProjectStore, "local project storage")
    const sqlClient = yield* requireService(sql, "SQL storage")
    const payload = yield* parseRequestBody(request, ProjectUpdateRequest)
    const nextName = payload.name?.trim().length ? payload.name.trim() : undefined

    if (!(yield* projectExists(sqlClient, currentProjectId))) {
      return yield* new ProjectNotFound({ projectId: currentProjectId })
    }

    yield* catchProjectSql(
      "update project",
      sqlClient.withTransaction(
        Effect.gen(function* () {
          yield* localStore.updateProjectName(currentProjectId, nextName)

          if (nextName === undefined) {
            yield* sqlClient`
              UPDATE github_bindings
              SET binding_json = binding_json - 'name'
              WHERE project_id = ${currentProjectId}
            `
          } else {
            yield* sqlClient`
              UPDATE github_bindings
              SET binding_json = jsonb_set(binding_json, '{name}', to_jsonb(CAST(${nextName} AS text)), true)
              WHERE project_id = ${currentProjectId}
            `
          }
        }),
      ),
    )
  })

const startLocalProjectRun = (
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
  engine: EngineService,
  request: Request,
  projectId: string,
) =>
  Effect.gen(function* () {
    const localStore = yield* requireService(localProjectStore, "local project storage")
    const workflowLoader = yield* WorkflowModuleLoader
    const materializer = yield* DslMaterializer
    const project = yield* localStore.get(projectId)
    const payload = yield* parseOptionalRequestBody(request, ProjectRunRequest)

    if (project === undefined) {
      return yield* new ProjectOperationRejected({
        projectId,
        operation: "run",
        message: `Project ${projectId} is not a local project and cannot be run manually`,
      })
    }

    const authored = yield* workflowLoader.load(project.workflowModulePath)
    const definition = yield* materializer.materialize(authored)
    const enrichedDefinition = new NormalizedWorkflowDefinition({
      ...definition,
      metadata: {
        ...definition.metadata,
        projectId: project.projectId,
        project: {
          provider: project.provider,
          projectId: project.projectId,
          ...(project.name === undefined ? {} : { name: project.name }),
        },
      },
    })

    return yield* engine.submitDefinition(enrichedDefinition, {
      workspacePath: resolveStoredWorkspacePath(project.workspacePath),
      ...(payload?.inputValues === undefined ? {} : { inputValues: payload.inputValues }),
    })
  })

const readLocalProjectRunConfig = (
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
  projectId: string,
) =>
  Effect.gen(function* () {
    const localStore = yield* requireService(localProjectStore, "local project storage")
    const workflowLoader = yield* WorkflowModuleLoader
    const materializer = yield* DslMaterializer
    const project = yield* localStore.get(projectId)

    if (project === undefined) {
      return yield* new ProjectOperationRejected({
        projectId,
        operation: "inspect run config",
        message: `Project ${projectId} is not a local project and cannot be run manually`,
      })
    }

    const authored = yield* workflowLoader.load(project.workflowModulePath)
    const definition = yield* materializer.materialize(authored)

    return new ProjectRunConfigResponse({
      requiredInputs: definition.inputs.map((input) => input.name),
    })
  })

const deleteProject = (
  stateStore: Option.Option<typeof StateStore.Service>,
  localProjectStore: Option.Option<typeof LocalProjectStore.Service>,
  sql: Option.Option<typeof SqlClient.Service>,
  objectStorage: Option.Option<typeof ObjectStorageClient.Service>,
  projectId: string,
) =>
  Effect.gen(function* () {
    const store = yield* requireService(stateStore, "project state storage")
    const localStore = yield* requireService(localProjectStore, "local project storage")
    const sqlClient = yield* requireService(sql, "SQL storage")
    const storage = yield* requireService(objectStorage, "object storage")

    yield* assertProjectMutationAllowed(store, sqlClient, projectId, "delete")

    const objectKeys = yield* catchProjectSql(
      "list project artifacts",
      sqlClient<{ readonly object_key: string }>`
        SELECT object_key
        FROM artifact_metadata
        WHERE run_id IN (SELECT run_id FROM workflow_runs WHERE project_id = ${projectId})
        UNION
        SELECT object_key
        FROM log_metadata
        WHERE run_id IN (SELECT run_id FROM workflow_runs WHERE project_id = ${projectId})
      `,
    )

    for (const row of objectKeys) {
      yield* storage.deleteObject(row.object_key)
    }

    yield* catchProjectSql(
      "delete project",
      sqlClient.withTransaction(
        Effect.gen(function* () {
          yield* sqlClient`DELETE FROM artifact_metadata WHERE run_id IN (SELECT run_id FROM workflow_runs WHERE project_id = ${projectId})`
          yield* sqlClient`DELETE FROM log_metadata WHERE run_id IN (SELECT run_id FROM workflow_runs WHERE project_id = ${projectId})`
          yield* sqlClient`DELETE FROM github_trigger_deliveries WHERE project_id = ${projectId}`
          yield* sqlClient`DELETE FROM github_run_links WHERE project_id = ${projectId}`
          yield* sqlClient`DELETE FROM github_bindings WHERE project_id = ${projectId}`
          yield* sqlClient`DELETE FROM secrets WHERE project_id = ${projectId}`
          yield* localStore.deleteProject(projectId)
          yield* store.deleteProject(projectId)
        }),
      ),
    )
  })

const assertProjectMutationAllowed = (
  stateStore: typeof StateStore.Service,
  sql: typeof SqlClient.Service,
  projectId: string,
  operation: string,
) =>
  Effect.gen(function* () {
    if (!(yield* projectExists(sql, projectId))) {
      return yield* new ProjectNotFound({ projectId })
    }

    const runs = yield* stateStore.listRuns(projectId)
    if (runs.some((run) => !isTerminalRun(run.status))) {
      return yield* new ProjectOperationRejected({
        projectId,
        operation,
        message: `Project ${projectId} has non-terminal runs and cannot be ${operation}d`,
      })
    }
  })

const projectExists = (sql: typeof SqlClient.Service, projectId: string) =>
  catchProjectSql(
    "check project existence",
    sql<{ readonly exists: boolean }>`
      SELECT EXISTS(
        SELECT 1 FROM workflow_runs WHERE project_id = ${projectId}
        UNION ALL
        SELECT 1 FROM github_bindings WHERE project_id = ${projectId}
        UNION ALL
        SELECT 1 FROM github_run_links WHERE project_id = ${projectId}
        UNION ALL
        SELECT 1 FROM github_trigger_deliveries WHERE project_id = ${projectId}
        UNION ALL
        SELECT 1 FROM secrets WHERE project_id = ${projectId}
        UNION ALL
        SELECT 1 FROM local_projects WHERE project_id = ${projectId}
      ) AS exists
    `.pipe(Effect.map((rows) => rows[0]?.exists ?? false)),
  )

const toWorkspaceRelativePath = (path: string) => {
  if (!isAbsolute(path)) {
    return path
  }

  const nextPath = relative(process.cwd(), path)
  return nextPath.length === 0 || nextPath.startsWith("..") ? path : nextPath
}

const resolveStoredWorkspacePath = (path: string) =>
  isAbsolute(path) ? path : resolvePath(process.cwd(), path)

const parsePositiveInteger = (value: string | null, label: string) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return Effect.fail(new RequestBodyInvalid({ message: `${label} must be a positive integer` }))
  }

  return Effect.succeed(parsed)
}

const parseRequiredQuery = (value: string | null, label: string) => {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed.length === 0) {
    return Effect.fail(new RequestBodyInvalid({ message: `${label} query parameter is required` }))
  }

  return Effect.succeed(trimmed)
}

const normalizeOptionalQuery = (value: string | null) => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

const requireService = <A>(service: Option.Option<A>, name: string) =>
  Option.match(service, {
    onNone: () => Effect.fail(new ServiceUnavailable({ message: `${name} is not configured` })),
    onSome: Effect.succeed,
  })

const catchProjectSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "ProjectStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>

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

const parseOptionalRequestBody = <A, I, RD, RE>(request: Request, schema: Schema.Codec<A, I, RD, RE>) =>
  readRequestText(request).pipe(
    Effect.flatMap((text) => {
      if (text.trim().length === 0) {
        return Effect.succeed(undefined)
      }

      return decodeJsonText(text, schema)
    }),
  )

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
    case "ProjectNotFound":
      return 404
    case "WorkflowDefinitionInvalid":
    case "PlanningFailed":
    case "RunControlRejected":
    case "ProjectOperationRejected":
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
