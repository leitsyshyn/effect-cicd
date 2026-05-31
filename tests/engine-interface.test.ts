import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../src/domain/artifacts.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanDependency, PlanUnit } from "../src/domain/execution-plan.ts"
import { ArtifactRef, AttemptId, LogRef, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import {
  ArtifactDeclaration,
  NamedDeclaration,
  NormalizedWorkflowDefinition,
  ContainerCommandDeclaration,
  DependencyDeclaration,
  UnitDeclaration,
} from "../src/domain/workflow-definition.ts"
import { Executor, type TestExecutorLayerOptions } from "../src/engine/executor.ts"
import { Engine } from "../src/engine/interface.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { Planner } from "../src/engine/planner.ts"
import { RunController } from "../src/engine/run-controller.ts"
import { RunUpdates } from "../src/engine/run-updates.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { StorageTransactor } from "../src/runtime/storage.ts"

describe("Engine interface", () => {
  it.effect("validate delegates to Planner for a valid workflow", () =>
    Effect.gen(function* () {
      const engine = yield* Engine

      yield* engine.validate(workflow())
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("plan matches canonical Planner planning behavior", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const planner = yield* Planner
      const definition = workflow({
        units: [unit("unit:test"), unit("unit:deploy"), unit("unit:build")],
        dependencies: [
          dependency("unit:test", "unit:deploy"),
          dependency("unit:build", "unit:test"),
          dependency("unit:build", "unit:deploy"),
        ],
      })

      const enginePlan = yield* engine.plan(definition)
      const plannerPlan = yield* planner.plan(definition)

      expect(enginePlan).toEqual(plannerPlan)
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("startRun and inspectRun expose Orchestrator-managed state", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const started = yield* engine.startRun(plan("workflow:inspect", [planUnit("unit:build")]))
      const inspected = yield* engine.inspectRun(started.runId)

      expect(started.status).toBe("succeeded")
      expect(started.units[0]?.status).toBe("succeeded")
      expect(inspected).toEqual(started)
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("readRunEvents returns the EventLog timeline for a run", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.startRun(plan("workflow:events", [planUnit("unit:build")]))
      const events = yield* engine.readRunEvents(run.runId)

      expect(events.map((event) => event._tag)).toEqual([
        "RunCreated",
        "RunStarted",
        "UnitReady",
        "UnitDispatched",
        "AttemptStarted",
        "LogRegistered",
        "ArtifactRegistered",
        "AttemptSucceeded",
        "UnitSucceeded",
        "RunSucceeded",
      ])
    }).pipe(Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:events", "unit:build") } }))),
  )

  it.effect("readArtifacts returns run artifact summaries through Engine", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.startRun(plan("workflow:artifacts", [planUnit("unit:build")]))
      const artifacts = yield* engine.readArtifacts(run.runId)

      expect(artifacts).toEqual(run.artifacts)
      expect(artifacts).toEqual([
        new ArtifactMetadata({
          artifactRef: ArtifactRef.make(`artifact:attempt:${run.runId}:unit:build:1:dist`),
          runId: run.runId,
          unitId: UnitId.make("unit:build"),
          attemptId: AttemptId.make(`attempt:${run.runId}:unit:build:1`),
          name: "dist",
          category: "build-output",
          status: "available",
          summary: "unit artifact",
        }),
      ])
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:artifacts", "unit:build") } })),
    ),
  )

  it.effect("readLogs returns run log summaries through Engine", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.startRun(plan("workflow:logs", [planUnit("unit:build")]))
      const logs = yield* engine.readLogs(run.runId)

      expect(logs).toEqual(run.logs)
      expect(logs).toEqual([
        new LogMetadata({
          logRef: LogRef.make(`log:attempt:${run.runId}:unit:build:1:stdout`),
          runId: run.runId,
          unitId: UnitId.make("unit:build"),
          attemptId: AttemptId.make(`attempt:${run.runId}:unit:build:1`),
          name: "stdout",
          status: "available",
          summary: "unit stdout",
        }),
      ])
    }).pipe(Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:logs", "unit:build") } }))),
  )

  it.effect("readArtifactPayload returns persisted artifact content through Engine", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const run = yield* engine.startRun(plan("workflow:artifact-payload", [planUnit("unit:build")]))
      const payload = yield* engine.readArtifactPayload(run.artifacts[0]!.artifactRef)

      expect(payload).toContain('"artifact":"dist"')
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:artifact-payload", "unit:build") } })),
    ),
  )

  it.effect("composed runtime layer works end-to-end", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const definition = workflow({
        workflowId: WorkflowId.make("workflow:e2e"),
        units: [unit("unit:build")],
      })

      yield* engine.validate(definition)
      const executionPlan = yield* engine.plan(definition)
      const run = yield* engine.startRun(executionPlan)
      const inspected = yield* engine.inspectRun(run.runId)
      const events = yield* engine.readRunEvents(run.runId)
      const artifacts = yield* engine.readArtifacts(run.runId)
      const logs = yield* engine.readLogs(run.runId)

      expect(executionPlan.workflowId).toBe(WorkflowId.make("workflow:e2e"))
      expect(inspected.status).toBe("succeeded")
      expect(events.map((event) => event._tag)).toContain("RunSucceeded")
      expect(artifacts).toHaveLength(1)
      expect(logs).toHaveLength(1)
    }).pipe(Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:e2e", "unit:build") } }))),
  )

  it.effect("failed upstream units surface failed run state and RunFailed events", () =>
    Effect.gen(function* () {
      const engine = yield* Engine
      const started = yield* engine.startRun(
        plan(
          "workflow:failure",
          [planUnit("unit:build"), planUnit("unit:test", ["unit:build"])],
          [planDependency("unit:build", "unit:test")],
        ),
      )
      const inspected = yield* engine.inspectRun(started.runId)
      const events = yield* engine.readRunEvents(started.runId)

      expect(inspected.status).toBe("failed")
      expect(inspected.units.find((workflowUnit) => workflowUnit.unitId === UnitId.make("unit:build"))?.status).toBe("failed")
      expect(inspected.units.find((workflowUnit) => workflowUnit.unitId === UnitId.make("unit:test"))?.status).toBe("skipped")
      expect(events.map((event) => event._tag)).toContain("RunFailed")
    }).pipe(
      Effect.provide(
        runtimeLayer({
          resultsByUnitId: {
            "unit:build": {
              outcome: "failed",
            },
          },
        }),
      ),
    ),
  )
})

const runtimeLayer = (options: TestExecutorLayerOptions = {}) =>
  {
    const updatesLayer = RunUpdates.noopLayer
    const orchestratorLayer = Orchestrator.layer.pipe(
      Layer.provideMerge(StorageTransactor.memoryLayer),
      Layer.provideMerge(StateStore.memoryLayer),
      Layer.provideMerge(EventLog.memoryLayer),
      Layer.provideMerge(ArtifactStore.memoryLayer),
      Layer.provideMerge(Executor.testLayer(options)),
      Layer.provideMerge(updatesLayer),
    )
    const runControllerLayer = RunController.layer.pipe(Layer.provideMerge(orchestratorLayer))

    return Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(StorageTransactor.memoryLayer),
      Layer.provideMerge(StateStore.memoryLayer),
      Layer.provideMerge(EventLog.memoryLayer),
      Layer.provideMerge(ArtifactStore.memoryLayer),
      Layer.provideMerge(updatesLayer),
    )
  }

const workflow = (overrides: Partial<ConstructorParameters<typeof NormalizedWorkflowDefinition>[0]> = {}) =>
  new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:test"),
    name: "test workflow",
    metadata: { owner: "ci" },
    units: [unit("unit:build")],
    dependencies: [],
    inputs: [],
    outputs: [],
    artifacts: [],
    reports: [],
    ...overrides,
  })

const unit = (unitId: string, overrides: Partial<ConstructorParameters<typeof UnitDeclaration>[0]> = {}) =>
  new UnitDeclaration({
    unitId: UnitId.make(unitId),
    name: unitId.replace("unit:", ""),
    payloadDeclaration: new ContainerCommandDeclaration({
      image: "oven/bun:latest",
      command: ["bun", "test"],
    }),
    metadata: {},
    inputs: [],
    outputs: [],
    artifacts: [],
    policies: [],
    ...overrides,
  })

const dependency = (from: string, to: string) =>
  new DependencyDeclaration({
    from: UnitId.make(from),
    to: UnitId.make(to),
    metadata: {},
  })

const plan = (
  workflowId: string,
  units: ReadonlyArray<PlanUnit>,
  dependencies: ReadonlyArray<PlanDependency> = [],
) =>
  new ExecutionPlan({
    planId: PlanId.make(`plan:${workflowId}`),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make(workflowId),
    workflowName: workflowId.replace("workflow:", ""),
    metadata: {},
    units,
    dependencies,
    diagnostics: [],
  })

const planUnit = (unitId: string, dependencies: ReadonlyArray<string> = []) =>
  new PlanUnit({
    unitId: UnitId.make(unitId),
    name: unitId.replace("unit:", ""),
    dependencies: dependencies.map((dependency) => UnitId.make(dependency)),
    payloadDescriptor: new ContainerCommandDescriptor({
      image: "oven/bun:latest",
      command: ["bun", "test"],
      env: {},
    }),
    logExpectations: [named("stdout")],
    artifactExpectations: [artifact("dist")],
    policies: [],
    diagnostics: [],
  })

const planDependency = (from: string, to: string) =>
  new PlanDependency({
    from: UnitId.make(from),
    to: UnitId.make(to),
  })

const named = (name: string) =>
  new NamedDeclaration({
    name,
    metadata: {},
  })

const artifact = (name: string) =>
  new ArtifactDeclaration({
    name,
    kind: "file",
    path: `artifacts/${name}.txt`,
    contentType: "text/plain",
    metadata: {},
  })

const successPayloads = (workflowId: string, unitId: string) => {
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
          summary: "unit stdout",
        }),
        content: "unit stdout\n",
      }),
    ],
    artifacts: [
      new RegisteredArtifact({
        metadata: new ArtifactMetadata({
          artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:dist`),
          runId,
          unitId: brandedUnitId,
          attemptId,
          name: "dist",
          category: "build-output",
          status: "available",
          summary: "unit artifact",
        }),
        payloadBase64: Buffer.from(JSON.stringify({ workflowId, unitId, artifact: "dist" }) + "\n").toString("base64"),
        contentType: "application/json",
      }),
    ],
  } satisfies NonNullable<TestExecutorLayerOptions["resultsByUnitId"]>[string]
}
