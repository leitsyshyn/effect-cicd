import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type * as Duration from "effect/Duration"
import { TestClock } from "effect/testing"

import { ContainerCommandDescriptor, ExecutionPlan, PlanUnit } from "../src/domain/execution-plan.ts"
import { AttemptId, PlanId, ProjectId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { deriveGitHubProjectId } from "../src/domain/project.ts"
import { Engine } from "../src/engine/interface.ts"
import { Executor, ExecutorResult, type TestExecutorLayerOptions } from "../src/engine/executor.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { Planner } from "../src/engine/planner.ts"
import { RunController } from "../src/engine/run-controller.ts"
import { RunUpdates } from "../src/engine/run-updates.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { SchedulerConfig } from "../src/runtime/config.ts"
import { StorageTransactor } from "../src/runtime/storage.ts"
import { SecretStore } from "../src/secrets/store.ts"

describe("project scheduling", () => {
  it("derives stable project ids from GitHub repository identity", () => {
    expect(deriveGitHubProjectId(42, "Acme", "Widgets")).toBe(ProjectId.make("project:github:repo:42"))
    expect(deriveGitHubProjectId(undefined, "Acme", "Widgets")).toBe(ProjectId.make("project:github:acme/widgets"))
  })

  it.effect("submissions are queued first and later completed by the scheduler", () =>
    Effect.gen(function* () {
      const engine = yield* Engine

      const submitted = yield* engine.submitRun(plan("workflow:queued", "project:test:queued"))
      expect(submitted.status).toBe("queued")

      yield* TestClock.adjust("1 second")

      const completed = yield* engine.inspectRun(submitted.runId)
      expect(completed.status).toBe("succeeded")
    }).pipe(Effect.provide(runtimeLayer({ maxConcurrentRuns: 1, maxConcurrentRunsPerProject: 1, unitDuration: "1 second" }))),
  )

  it.effect("enforces a global concurrency limit", () =>
    Effect.gen(function* () {
      const engine = yield* Engine

      const first = yield* engine.submitRun(plan("workflow:first", "project:test:first", "unit:first"))
      const second = yield* engine.submitRun(plan("workflow:second", "project:test:second", "unit:second"))

      yield* TestClock.adjust("1 millis")

      const [firstRun, secondRun] = yield* Effect.all([engine.inspectRun(first.runId), engine.inspectRun(second.runId)])
      expect([firstRun.status, secondRun.status].filter((status) => status === "running")).toHaveLength(1)
      expect([firstRun.status, secondRun.status].filter((status) => status === "queued")).toHaveLength(1)
    }).pipe(Effect.provide(runtimeLayer({ maxConcurrentRuns: 1, maxConcurrentRunsPerProject: 2, unitDuration: "1 hour" }))),
  )

  it.effect("applies per-project limits fairly across projects", () =>
    Effect.gen(function* () {
      const engine = yield* Engine

      const firstA = yield* engine.submitRun(plan("workflow:a1", "project:test:alpha", "unit:a1"))
      const secondA = yield* engine.submitRun(plan("workflow:a2", "project:test:alpha", "unit:a2"))
      const firstB = yield* engine.submitRun(plan("workflow:b1", "project:test:beta", "unit:b1"))

      yield* TestClock.adjust("1 millis")

      const runs = yield* Effect.all([
        engine.inspectRun(firstA.runId),
        engine.inspectRun(secondA.runId),
        engine.inspectRun(firstB.runId),
      ])

      expect(runs.find((run) => run.runId === firstA.runId)?.status).toBe("running")
      expect(runs.find((run) => run.runId === secondA.runId)?.status).toBe("queued")
      expect(runs.find((run) => run.runId === firstB.runId)?.status).toBe("running")
    }).pipe(Effect.provide(runtimeLayer({ maxConcurrentRuns: 2, maxConcurrentRunsPerProject: 1, unitDuration: "1 hour" }))),
  )

  it.effect("filters inspection results by project id", () =>
    Effect.gen(function* () {
      const engine = yield* Engine

      yield* engine.submitRun(plan("workflow:alpha", "project:test:alpha", "unit:alpha"))
      yield* engine.submitRun(plan("workflow:beta", "project:test:beta", "unit:beta"))
      yield* TestClock.adjust("1 second")

      const alphaRuns = yield* engine.listRuns("project:test:alpha")
      expect(alphaRuns).toHaveLength(1)
      expect(alphaRuns[0]?.projectId).toBe(ProjectId.make("project:test:alpha"))
    }).pipe(Effect.provide(runtimeLayer({ maxConcurrentRuns: 2, maxConcurrentRunsPerProject: 2, unitDuration: "1 second" }))),
  )
})

interface RuntimeLayerOptions {
  readonly maxConcurrentRuns: number
  readonly maxConcurrentRunsPerProject: number
  readonly unitDuration: Duration.Input
}

const runtimeLayer = (options: RuntimeLayerOptions) => {
  const updatesLayer = RunUpdates.noopLayer
  const schedulerLayer = Layer.succeed(SchedulerConfig, {
    maxConcurrentRuns: options.maxConcurrentRuns,
    maxConcurrentRunsPerProject: options.maxConcurrentRunsPerProject,
  })
  const executorLayer = Executor.testLayer({
    resultsByUnitId: Object.fromEntries(
      ["unit:build", "unit:first", "unit:second", "unit:a1", "unit:a2", "unit:b1", "unit:alpha", "unit:beta"].map((unitId) => [
        unitId,
        {
          execute: (request) =>
            Effect.sleep(options.unitDuration).pipe(
              Effect.as(successResult(request.runId, request.unitId, request.attemptId, request.attemptNumber)),
            ),
        },
      ]),
    ),
  } satisfies TestExecutorLayerOptions)
  const stateLayer = StateStore.memoryLayer
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(StorageTransactor.memoryLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(EventLog.memoryLayer),
    Layer.provideMerge(ArtifactStore.memoryLayer),
    Layer.provideMerge(SecretStore.memoryLayer),
    Layer.provideMerge(executorLayer),
    Layer.provideMerge(updatesLayer),
  )
  const runControllerLayer = RunController.layer.pipe(
    Layer.provideMerge(orchestratorLayer),
    Layer.provideMerge(stateLayer),
    Layer.provideMerge(schedulerLayer),
  )

  return Layer.mergeAll(
    StorageTransactor.memoryLayer,
    stateLayer,
    EventLog.memoryLayer,
    ArtifactStore.memoryLayer,
    SecretStore.memoryLayer,
    executorLayer,
    updatesLayer,
    schedulerLayer,
    orchestratorLayer,
    runControllerLayer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(StorageTransactor.memoryLayer),
      Layer.provideMerge(stateLayer),
      Layer.provideMerge(EventLog.memoryLayer),
      Layer.provideMerge(ArtifactStore.memoryLayer),
      Layer.provideMerge(SecretStore.memoryLayer),
      Layer.provideMerge(updatesLayer),
    ),
  )
}

const plan = (workflowId: string, projectId: string, unitId = "unit:build") =>
  new ExecutionPlan({
    planId: PlanId.make(`plan:${workflowId}`),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make(workflowId),
    workflowName: workflowId.replace("workflow:", ""),
    metadata: { projectId },
    units: [
      new PlanUnit({
        unitId: UnitId.make(unitId),
        name: unitId.replace("unit:", ""),
        dependencies: [],
        payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
        logExpectations: [],
        artifactExpectations: [],
        policies: [],
        diagnostics: [],
      }),
    ],
    dependencies: [],
    diagnostics: [],
  })

const successResult = (runId: RunId, unitId: UnitId, attemptId: AttemptId, attemptNumber: number) =>
  new ExecutorResult({
    runId,
    unitId,
    attemptId,
    attemptNumber,
    outcome: "succeeded",
    exitCode: 0,
    outputs: {},
    reports: [],
    artifacts: [],
    logs: [],
    diagnostics: [],
  })
