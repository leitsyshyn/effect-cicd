import { Console, Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId, WorkflowId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import {
  ContainerCommandDeclaration,
  DependencyDeclaration,
  NamedDeclaration,
  NormalizedWorkflowDefinition,
  UnitDeclaration,
} from "../domain/workflow-definition.ts"
import { Executor, type TestExecutorLayerOptions } from "../engine/executor.ts"
import { Engine } from "../engine/interface.ts"
import { Orchestrator } from "../engine/orchestrator.ts"
import { Planner } from "../engine/planner.ts"
import { ArtifactStore } from "../engine/stores/artifact-store.ts"
import { EventLog } from "../engine/stores/event-log.ts"
import { StateStore } from "../engine/stores/state-store.ts"

export const cliVersion = "0.0.0"

export const makeCliLayer = (options: TestExecutorLayerOptions = {}) =>
  Engine.layer.pipe(
    Layer.provideMerge(Planner.layer),
    Layer.provideMerge(Orchestrator.layer),
    Layer.provideMerge(StateStore.memoryLayer),
    Layer.provideMerge(EventLog.memoryLayer),
    Layer.provideMerge(ArtifactStore.memoryLayer),
    Layer.provideMerge(Executor.testLayer(mergeExecutorOptions(options))),
  )

const validateCommand = Command.make("validate", {}, () =>
  Effect.gen(function* () {
    const engine = yield* Engine

    yield* engine.validate(sampleWorkflow())
    yield* printLines(["workflow workflow:sample is valid"])
  }),
).pipe(Command.withDescription("Validate the built-in sample workflow"))

const planCommand = Command.make("plan", {}, () =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const plan = yield* engine.plan(sampleWorkflow())

    yield* printLines(renderPlanSummary(plan))
  }),
).pipe(Command.withDescription("Plan the built-in sample workflow"))

const runCommand = Command.make("run", {}, () =>
  Effect.gen(function* () {
    const engine = yield* Engine
    const plan = yield* engine.plan(sampleWorkflow())
    const run = yield* engine.startRun(plan)
    const events = yield* engine.readRunEvents(run.runId)
    const artifacts = yield* engine.readArtifacts(run.runId)
    const logs = yield* engine.readLogs(run.runId)

    yield* printLines(renderRunSummary(run, events, artifacts, logs))
  }),
).pipe(Command.withDescription("Run the built-in sample workflow"))

export const cli = Command.make("effect-cicd").pipe(
  Command.withDescription("Minimal Engine-backed CLI MVP"),
  Command.withSubcommands([validateCommand, planCommand, runCommand]),
)

export const cliProgram = Command.run(cli, { version: cliVersion })

export const sampleWorkflow = () =>
  new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:sample"),
    name: "sample workflow",
    metadata: { owner: "cli" },
    units: [
      unit("unit:test", ["bun", "test"], "coverage"),
      unit("unit:deploy", ["bun", "run", "ship"], "release-manifest"),
      unit("unit:build", ["bun", "run", "build"], "dist"),
    ],
    dependencies: [dependency("unit:test", "unit:deploy"), dependency("unit:build", "unit:test")],
    inputs: [],
    outputs: [],
    artifacts: [],
    reports: [],
  })

const printLines = (lines: ReadonlyArray<string>) => Console.log(lines.join("\n"))

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
) => [
  `run: ${run.runId}`,
  `status: ${run.status}`,
  "units:",
  ...run.units.map((unit) => `${unit.unitId} ${unit.status}`),
  "events:",
  ...events.map((event) => event._tag),
  "artifacts:",
  ...renderPayloadRefs(artifacts, (artifact) => `${artifact.name} ${artifact.artifactRef}`),
  "logs:",
  ...renderPayloadRefs(logs, (log) => `${log.name} ${log.logRef}`),
]

const renderPayloadRefs = <A>(items: ReadonlyArray<A>, render: (item: A) => string) =>
  items.length === 0 ? ["-"] : items.map(render)

const formatNames = (names: ReadonlyArray<string>) => (names.length === 0 ? "-" : names.join(", "))

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
      new LogMetadata({
        logRef: LogRef.make(`log:${workflowId}:${unitId}:stdout`),
        runId,
        unitId: brandedUnitId,
        attemptId,
        name: "stdout",
        status: "available",
        summary: logSummary,
      }),
    ],
    artifacts: [
      new ArtifactMetadata({
        artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:${artifactName}`),
        runId,
        unitId: brandedUnitId,
        attemptId,
        name: artifactName,
        category: artifactCategory,
        status: "available",
        summary: `${unitId} artifact`,
      }),
    ],
  } satisfies NonNullable<TestExecutorLayerOptions["resultsByUnitId"]>[string]
}

const unit = (unitId: string, command: [string, ...Array<string>], artifactName: string) =>
  new UnitDeclaration({
    unitId: UnitId.make(unitId),
    name: unitId.replace("unit:", ""),
    payloadDeclaration: new ContainerCommandDeclaration({
      image: "oven/bun:latest",
      command,
      env: { CI: "true" },
    }),
    metadata: {},
    inputs: [],
    outputs: [],
    artifacts: [named(artifactName)],
    policies: [],
  })

const dependency = (from: string, to: string) =>
  new DependencyDeclaration({
    from: UnitId.make(from),
    to: UnitId.make(to),
    metadata: {},
  })

const named = (name: string) =>
  new NamedDeclaration({
    name,
    metadata: {},
  })
