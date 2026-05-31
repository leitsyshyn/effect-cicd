import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { TestConsole } from "effect/testing"
import { CliOutput, Command } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { cli, cliVersion, makeDurableStorageLayer } from "../src/cli/index.ts"
import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../src/domain/artifacts.ts"
import { ArtifactRef, AttemptId, EventId, LogRef, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { RunCreated } from "../src/domain/events.ts"
import { ProgressSummary, WorkflowRunState, ExecutionAttemptState, ExecutionUnitState } from "../src/domain/runtime-state.ts"
import { DslMaterializer } from "../src/dsl/index.ts"
import { Executor, type TestExecutorLayerOptions } from "../src/engine/executor.ts"
import { Engine } from "../src/engine/interface.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { Planner } from "../src/engine/planner.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { StorageRuntimeConfig } from "../src/runtime/config.ts"
import { WorkflowModuleLoader } from "../src/dsl/loader.ts"

describe("durable storage integration", () => {
  it.live("persists run state, events, and log payloads across fresh runtimes", () => {
    if (!storageIntegrationEnabled) {
      return Effect.void
    }

      return Effect.gen(function* () {
      const runOutput = yield* runCli(["run", "./tests/fixtures/workflows/valid-workflow.ts"], durableCliLayer())
      const runId = parseLineValue(runOutput, "run: ")

      const listOutput = yield* runCli(["runs", "list"], durableCliLayer())
      const showOutput = yield* runCli(["runs", "show", runId], durableCliLayer())
      const logsOutput = yield* runCli(["runs", "logs", runId], durableCliLayer())
      const logRef = parseLogRef(logsOutput)
      const logOutput = yield* runCli(["runs", "log", logRef], durableCliLayer())

      expect(listOutput).toContain(runId)
      expect(showOutput).toContain(`run: ${runId}`)
      expect(showOutput).toContain("unit:build succeeded")
      expect(logOutput).toContain(logRef)
      expect(logOutput).toContain("build stdout")
    })
  })

  it.live("supports direct durable store round-trips", () => {
    if (!storageIntegrationEnabled) {
      return Effect.void
    }

    const runId = RunId.make(`run:storage:${crypto.randomUUID()}`)
    const attemptId = AttemptId.make(`attempt:${runId}:unit:build:1`)
    const run = new WorkflowRunState({
      runId,
      workflowId: WorkflowId.make(`workflow:storage:${crypto.randomUUID()}`),
      planId: PlanId.make(`plan:storage:${crypto.randomUUID()}`),
      status: "running",
      units: [
        new ExecutionUnitState({
          runId,
          unitId: UnitId.make("unit:build"),
          status: "running",
          dependencies: [],
          latestAttemptId: attemptId,
          attempts: [
            new ExecutionAttemptState({
              attemptId,
              runId,
              unitId: UnitId.make("unit:build"),
              attemptNumber: 1,
              status: "running",
              startedAt: new Date(),
              artifacts: [],
              logs: [],
            }),
          ],
          startedAt: new Date(),
          artifacts: [],
          logs: [],
        }),
      ],
      progress: new ProgressSummary({
        totalUnits: 1,
        completedUnits: 0,
        failedUnits: 0,
        skippedUnits: 0,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
      artifacts: [],
      logs: [],
    })

    const log = new RegisteredLog({
      metadata: new LogMetadata({
        logRef: LogRef.make(`log:${attemptId}:stdout`),
        runId,
        unitId: UnitId.make("unit:build"),
        attemptId,
        name: "stdout",
        status: "available",
        summary: "integration stdout",
      }),
      content: "integration stdout\n",
    })

    const artifact = new RegisteredArtifact({
      metadata: new ArtifactMetadata({
        artifactRef: ArtifactRef.make(`artifact:${attemptId}:dist`),
        runId,
        unitId: UnitId.make("unit:build"),
        attemptId,
        name: "dist",
        category: "build-output",
        status: "available",
        summary: "integration artifact",
      }),
    })

    return Effect.gen(function* () {
      const stateStore = yield* StateStore
      const eventLog = yield* EventLog
      const artifactStore = yield* ArtifactStore

      yield* stateStore.createRun(run)
      yield* eventLog.append(
        new RunCreated({
          eventId: EventId.make(`event:${runId}:0`),
          runId,
          occurredAt: new Date(),
          sequence: 0,
        }),
      )
      yield* artifactStore.registerArtifact(artifact)
      yield* artifactStore.registerLog(log)

      const storedRun = yield* stateStore.getRun(runId)
      const runs = yield* stateStore.listRuns()
      const events = yield* eventLog.readRunEvents(runId)
      const storedLog = yield* artifactStore.readLog(log.metadata.logRef)
      const payload = yield* artifactStore.readLogPayload(log.metadata.logRef)

      expect(storedRun.runId).toBe(runId)
      expect(runs.some((candidate) => candidate.runId === runId)).toBe(true)
      expect(events.map((event) => event._tag)).toContain("RunCreated")
      expect(storedLog.logRef).toBe(log.metadata.logRef)
      expect(payload).toContain("integration stdout")
    }).pipe(Effect.provide(durableStoreLayer()))
  })

  it.live("recovers incomplete runs as interrupted without replay", () => {
    if (!storageIntegrationEnabled) {
      return Effect.void
    }

    const run = interruptedSeedRun(`workflow:recover:${crypto.randomUUID()}`)

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const stateStore = yield* StateStore
        const eventLog = yield* EventLog

        yield* stateStore.createRun(run)
        yield* eventLog.append(
          new RunCreated({
            eventId: EventId.make(`event:${run.runId}:0`),
            runId: run.runId,
            occurredAt: new Date(0),
            sequence: 0,
          }),
        )
      }).pipe(Effect.provide(durableStoreLayer()))

      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        yield* orchestrator.resumeIncompleteRuns()
      }).pipe(Effect.provide(durableOrchestratorLayer()))

      const { stored, events } = yield* Effect.gen(function* () {
        const stateStore = yield* StateStore
        const eventLog = yield* EventLog

        return {
          stored: yield* stateStore.getRun(run.runId),
          events: yield* eventLog.readRunEvents(run.runId),
        }
      }).pipe(Effect.provide(durableStoreLayer()))

      expect(stored.status).toBe("interrupted")
      expect(stored.units[0]?.attempts[0]?.status).toBe("interrupted")
      expect(events.map((event) => event._tag)).toEqual(["RunCreated", "RunInterrupted"])
    })
  })
})

const durableStoreLayer = () =>
  makeDurableStorageLayer().pipe(
    Layer.provideMerge(storageSupportLayer),
    Layer.provideMerge(storageConfigLayer(false)),
  )

const durableOrchestratorLayer = () => {
  const storageLayer = durableStoreLayer()

  return Layer.mergeAll(
    storageLayer,
    Orchestrator.layer.pipe(
      Layer.provideMerge(storageLayer),
      Layer.provideMerge(Executor.testLayer()),
    ),
  )
}

const durableCliLayer = (options: TestExecutorLayerOptions = {}) => {
  const storageLayer = durableStoreLayer()
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(storageLayer),
    Layer.provideMerge(Executor.testLayer(options)),
  )

  return Layer.mergeAll(
    storageSupportLayer,
    TestConsole.layer,
    terminalLayer,
    Stdio.layerTest({}),
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    StorageRuntimeConfig.layer,
    orchestratorLayer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(storageLayer),
    ),
  ).pipe(Layer.provideMerge(storageConfigLayer(false)))
}

const runCli = (args: ReadonlyArray<string>, runtimeLayer: Layer.Layer<any, any, any>) =>
  Effect.gen(function* () {
    const run = Command.runWith(cli, { version: cliVersion })

    yield* run(args)

    return (yield* TestConsole.logLines).join("\n")
  }).pipe(Effect.provide(runtimeLayer))

const parseLineValue = (output: string, prefix: string) => {
  const line = output.split("\n").find((candidate) => candidate.startsWith(prefix))
  if (line === undefined) {
    throw new Error(`Missing line with prefix ${prefix}`)
  }

  return line.slice(prefix.length)
}

const parseLogRef = (output: string) => {
  const line = output.split("\n").find((candidate) => candidate.startsWith("stdout "))
  if (line === undefined) {
    throw new Error("Missing stdout log line")
  }

  return line.split(" ")[1]!
}

const storageConfigLayer = (runRecoveryOnStartup: boolean) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      ...runtimeEnv,
      RUN_RECOVERY_ON_STARTUP: runRecoveryOnStartup ? "true" : "false",
    }),
  )

const interruptedSeedRun = (workflowId: string) => {
  const runId = RunId.make(`run:integration:${workflowId}:${crypto.randomUUID()}`)
  const buildAttemptId = AttemptId.make(`attempt:${runId}:unit:build:1`)
  const runningAttempt = new ExecutionAttemptState({
    attemptId: buildAttemptId,
    runId,
    unitId: UnitId.make("unit:build"),
    attemptNumber: 1,
    status: "running",
    startedAt: new Date(0),
    artifacts: [],
    logs: [],
  })

  const units = [
    new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:build"),
      status: "running",
      dependencies: [],
      latestAttemptId: buildAttemptId,
      attempts: [runningAttempt],
      startedAt: new Date(0),
      artifacts: [],
      logs: [],
    }),
    new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:test"),
      status: "pending",
      dependencies: [UnitId.make("unit:build")],
      attempts: [],
      artifacts: [],
      logs: [],
    }),
  ]

  return new WorkflowRunState({
    runId,
    workflowId: WorkflowId.make(workflowId),
    planId: PlanId.make(`plan:${workflowId}`),
    status: "running",
    units,
    progress: new ProgressSummary({
      totalUnits: 2,
      completedUnits: 0,
      failedUnits: 0,
      skippedUnits: 0,
    }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    startedAt: new Date(0),
    artifacts: [],
    logs: [],
  })
}

const terminalLayer = Layer.succeed(
  Terminal.Terminal,
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    display: (text) => Console.log(text),
    readInput: Effect.die("Not implemented"),
    readLine: Effect.succeed(""),
  }),
)

const storageSupportLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("Not implemented")),
  ),
)

const runtimeEnv = ((globalThis as { readonly Bun?: { readonly env: Record<string, string | undefined> } }).Bun?.env ??
  process.env) as Record<string, string | undefined>

const storageIntegrationEnabled =
  runtimeEnv.RUN_STORAGE_TESTS === "1" &&
  (runtimeEnv.POSTGRES_URL !== undefined || runtimeEnv.PGHOST !== undefined) &&
  runtimeEnv.S3_BUCKET !== undefined &&
  (runtimeEnv.S3_SECRET_KEY !== undefined || runtimeEnv.S3_SECRET_ACCESS_KEY !== undefined) &&
  (runtimeEnv.S3_ACCESS_KEY !== undefined || runtimeEnv.S3_ACCESS_KEY_ID !== undefined)
