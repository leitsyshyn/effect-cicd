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
import { engineServiceClientLayer, gitHubIntegrationClientLayer, SecretsClient } from "../service/client.ts"

export const cliVersion = "0.0.0"

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
    yield* printLines([`workflow ${definition.workflowId} is valid`])
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
    const plan = yield* engine.plan(definition)
    const submitted = yield* engine.submitRun(plan, {
      workspacePath: resolvedWorkspace,
      ...(inputValues === undefined ? {} : { inputValues }),
    })
    const run = yield* waitForTerminalRun(engine, submitted.runId)
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

      yield* printLines([`log: ${logRef}`, payload])
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

      yield* printLines([`artifact: ${artifactRef}`, payload])
    }),
).pipe(Command.withDescription("Read persisted artifact payload content"))

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

const bindingsCommand = Command.make("bindings").pipe(
  Command.withDescription("Manage repository trigger bindings"),
  Command.withSubcommands([bindingsAddCommand, bindingsListCommand]),
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
        return yield* Console.error(`missing environment variable for --from-env: ${fromEnv}`).pipe(
          Effect.flatMap(() => Effect.fail(new CliInputInvalid({ message: "Secret value source missing" }))),
        )
      }

      yield* secrets.setSecret(projectId, key, value)
      yield* printLines([`project: ${projectId}`, `secret: ${key}`, "status: stored"])
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
      yield* printLines([`project: ${projectId}`, `secret: ${key}`, "status: deleted"])
    }),
).pipe(Command.withDescription("Delete a stored secret"))

const secretsCommand = Command.make("secrets").pipe(
  Command.withDescription("Manage self-hosted secrets"),
  Command.withSubcommands([secretsSetCommand, secretsListCommand, secretsDeleteCommand]),
)

export const cli = Command.make("effect-cicd").pipe(
  Command.withDescription("Minimal Engine-backed CLI MVP"),
  Command.withSubcommands([validateCommand, planCommand, runCommand, runsCommand, bindingsCommand, projectsCommand, secretsCommand]),
)

export const cliProgram = Command.run(cli, { version: cliVersion })

export const appProgram = cliProgram.pipe(
  Effect.catchTag("EngineUnavailable", (error) =>
    Console.error(`engine service unavailable: ${error.message}`).pipe(
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
  `workflow: ${plan.workflowId}`,
  `name: ${plan.workflowName}`,
  "units:",
  ...plan.units.map((unit) => `${unit.unitId} deps: ${formatNames(unit.dependencies)}`),
  "dependencies:",
  ...plan.dependencies.map((dependency) => `${dependency.from} -> ${dependency.to}`),
  `diagnostics: ${plan.diagnostics.length}`,
]

const renderRunSummary = (
  run: WorkflowRunState,
  events: ReadonlyArray<{ readonly _tag: string }>,
  artifacts: ReadonlyArray<ArtifactMetadata>,
  logs: ReadonlyArray<LogMetadata>,
  workspacePath: string,
) => [
  `run: ${run.runId}`,
  `project: ${run.projectId}`,
  `status: ${run.status}`,
  `workspace: ${workspacePath}`,
  `inputs: ${formatResolvedValues(run.inputs ?? [])}`,
  `outputs: ${formatOutputValues(run.outputs ?? [])}`,
  `reports: ${formatReports(run.reports ?? [])}`,
  "units:",
  ...run.units.map((unit) => `${unit.unitId} ${unit.status}`),
  "events:",
  ...events.map((event) => event._tag),
  "artifacts:",
  ...renderPayloadRefs(artifacts, (artifact) => `${artifact.name} ${artifact.artifactRef}`),
  "logs:",
  ...renderPayloadRefs(logs, (log) => `${log.name} ${log.logRef}`),
]

const renderRunsList = (runs: ReadonlyArray<WorkflowRunState>) => [
  "runs:",
  ...(runs.length === 0
    ? ["-"]
    : runs.map(
        (run) =>
          `${run.runId} project=${run.projectId} workflow=${run.workflowId} status=${run.status} updatedAt=${run.updatedAt.toISOString()}`,
      )),
]

const renderRunState = (run: WorkflowRunState) => [
  `run: ${run.runId}`,
  `project: ${run.projectId}`,
  `workflow: ${run.workflowId}`,
  `plan: ${run.planId}`,
  `status: ${run.status}`,
  `workspace: ${run.execution.options.workspacePath ?? "-"}`,
  `createdAt: ${run.createdAt.toISOString()}`,
  `updatedAt: ${run.updatedAt.toISOString()}`,
  `startedAt: ${formatDate(run.startedAt)}`,
  `finishedAt: ${formatDate(run.finishedAt)}`,
  `progress: ${run.progress.completedUnits}/${run.progress.totalUnits} completed, ${run.progress.failedUnits} failed, ${run.progress.skippedUnits} skipped`,
  `failure: ${run.failure?.message ?? "-"}`,
  `cancellation: ${run.cancellationReason ?? "-"}`,
  `inputs: ${formatResolvedValues(run.inputs ?? [])}`,
  `outputs: ${formatOutputValues(run.outputs ?? [])}`,
  `reports: ${formatReports(run.reports ?? [])}`,
  ...renderTriggerMetadata(run),
  "units:",
  ...run.units.map(
    (unit) =>
      `${unit.unitId} ${unit.status} inputs=${formatResolvedValues(unit.resolvedInputs ?? [])} outputs=${formatOutputValues(unit.outputs ?? [])} reports=${formatReports(unit.reports ?? [])}${unit.cancellationReason === undefined ? "" : ` canceled=${unit.cancellationReason}`}`,
  ),
]

const renderBindingsList = (bindings: ReadonlyArray<GitHubBindingSummary>) => [
  "bindings:",
  ...(bindings.length === 0 ? ["-"] : bindings.flatMap((binding) => renderBindingSummary(binding))),
]

const renderSecretsList = (
  projectId: string,
  secrets: ReadonlyArray<{ readonly key: string; readonly createdAt: Date; readonly updatedAt: Date }>,
) => [
  `project: ${projectId}`,
  "secrets:",
  ...(secrets.length === 0
    ? ["-"]
    : secrets.map((secret) => `${secret.key} updatedAt=${secret.updatedAt.toISOString()}`)),
]

const renderBindingSummary = (binding: GitHubBindingSummary) => [
  `binding: ${binding.bindingId}`,
  `project: ${binding.projectId}`,
  `provider: ${binding.provider}`,
  `installationId: ${binding.installationId ?? "-"}`,
  `repositoryId: ${binding.repositoryId ?? "-"}`,
  `repository: ${binding.repository}`,
  `cloneUrl: ${binding.cloneUrl}`,
  `sourceKind: ${binding.sourceKind}`,
  `branch: ${binding.branch ?? "*"}`,
  `workflowModulePath: ${binding.workflowModulePath}`,
  `workspaceSubdir: ${binding.workspaceSubdir ?? "-"}`,
  `enabled: ${binding.enabled}`,
]

const renderProjectsList = (projects: ReadonlyArray<ProjectSummary>) => [
  "projects:",
  ...(projects.length === 0
    ? ["-"]
    : projects.flatMap((project) => [
        `project: ${project.projectId}`,
        `provider: ${project.provider}`,
        `repository: ${project.repositoryOwner ?? "-"}/${project.repositoryName ?? "-"}`,
        `repositoryId: ${project.repositoryId ?? "-"}`,
        `bindings: ${project.bindingCount}`,
        `runs: ${project.runCount}`,
        `latestRunAt: ${formatDate(project.latestRunAt)}`,
      ])),
]

const renderEventList = (runId: string, events: ReadonlyArray<{ readonly _tag: string; readonly sequence: number }>) => [
  `run: ${runId}`,
  "events:",
  ...(events.length === 0 ? ["-"] : events.map((event) => `${event.sequence} ${event._tag}`)),
]

const renderArtifacts = (runId: string, artifacts: ReadonlyArray<ArtifactMetadata>) => [
  `run: ${runId}`,
  "artifacts:",
  ...renderPayloadRefs(
    artifacts,
    (artifact) => `${artifact.name} ${artifact.artifactRef} status=${artifact.status} summary=${artifact.summary ?? "-"}`,
  ),
]

const renderLogs = (runId: string, logs: ReadonlyArray<LogMetadata>) => [
  `run: ${runId}`,
  "logs:",
  ...renderPayloadRefs(logs, (log) => `${log.name} ${log.logRef} status=${log.status}`),
]

const renderPayloadRefs = <A>(items: ReadonlyArray<A>, render: (item: A) => string) =>
  items.length === 0 ? ["-"] : items.map(render)

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
    `trigger: github`,
    `repository: ${String(trigger.repository ?? "-")}`,
    `ref: ${String(trigger.ref ?? "-")}`,
    `commitSha: ${String(trigger.commitSha ?? "-")}`,
    `binding: ${String(trigger.bindingId ?? "-")}`,
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

const terminalRunStatuses = new Set(["succeeded", "failed", "canceled", "interrupted"])
