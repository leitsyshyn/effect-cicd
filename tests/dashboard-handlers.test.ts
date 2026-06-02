import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { ArtifactMetadata, LogMetadata } from "../src/domain/artifacts.ts"
import { RunCreated, RunStarted, UnitSucceeded } from "../src/domain/events.ts"
import { PlanId, ProjectId, RunId, UnitId, WorkflowId, AttemptId, ArtifactRef, LogRef, EventId } from "../src/domain/ids.ts"
import { ExecutionAttemptState, ExecutionUnitState, ProgressSummary, RunExecutionContext, RunExecutionOptions, WorkflowRunState } from "../src/domain/runtime-state.ts"
import { ExecutionPlan, PlanDependency, PlanUnit, ContainerCommandDescriptor } from "../src/domain/execution-plan.ts"
import { NamedDeclaration, ArtifactDeclaration } from "../src/domain/workflow-definition.ts"
import { createDashboardHandlers } from "../src/dashboard/handlers.ts"

describe("dashboard route handlers", () => {
  it.effect("listRuns returns Engine-backed run summaries", () =>
    Effect.gen(function* () {
      let called = false
      const run = sampleRun()
      const handlers = createDashboardHandlers({
        listRuns: () =>
          Effect.sync(() => {
            called = true
            return [run] as const
          }),
        inspectRun: () => Effect.die("unused"),
        readRunEvents: () => Effect.die("unused"),
        readArtifacts: () => Effect.die("unused"),
        readArtifactPayload: () => Effect.die("unused"),
        readLogs: () => Effect.die("unused"),
        readLogPayload: () => Effect.die("unused"),
        cancelRun: () => Effect.die("unused"),
        retryRun: () => Effect.die("unused"),
        gcRunArtifacts: () => Effect.die("unused"),
        version: () => Effect.die("unused"),
      })

      const response = yield* Effect.promise(() => handlers.listRuns())
      const payload = yield* Effect.promise(() => response.json() as Promise<Array<{ readonly runId: string; readonly workflowId: string }>>)

      expect(called).toBe(true)
      expect(payload).toEqual([{ runId: run.runId, projectId: run.projectId, planId: run.planId, workflowId: run.workflowId, workflowName: "dashboard", status: "succeeded", createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), startedAt: run.startedAt!.toISOString(), finishedAt: run.finishedAt!.toISOString(), durationMs: 4_000, progress: { totalUnits: 2, completedUnits: 2, failedUnits: 0, skippedUnits: 0 }, controls: { canCancel: false, canRetry: true, canGc: true } }])
    }),
  )

  it.effect("inspectRun returns stage-grouped DAG detail and payload metadata", () =>
    Effect.gen(function* () {
      const run = sampleRun()
      const events = [
        new RunCreated({ eventId: EventId.make("event:1"), runId: run.runId, occurredAt: new Date("2026-01-01T00:00:00.000Z"), sequence: 0 }),
        new RunStarted({ eventId: EventId.make("event:2"), runId: run.runId, occurredAt: new Date("2026-01-01T00:00:00.100Z"), sequence: 1 }),
        new UnitSucceeded({ eventId: EventId.make("event:3"), runId: run.runId, occurredAt: new Date("2026-01-01T00:00:02.000Z"), sequence: 2, unitId: UnitId.make("unit:build") }),
      ]
      const handlers = createDashboardHandlers({
        listRuns: () => Effect.die("unused"),
        inspectRun: () => Effect.succeed(run),
        readRunEvents: () => Effect.succeed(events),
        readArtifacts: () => Effect.succeed(run.artifacts),
        readArtifactPayload: () => Effect.succeed('{"artifact":"dist"}\n'),
        readLogs: () => Effect.succeed(run.logs),
        readLogPayload: () => Effect.succeed("build stdout\n"),
        cancelRun: () => Effect.die("unused"),
        retryRun: () => Effect.die("unused"),
        gcRunArtifacts: () => Effect.die("unused"),
        version: () => Effect.die("unused"),
      })

      const response = yield* Effect.promise(() => handlers.inspectRun(run.runId))
      const payload = yield* Effect.promise(() => response.json() as Promise<any>)

      expect(payload.run.runId).toBe(run.runId)
      expect(payload.stages.map((stage: any) => stage.label)).toEqual(["Stage 1 · build", "Stage 2 · test"])
      expect(payload.stages[1].units[0].dependencies).toEqual(["unit:build"])
      expect(payload.logs[0].name).toBe("stdout")
      expect(payload.artifacts[0].name).toBe("dist")
      expect(payload.events[2].type).toBe("UnitSucceeded")
      expect(payload.units[0].command).toBe("bun test")
      expect(payload.source.projectId).toBe("project:dashboard")
    }),
  )

  it.effect("cancelRun delegates to Engine control surface", () =>
    Effect.gen(function* () {
      let capturedReason: string | undefined
      const run = sampleRun()
      const handlers = createDashboardHandlers({
        listRuns: () => Effect.die("unused"),
        inspectRun: () => Effect.die("unused"),
        readRunEvents: () => Effect.die("unused"),
        readArtifacts: () => Effect.die("unused"),
        readArtifactPayload: () => Effect.die("unused"),
        readLogs: () => Effect.die("unused"),
        readLogPayload: () => Effect.die("unused"),
        cancelRun: (_runId, reason) => Effect.sync(() => {
          capturedReason = reason
          return run
        }),
        retryRun: () => Effect.die("unused"),
        gcRunArtifacts: () => Effect.die("unused"),
        version: () => Effect.die("unused"),
      })

      const response = yield* Effect.promise(() => handlers.cancelRun(run.runId, "Canceled from test"))
      const payload = yield* Effect.promise(() => response.json() as Promise<any>)

      expect(capturedReason).toBe("Canceled from test")
      expect(payload.controls.canRetry).toBe(true)
    }),
  )
})

const sampleRun = () => {
  const runId = RunId.make("run:dashboard:test")
  const buildAttemptId = AttemptId.make(`attempt:${runId}:unit:build:1`)
  const testAttemptId = AttemptId.make(`attempt:${runId}:unit:test:1`)
  const artifact = new ArtifactMetadata({
    artifactRef: ArtifactRef.make(`artifact:${runId}:dist`),
    runId,
    unitId: UnitId.make("unit:build"),
    attemptId: buildAttemptId,
    name: "dist",
    category: "build-output",
    status: "available",
    summary: "build output",
  })
  const log = new LogMetadata({
    logRef: LogRef.make(`log:${runId}:stdout`),
    runId,
    unitId: UnitId.make("unit:build"),
    attemptId: buildAttemptId,
    name: "stdout",
    status: "available",
    summary: "build stdout",
  })

  return new WorkflowRunState({
    runId,
    projectId: ProjectId.make("project:dashboard"),
    workflowId: WorkflowId.make("workflow:dashboard"),
    planId: PlanId.make("plan:dashboard"),
    execution: new RunExecutionContext({
      plan: new ExecutionPlan({
        planId: PlanId.make("plan:dashboard"),
        schemaVersion: "0.1.0",
        workflowId: WorkflowId.make("workflow:dashboard"),
        workflowName: "dashboard",
        metadata: {},
        units: [
          new PlanUnit({
            unitId: UnitId.make("unit:build"),
            name: "build",
            dependencies: [],
            payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
            logExpectations: [new NamedDeclaration({ name: "stdout", metadata: {} })],
            artifactExpectations: [
              new ArtifactDeclaration({ name: "dist", kind: "file", path: "dist/output.txt", metadata: {} }),
            ],
            policies: [],
            diagnostics: [],
          }),
          new PlanUnit({
            unitId: UnitId.make("unit:test"),
            name: "test",
            dependencies: [UnitId.make("unit:build")],
            payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
            logExpectations: [],
            artifactExpectations: [],
            policies: [],
            diagnostics: [],
          }),
        ],
        dependencies: [new PlanDependency({ from: UnitId.make("unit:build"), to: UnitId.make("unit:test") })],
        diagnostics: [],
      }),
      options: new RunExecutionOptions({ workspacePath: "/repo/examples" }),
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    status: "succeeded",
    units: [
      new ExecutionUnitState({
        runId,
        unitId: UnitId.make("unit:build"),
        status: "succeeded",
        dependencies: [],
        latestAttemptId: buildAttemptId,
        attempts: [
          new ExecutionAttemptState({
            attemptId: buildAttemptId,
            runId,
            unitId: UnitId.make("unit:build"),
            attemptNumber: 1,
            status: "succeeded",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            finishedAt: new Date("2026-01-01T00:00:02.000Z"),
            artifacts: [artifact],
            logs: [log],
          }),
        ],
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:02.000Z"),
        artifacts: [artifact],
        logs: [log],
      }),
      new ExecutionUnitState({
        runId,
        unitId: UnitId.make("unit:test"),
        status: "succeeded",
        dependencies: [UnitId.make("unit:build")],
        latestAttemptId: testAttemptId,
        attempts: [
          new ExecutionAttemptState({
            attemptId: testAttemptId,
            runId,
            unitId: UnitId.make("unit:test"),
            attemptNumber: 1,
            status: "succeeded",
            startedAt: new Date("2026-01-01T00:00:02.500Z"),
            finishedAt: new Date("2026-01-01T00:00:04.000Z"),
            artifacts: [],
            logs: [],
          }),
        ],
        startedAt: new Date("2026-01-01T00:00:02.500Z"),
        finishedAt: new Date("2026-01-01T00:00:04.000Z"),
        artifacts: [],
        logs: [],
      }),
    ],
    progress: new ProgressSummary({ totalUnits: 2, completedUnits: 2, failedUnits: 0, skippedUnits: 0 }),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:04.000Z"),
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:04.000Z"),
    artifacts: [artifact],
    logs: [log],
  })
}
