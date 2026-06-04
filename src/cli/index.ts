import { Console, Effect, Layer, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { dirname, resolve as resolvePath } from "node:path"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../domain/artifacts.ts"
import { GitHubBindingRejected } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { GitHubBindingCreateRequest, GitHubBindingSummary } from "../domain/github.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "../domain/ids.ts"
import { ProjectSummary } from "../domain/project.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { type TestExecutorLayerOptions } from "../engine/executor.ts"
import { Engine } from "../engine/interface.ts"
import { GitHubIntegration } from "../github/integration.ts"
import { makeDurableStorageLayer, makeInMemoryEngineLayer } from "../runtime/layers.ts"
import { FetchHttpClient } from "effect/unstable/http"

import { EngineServiceConfig } from "../runtime/config.ts"
import { appVersion } from "../runtime/version.ts"
import { engineServiceClientLayer, gitHubIntegrationClientLayer, SecretsClient } from "../service/client.ts"
import { gap, heading, item, kv, none, red, status, success } from "./style.ts"

export const cliVersion = appVersion

class CliInputInvalid extends Schema.TaggedErrorClass<CliInputInvalid>()("CliInputInvalid", {
  message: Schema.String,
}) {}

export { makeDurableStorageLayer }

export const makeCliLayer = (options: TestExecutorLayerOptions = {}) =>
  Layer.mergeAll(
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    makeInMemoryEngineLayer(mergeExecutorOptions(options)),
  )

export const makeAppLayer = () =>
  Layer.mergeAll(
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    engineServiceClientLayer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(EngineServiceConfig.layer),
    ),
    gitHubIntegrationClientLayer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(EngineServiceConfig.layer),
    ),
    SecretsClient.layer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(EngineServiceConfig.layer),
    ),
  )

export const makeAppLayerForBaseUrl = (baseUrl: string) =>
  Layer.mergeAll(
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    engineServiceClientLayer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(localEngineServiceConfigLayer(baseUrl)),
    ),
    gitHubIntegrationClientLayer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(localEngineServiceConfigLayer(baseUrl)),
    ),
    SecretsClient.layer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(localEngineServiceConfigLayer(baseUrl)),
    ),
  )

const localEngineServiceConfigLayer = (baseUrl: string) =>
  Layer.succeed(EngineServiceConfig, {
    baseUrl,
    port: new URL(baseUrl).port.length === 0 ? 80 : Number(new URL(baseUrl).port),
  })

const workflowModuleArg = Argument.string("workflow-module").pipe(
  Argument.withDescription("Local workflow module path (TypeScript/JavaScript)"),
)

const exportNameFlag = Flag.string("export").pipe(
  Flag.withAlias("e"),
  Flag.optional,
  Flag.withDescription("Select a named export (defaults to: default, then `workflow`)")
)

const workspaceFlag = Flag.string("workspace").pipe(
  Flag.withAlias("w"),
  Flag.optional,
  Flag.withDescription("Workspace directory mounted into execution containers"),
)

const inputsFlag = Flag.string("inputs").pipe(
  Flag.optional,
  Flag.withDescription("Workflow inputs as a JSON object"),
)

const installationIdFlag = Flag.string("installation-id").pipe(
  Flag.withAlias("i"),
  Flag.withDescription("GitHub App installation id for the bound repository"),
)

const branchFlag = Flag.string("branch").pipe(
  Flag.optional,
  Flag.withDescription("Restrict the binding to a branch name"),
)

const projectFlag = Flag.string("project").pipe(
  Flag.optional,
  Flag.withDescription("Filter runs by project id"),
)

const workspaceSubdirFlag = Flag.string("workspace-subdir").pipe(
  Flag.optional,
  Flag.withDescription("Run the workflow inside a repository subdirectory"),
)

const fromEnvFlag = Flag.string("from-env").pipe(
  Flag.withDescription("Read the secret value from an existing environment variable"),
)

const validateCommand = Command.make(
  "validate",
  { workflowModule: workflowModuleArg, exportName: exportNameFlag },
  ({ workflowModule, exportName }) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const definition = yield* loadAndMaterializeWorkflow(workflowModule, Option.getOrUndefined(exportName))

    yield* engine.validate(definition)
    yield* printLines([success(`workflow ${definition.workflowId} is valid`)])
  }),
).pipe(Command.withDescription("Validate a workflow module (default export or named export `workflow`)"))

const planCommand = Command.make("plan", { workflowModule: workflowModuleArg, exportName: exportNameFlag }, ({ workflowModule, exportName }) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const definition = yield* loadAndMaterializeWorkflow(workflowModule, Option.getOrUndefined(exportName))
    const plan = yield* engine.plan(definition)

    yield* printLines(renderPlanSummary(plan))
  }),
).pipe(Command.withDescription("Plan a workflow module (default export or named export `workflow`)"))

const runCommand = Command.make(
  "run",
  { workflowModule: workflowModuleArg, exportName: exportNameFlag, workspace: workspaceFlag, inputs: inputsFlag },
  ({ workflowModule, exportName, workspace, inputs }) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const resolvedWorkspace = yield* resolveWorkspacePath(workflowModule, workspace)
    const inputValues = yield* parseInputValues(inputs)
    const definition = yield* loadAndMaterializeWorkflow(workflowModule, Option.getOrUndefined(exportName))
    const run = yield* engine.startDefinition(definition, {
      workspacePath: resolvedWorkspace,
      ...(inputValues === undefined ? {} : { inputValues }),
    })
    const events = yield* engine.readRunEvents(run.runId)
    const artifacts = yield* engine.readArtifacts(run.runId)
    const logs = yield* engine.readLogs(run.runId)

    yield* printLines(renderRunSummary(run, events, artifacts, logs, resolvedWorkspace))
  }),
).pipe(Command.withDescription("Run a workflow module (default export or named export `workflow`)"))

const runsListCommand = Command.make("list", { project: projectFlag }, ({ project }) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const runs = yield* engine.listRuns(Option.getOrUndefined(project))

    yield* printLines(renderRunsList(runs))
  }),
).pipe(Command.withDescription("List persisted workflow runs"))

const runsShowCommand = Command.make(
  "show",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.inspectRun(RunId.make(runId))

      yield* printLines(renderRunState(run))
    }),
).pipe(Command.withDescription("Show a persisted workflow run"))

const runsEventsCommand = Command.make(
  "events",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const events = yield* engine.readRunEvents(RunId.make(runId))

      yield* printLines(renderEventList(runId, events))
    }),
).pipe(Command.withDescription("Show ordered workflow events for a run"))

const runsArtifactsCommand = Command.make(
  "artifacts",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const artifacts = yield* engine.readArtifacts(RunId.make(runId))

      yield* printLines(renderArtifacts(runId, artifacts))
    }),
).pipe(Command.withDescription("Show artifact metadata for a run"))

const runsCancelCommand = Command.make(
  "cancel",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.cancelRun(RunId.make(runId), "Canceled from CLI")

      yield* printLines(renderRunState(run))
    }),
).pipe(Command.withDescription("Cancel a workflow run"))

const runsRetryCommand = Command.make(
  "retry",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const retriedRun = yield* engine.retryRun(RunId.make(runId), "Retried from CLI")

      yield* printLines(renderRunState(retriedRun))
    }),
).pipe(Command.withDescription("Retry a terminal workflow run"))

const runsLogsCommand = Command.make(
  "logs",
  {
    runId: Argument.string("runId"),
  },
  ({ runId }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const logs = yield* engine.readLogs(RunId.make(runId))

      yield* printLines(renderLogs(runId, logs))
    }),
).pipe(Command.withDescription("Show log metadata for a run"))

const runsLogCommand = Command.make(
  "log",
  {
    logRef: Argument.string("logRef"),
  },
  ({ logRef }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const payload = yield* engine.readLogPayload(LogRef.make(logRef))

      yield* printLines([kv("log", logRef), payload])
    }),
).pipe(Command.withDescription("Read persisted log payload content"))

const runsArtifactCommand = Command.make(
  "artifact",
  {
    artifactRef: Argument.string("artifactRef"),
  },
  ({ artifactRef }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const payload = yield* engine.readArtifactPayload(ArtifactRef.make(artifactRef))

      yield* printLines([kv("artifact", artifactRef), payload])
    }),
).pipe(Command.withDescription("Read persisted artifact payload content"))

const artifactsDeleteCommand = Command.make(
  "delete",
  {
    artifactRef: Argument.string("artifactRef"),
  },
  ({ artifactRef }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      yield* engine.deleteArtifact(ArtifactRef.make(artifactRef))
      yield* printLines([kv("artifact", artifactRef), kv("status", status("deleted"))])
    }),
).pipe(Command.withDescription("Delete a persisted artifact payload"))

const artifactsCommand = Command.make("artifacts").pipe(
  Command.withDescription("Manage persisted artifacts"),
  Command.withSubcommands([artifactsDeleteCommand]),
)

const logsDeleteCommand = Command.make(
  "delete",
  {
    logRef: Argument.string("logRef"),
  },
  ({ logRef }) =>
    Effect.gen(function* () {
      const engine = yield* Engine
      yield* engine.deleteLog(LogRef.make(logRef))
      yield* printLines([kv("log", logRef), kv("status", status("deleted"))])
    }),
).pipe(Command.withDescription("Delete a persisted log payload"))

const logsCommand = Command.make("logs").pipe(
  Command.withDescription("Manage persisted logs"),
  Command.withSubcommands([logsDeleteCommand]),
)

const runsCommand = Command.make("runs").pipe(
  Command.withDescription("Inspect persisted workflow runs"),
  Command.withSubcommands([
    runsListCommand,
    runsShowCommand,
    runsEventsCommand,
    runsArtifactsCommand,
    runsArtifactCommand,
    runsLogsCommand,
    runsLogCommand,
    runsCancelCommand,
    runsRetryCommand,
  ]),
)

const bindingsAddGitHubCommand = Command.make(
  "github",
  {
    repository: Argument.string("repository"),
    workflowModulePath: Argument.string("workflow-module-path"),
    installationId: installationIdFlag,
    branch: branchFlag,
    workspaceSubdir: workspaceSubdirFlag,
  },
  ({ repository, workflowModulePath, installationId, branch, workspaceSubdir }) =>
    Effect.gen(function* () {
      const gitHubIntegration = yield* GitHubIntegration
      const binding = yield* gitHubIntegration.addBinding(
        new GitHubBindingCreateRequest({
          repository,
          installationId: yield* parseInstallationId(installationId),
          workflowModulePath,
          branch: Option.getOrUndefined(branch),
          workspaceSubdir: Option.getOrUndefined(workspaceSubdir),
        }),
      )

      yield* printLines(renderBindingSummary(binding))
    }),
).pipe(Command.withDescription("Create a GitHub repository binding"))

const bindingsAddCommand = Command.make("add").pipe(
  Command.withDescription("Create repository trigger bindings"),
  Command.withSubcommands([bindingsAddGitHubCommand]),
)

const bindingsListCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const gitHubIntegration = yield* GitHubIntegration
    const bindings = yield* gitHubIntegration.listBindings()

    yield* printLines(renderBindingsList(bindings))
  }),
).pipe(Command.withDescription("List configured repository bindings"))

const projectsListCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const gitHubIntegration = yield* GitHubIntegration
    const projects = yield* gitHubIntegration.listProjects()

    yield* printLines(renderProjectsList(projects))
  }),
).pipe(Command.withDescription("List configured repository projects"))

const projectsCommand = Command.make("projects").pipe(
  Command.withDescription("Inspect configured repository projects"),
  Command.withSubcommands([projectsListCommand]),
)

const bindingsDeleteCommand = Command.make(
  "delete",
  {
    bindingId: Argument.string("binding-id"),
  },
  ({ bindingId }) =>
    Effect.gen(function* () {
      const gitHubIntegration = yield* GitHubIntegration
      yield* gitHubIntegration.deleteBinding(bindingId).pipe(
        Effect.catchTag("GitHubBindingNotFound", () =>
          Effect.fail(
            new CliInputInvalid({
              message: `Binding not found: ${bindingId}`,
            }),
          ),
        ),
      )
      yield* printLines([success(`Deleted binding: ${bindingId}`)])
    }),
).pipe(Command.withDescription("Delete a repository binding"))

const bindingsCommand = Command.make("bindings").pipe(
  Command.withDescription("Manage repository trigger bindings"),
  Command.withSubcommands([bindingsAddCommand, bindingsDeleteCommand, bindingsListCommand]),
)

const secretsSetCommand = Command.make(
  "set",
  {
    projectId: Argument.string("projectId"),
    key: Argument.string("key"),
    fromEnv: fromEnvFlag,
  },
  ({ projectId, key, fromEnv }) =>
    Effect.gen(function* () {
      const secrets = yield* SecretsClient
      const value = process.env[fromEnv]

      if (value === undefined) {
        return yield* Console.error(red(`missing environment variable for --from-env: ${fromEnv}`)).pipe(
          Effect.flatMap(() => Effect.fail(new CliInputInvalid({ message: "Secret value source missing" }))),
        )
      }

      yield* secrets.setSecret(projectId, key, value)
      yield* printLines([kv("project", projectId), kv("secret", key), kv("status", status("stored"))])
    }),
).pipe(Command.withDescription("Store or update a secret from an existing environment variable"))

const secretsListCommand = Command.make("list", { projectId: Argument.string("projectId") }, ({ projectId }) =>
  Effect.gen(function* () {
    const secrets = yield* SecretsClient
    const items = yield* secrets.listSecrets(projectId)
    yield* printLines(renderSecretsList(projectId, items))
  }),
).pipe(Command.withDescription("List stored secret keys without values"))

const secretsDeleteCommand = Command.make(
  "delete",
  {
    projectId: Argument.string("projectId"),
    key: Argument.string("key"),
  },
  ({ projectId, key }) =>
    Effect.gen(function* () {
      const secrets = yield* SecretsClient
      yield* secrets.deleteSecret(projectId, key)
      yield* printLines([kv("project", projectId), kv("secret", key), kv("status", status("deleted"))])
    }),
).pipe(Command.withDescription("Delete a stored secret"))

const secretsCommand = Command.make("secrets").pipe(
  Command.withDescription("Manage self-hosted secrets"),
  Command.withSubcommands([secretsSetCommand, secretsListCommand, secretsDeleteCommand]),
)

export const cli = Command.make("effect-cicd").pipe(
  Command.withDescription("Minimal Engine-backed CLI MVP"),
  Command.withSubcommands([validateCommand, planCommand, runCommand, runsCommand, artifactsCommand, logsCommand, bindingsCommand, projectsCommand, secretsCommand]),
)

export const cliProgram = Command.run(cli, { version: cliVersion })

export const appProgram = cliProgram.pipe(
  Effect.catchTag("EngineUnavailable", (error) =>
    Console.error(red(`engine service unavailable: ${error.message}`)).pipe(
      Effect.flatMap(() => Effect.fail(error)),
    ),
  ),
)

const printLines = (lines: ReadonlyArray<string>) => Console.log(lines.join("\n"))

const loadAndMaterializeWorkflow = Effect.fn("cli.loadAndMaterializeWorkflow")(function* (
  workflowModule: string,
  exportName: string | undefined,
) {
  const loader = yield* WorkflowModuleLoader
  const materializer = yield* DslMaterializer
  const authored = yield* loader.load(workflowModule, exportName === undefined ? undefined : { exportName })
  return yield* materializer.materialize(authored)
})

const resolveWorkspacePath = Effect.fn("cli.resolveWorkspacePath")(function* (
  workflowModule: string,
  workspace: Option.Option<string>,
) {
  const loader = yield* WorkflowModuleLoader
  const resolvedModulePath = yield* loader.resolve(workflowModule)

  if (Option.isSome(workspace)) {
    return resolvePath(process.cwd(), workspace.value)
  }

  return dirname(resolvedModulePath)
})

const waitForTerminalRun = (
  engine: { readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, any> },
  runId: RunId,
): Effect.Effect<WorkflowRunState, any> =>
  engine.inspectRun(runId).pipe(
    Effect.flatMap((run) =>
      terminalRunStatuses.has(run.status)
        ? Effect.succeed(run)
        : Effect.sleep("250 millis").pipe(Effect.flatMap(() => waitForTerminalRun(engine, runId))),
    ),
  )

const renderPlanSummary = (plan: ExecutionPlan) => [
  kv("workflow", plan.workflowId),
  kv("name", plan.workflowName),
  ...gap(),
  heading("units"),
  ...plan.units.map((unit) => item(`${unit.unitId} deps: ${formatNames(unit.dependencies)}`)),
  ...gap(),
  heading("dependencies"),
  ...plan.dependencies.map((dependency) => item(`${dependency.from} -> ${dependency.to}`)),
  ...gap(),
  kv("diagnostics", String(plan.diagnostics.length)),
]

const renderRunSummary = (
  run: WorkflowRunState,
  events: ReadonlyArray<{ readonly _tag: string }>,
  artifacts: ReadonlyArray<ArtifactMetadata>,
  logs: ReadonlyArray<LogMetadata>,
  workspacePath: string,
) => [
  kv("run", run.runId),
  kv("project", run.projectId),
  kv("status", status(run.status)),
  kv("workspace", workspacePath),
  kv("inputs", formatResolvedValues(run.inputs ?? [])),
  kv("outputs", formatOutputValues(run.outputs ?? [])),
  kv("reports", formatReports(run.reports ?? [])),
  ...gap(),
  heading("units"),
  ...run.units.map((unit) => item(`${unit.unitId} ${status(unit.status)}`)),
  ...gap(),
  heading("events"),
  ...events.map((event) => item(event._tag)),
  ...gap(),
  heading("artifacts"),
  ...renderPayloadRefs(artifacts, (artifact) => `${artifact.name} ${artifact.artifactRef}`),
  ...gap(),
  heading("logs"),
  ...renderPayloadRefs(logs, (log) => `${log.name} ${log.logRef}`),
]

const renderRunsList = (runs: ReadonlyArray<WorkflowRunState>) => [
  heading("runs"),
  ...(runs.length === 0
    ? [none()]
    : runs.map(
        (run) =>
          item(`${run.runId} project=${run.projectId} workflow=${run.workflowId} status=${status(run.status)} updatedAt=${run.updatedAt.toISOString()}`),
      )),
]

const renderRunState = (run: WorkflowRunState) => [
  kv("run", run.runId),
  kv("project", run.projectId),
  kv("workflow", run.workflowId),
  kv("plan", run.planId),
  kv("status", status(run.status)),
  kv("workspace", run.execution.options.workspacePath ?? "-"),
  kv("createdAt", run.createdAt.toISOString()),
  kv("updatedAt", run.updatedAt.toISOString()),
  kv("startedAt", formatDate(run.startedAt)),
  kv("finishedAt", formatDate(run.finishedAt)),
  kv("progress", `${run.progress.completedUnits}/${run.progress.totalUnits} completed, ${run.progress.failedUnits} failed, ${run.progress.skippedUnits} skipped`),
  kv("failure", run.failure?.message ?? "-"),
  kv("cancellation", run.cancellationReason ?? "-"),
  kv("inputs", formatResolvedValues(run.inputs ?? [])),
  kv("outputs", formatOutputValues(run.outputs ?? [])),
  kv("reports", formatReports(run.reports ?? [])),
  ...renderTriggerMetadata(run),
  ...gap(),
  heading("units"),
  ...run.units.map(
    (unit) =>
      item(`${unit.unitId} ${status(unit.status)} inputs=${formatResolvedValues(unit.resolvedInputs ?? [])} outputs=${formatOutputValues(unit.outputs ?? [])} reports=${formatReports(unit.reports ?? [])}${unit.skipReason === undefined ? "" : ` skipped=${unit.skipReason}`}${unit.cancellationReason === undefined ? "" : ` canceled=${unit.cancellationReason}`}`),
  ),
]

const renderBindingsList = (bindings: ReadonlyArray<GitHubBindingSummary>) => [
  heading("bindings"),
  ...(bindings.length === 0
    ? [none()]
    : bindings.flatMap((binding, index) => [...(index === 0 ? [] : gap()), ...renderBindingSummary(binding)])),
]

const renderSecretsList = (
  projectId: string,
  secrets: ReadonlyArray<{ readonly key: string; readonly createdAt: Date; readonly updatedAt: Date }>,
) => [
  kv("project", projectId),
  ...gap(),
  heading("secrets"),
  ...(secrets.length === 0
    ? [none()]
    : secrets.map((secret) => item(`${secret.key} updatedAt=${secret.updatedAt.toISOString()}`))),
]

const renderBindingSummary = (binding: GitHubBindingSummary) => [
  kv("binding", binding.bindingId),
  kv("project", binding.projectId),
  kv("provider", binding.provider),
  kv("installationId", String(binding.installationId ?? "-")),
  kv("repositoryId", String(binding.repositoryId ?? "-")),
  kv("repository", binding.repository),
  kv("cloneUrl", binding.cloneUrl),
  kv("sourceKind", binding.sourceKind),
  kv("branch", binding.branch ?? "*"),
  kv("workflowModulePath", binding.workflowModulePath),
  kv("workspaceSubdir", binding.workspaceSubdir ?? "-"),
  kv("enabled", status(String(binding.enabled))),
]

const renderProjectsList = (projects: ReadonlyArray<ProjectSummary>) => [
  heading("projects"),
  ...(projects.length === 0
    ? [none()]
    : projects.flatMap((project, index) => [
        ...(index === 0 ? [] : gap()),
        kv("project", project.projectId),
        kv("name", project.name ?? "-"),
        kv("provider", project.provider),
        kv("repository", `${project.repositoryOwner ?? "-"}/${project.repositoryName ?? "-"}`),
        kv("repositoryId", String(project.repositoryId ?? "-")),
        kv("bindings", String(project.bindingCount)),
        kv("runs", String(project.runCount)),
        kv("latestRunAt", formatDate(project.latestRunAt)),
      ])),
]

const renderEventList = (runId: string, events: ReadonlyArray<{ readonly _tag: string; readonly sequence: number }>) => [
  kv("run", runId),
  ...gap(),
  heading("events"),
  ...(events.length === 0 ? [none()] : events.map((event) => item(`${event.sequence} ${event._tag}`))),
]

const renderArtifacts = (runId: string, artifacts: ReadonlyArray<ArtifactMetadata>) => [
  kv("run", runId),
  ...gap(),
  heading("artifacts"),
  ...renderPayloadRefs(
    artifacts,
    (artifact) => `${artifact.name} ${artifact.artifactRef} status=${status(artifact.status)} expiresAt=${formatDate(artifact.expiresAt)} summary=${artifact.summary ?? "-"}`,
  ),
]

const renderLogs = (runId: string, logs: ReadonlyArray<LogMetadata>) => [
  kv("run", runId),
  ...gap(),
  heading("logs"),
  ...renderPayloadRefs(logs, (log) => `${log.name} ${log.logRef} status=${status(log.status)} expiresAt=${formatDate(log.expiresAt)}`),
]

const renderPayloadRefs = <A>(items: ReadonlyArray<A>, render: (value: A) => string) =>
  items.length === 0 ? [none()] : items.map((value) => item(render(value)))

const formatNames = (names: ReadonlyArray<string>) => (names.length === 0 ? "-" : names.join(", "))

const formatResolvedValues = (values: ReadonlyArray<{ readonly name: string; readonly value: unknown }>) =>
  values.length === 0 ? "-" : values.map((value) => `${value.name}=${JSON.stringify(value.value)}`).join(", ")

const formatOutputValues = (values: ReadonlyArray<{ readonly name: string; readonly value: unknown }>) =>
  values.length === 0 ? "-" : values.map((value) => `${value.name}=${JSON.stringify(value.value)}`).join(", ")

const formatReports = (reports: ReadonlyArray<{ readonly name: string; readonly artifact: { readonly artifactRef: string } }>) =>
  reports.length === 0 ? "-" : reports.map((report) => `${report.name} ${report.artifact.artifactRef}`).join(", ")

const formatDate = (value: Date | undefined) => (value === undefined ? "-" : value.toISOString())

const renderTriggerMetadata = (run: WorkflowRunState) => {
  const metadata = run.execution.plan.metadata as Record<string, unknown>
  const trigger = asRecord(metadata.trigger)

  if (trigger?.provider !== "github") {
    return []
  }

  return [
    kv("trigger", "github"),
    kv("repository", String(trigger.repository ?? "-")),
    kv("ref", String(trigger.ref ?? "-")),
    kv("commitSha", String(trigger.commitSha ?? "-")),
    kv("binding", String(trigger.bindingId ?? "-")),
  ]
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const parseInputValues = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => Effect.succeed(undefined),
    onSome: (text) =>
      Effect.try({
        try: () => {
          const parsed = JSON.parse(text)
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("inputs must be a JSON object")
          }

          return parsed as Readonly<Record<string, unknown>>
        },
        catch: (error) =>
          new CliInputInvalid({
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
  })

const mergeExecutorOptions = (options: TestExecutorLayerOptions): TestExecutorLayerOptions => {
  return {
    ...(options.requests === undefined ? {} : { requests: options.requests }),
    resultsByUnitId: {
      ...sampleExecutorResultsByUnitId(),
      ...(options.resultsByUnitId ?? {}),
    },
  }
}

const parseInstallationId = (value: string | undefined) =>
  Effect.sync(() => Number(value)).pipe(
    Effect.flatMap((parsed) =>
      Number.isInteger(parsed) && parsed > 0
        ? Effect.succeed(parsed)
        : Effect.fail(
            new GitHubBindingRejected({
              message: `installation id must be a positive integer: ${value ?? ""}`,
            }),
          ),
    ),
  )

const sampleExecutorResultsByUnitId = (): NonNullable<TestExecutorLayerOptions["resultsByUnitId"]> => ({
  "unit:build": executorResult("workflow:sample", "unit:build", "dist", "build-output", "build stdout"),
  "unit:test": executorResult("workflow:sample", "unit:test", "coverage", "report", "test stdout"),
  "unit:deploy": executorResult(
    "workflow:sample",
    "unit:deploy",
    "release-manifest",
    "deployment-output",
    "deploy stdout",
  ),
})

const executorResult = (
  workflowId: string,
  unitId: string,
  artifactName: string,
  artifactCategory: string,
  logSummary: string,
) => {
  const runId = RunId.make(`run:plan:${workflowId}`)
  const attemptId = AttemptId.make(`attempt:${runId}:${unitId}:1`)
  const brandedUnitId = UnitId.make(unitId)

  return {
    logs: [
      new RegisteredLog({
        metadata: new LogMetadata({
          logRef: LogRef.make(`log:${workflowId}:${unitId}:stdout`),
          runId,
          unitId: brandedUnitId,
          attemptId,
          name: "stdout",
          status: "available",
          summary: logSummary,
        }),
        content: `${logSummary}\n`,
      }),
    ],
    artifacts: [
      new RegisteredArtifact({
        metadata: new ArtifactMetadata({
          artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:${artifactName}`),
          runId,
          unitId: brandedUnitId,
          attemptId,
          name: artifactName,
          category: artifactCategory,
          status: "available",
          summary: `${unitId} artifact`,
        }),
        payloadBase64: Buffer.from(JSON.stringify({ artifactName, unitId }, null, 2) + "\n").toString("base64"),
        contentType: "application/json",
      }),
    ],
  } satisfies NonNullable<TestExecutorLayerOptions["resultsByUnitId"]>[string]
}

const terminalRunStatuses = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"])
