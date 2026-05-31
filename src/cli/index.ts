import { Console, Effect, Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { dirname, resolve as resolvePath } from "node:path"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../domain/artifacts.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { Executor, LocalContainerExecutor, type TestExecutorLayerOptions } from "../engine/executor.ts"
import { Engine } from "../engine/interface.ts"
import { Orchestrator } from "../engine/orchestrator.ts"
import { Planner } from "../engine/planner.ts"
import { ArtifactStore } from "../engine/stores/artifact-store.ts"
import { EventLog } from "../engine/stores/event-log.ts"
import { StateStore } from "../engine/stores/state-store.ts"
import { StorageRuntimeConfig } from "../runtime/config.ts"
import { ObjectStorageClient, StorageTransactor, sqlClientLayer, storageMigrationLayer } from "../runtime/storage.ts"

export const cliVersion = "0.0.0"

export const makeCliLayer = (options: TestExecutorLayerOptions = {}) =>
  Layer.mergeAll(
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(Orchestrator.layer),
      Layer.provideMerge(StorageTransactor.memoryLayer),
      Layer.provideMerge(StateStore.memoryLayer),
      Layer.provideMerge(EventLog.memoryLayer),
      Layer.provideMerge(ArtifactStore.memoryLayer),
      Layer.provideMerge(Executor.testLayer(mergeExecutorOptions(options))),
    ),
  )

export const makeDurableStorageLayer = () =>
  {
    const sqlLayer = sqlClientLayer
    const objectStorageLayer = ObjectStorageClient.layer

    return Layer.mergeAll(
      storageMigrationLayer.pipe(Layer.provideMerge(sqlLayer)),
      StorageTransactor.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
      StateStore.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
      EventLog.postgresLayer.pipe(Layer.provideMerge(sqlLayer)),
      ArtifactStore.s3Layer.pipe(
        Layer.provideMerge(sqlLayer),
        Layer.provideMerge(objectStorageLayer),
      ),
    )
  }

export const makeAppLayer = () => {
  const durableStorageLayer = makeDurableStorageLayer()
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(durableStorageLayer),
    Layer.provideMerge(LocalContainerExecutor.layer),
  )

  return Layer.mergeAll(
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    StorageRuntimeConfig.layer,
    orchestratorLayer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(durableStorageLayer),
    ),
  )
}

export const appProgram = Effect.gen(function* () {
  const runtimeConfig = yield* StorageRuntimeConfig

  if (runtimeConfig.runRecoveryOnStartup) {
    const orchestrator = yield* Orchestrator
    yield* orchestrator.resumeIncompleteRuns()
  }

  yield* cliProgram
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
  { workflowModule: workflowModuleArg, exportName: exportNameFlag, workspace: workspaceFlag },
  ({ workflowModule, exportName, workspace }) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const resolvedWorkspace = yield* resolveWorkspacePath(workflowModule, workspace)
    const definition = yield* loadAndMaterializeWorkflow(workflowModule, Option.getOrUndefined(exportName))
    const plan = yield* engine.plan(definition)
    const run = yield* engine.startRun(plan, { workspacePath: resolvedWorkspace })
    const events = yield* engine.readRunEvents(run.runId)
    const artifacts = yield* engine.readArtifacts(run.runId)
    const logs = yield* engine.readLogs(run.runId)

    yield* printLines(renderRunSummary(run, events, artifacts, logs, resolvedWorkspace))
  }),
).pipe(Command.withDescription("Run a workflow module (default export or named export `workflow`)"))

const runsListCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const runs = yield* engine.listRuns()

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
  ]),
)

export const cli = Command.make("effect-cicd").pipe(
  Command.withDescription("Minimal Engine-backed CLI MVP"),
  Command.withSubcommands([validateCommand, planCommand, runCommand, runsCommand]),
)

export const cliProgram = Command.run(cli, { version: cliVersion })

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
  `status: ${run.status}`,
  `workspace: ${workspacePath}`,
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
          `${run.runId} workflow=${run.workflowId} status=${run.status} updatedAt=${run.updatedAt.toISOString()}`,
      )),
]

const renderRunState = (run: WorkflowRunState) => [
  `run: ${run.runId}`,
  `workflow: ${run.workflowId}`,
  `plan: ${run.planId}`,
  `status: ${run.status}`,
  `createdAt: ${run.createdAt.toISOString()}`,
  `updatedAt: ${run.updatedAt.toISOString()}`,
  `startedAt: ${formatDate(run.startedAt)}`,
  `finishedAt: ${formatDate(run.finishedAt)}`,
  `progress: ${run.progress.completedUnits}/${run.progress.totalUnits} completed, ${run.progress.failedUnits} failed, ${run.progress.skippedUnits} skipped`,
  `failure: ${run.failure?.message ?? "-"}`,
  "units:",
  ...run.units.map((unit) => `${unit.unitId} ${unit.status}`),
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

const formatDate = (value: Date | undefined) => (value === undefined ? "-" : value.toISOString())

const mergeExecutorOptions = (options: TestExecutorLayerOptions): TestExecutorLayerOptions => {
  return {
    ...(options.requests === undefined ? {} : { requests: options.requests }),
    resultsByUnitId: {
      ...sampleExecutorResultsByUnitId(),
      ...(options.resultsByUnitId ?? {}),
    },
  }
}

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
