import { NodeChildProcessSpawner } from "@effect/platform-node-shared"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { TestConsole } from "effect/testing"
import { CliOutput, Command } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { cli, cliVersion, makeDurableStorageLayer } from "../src/cli/index.ts"
import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../src/domain/artifacts.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanDependency, PlanUnit } from "../src/domain/execution-plan.ts"
import { ArtifactRef, AttemptId, EventId, LogRef, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { RunCreated } from "../src/domain/events.ts"
import { ProgressSummary, RunExecutionContext, RunExecutionOptions, WorkflowRunState, ExecutionAttemptState, ExecutionUnitState } from "../src/domain/runtime-state.ts"
import { DslMaterializer } from "../src/dsl/index.ts"
import { Executor, LocalContainerExecutor, type TestExecutorLayerOptions } from "../src/engine/executor.ts"
import { Engine } from "../src/engine/interface.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { Planner } from "../src/engine/planner.ts"
import { RunController } from "../src/engine/run-controller.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { StorageRuntimeConfig } from "../src/runtime/config.ts"
import { WorkflowModuleLoader } from "../src/dsl/loader.ts"
import { ArtifactDeclaration, NamedDeclaration } from "../src/domain/workflow-definition.ts"

describe("durable storage integration", () => {
  it.live("persists run state, events, and log payloads across fresh runtimes", () => {
    if (!storageIntegrationEnabled) {
      return Effect.void
    }

      return Effect.gen(function* () {
      const runOutput = yield* runCli(
        ["run", "./tests/fixtures/workflows/valid-workflow.ts"],
        durableCliLayer({ resultsByUnitId: durableSuccessPayloads() }),
      )
      const runId = parseLineValue(runOutput, "run: ")

      const listOutput = yield* runCli(["runs", "list"], durableCliLayer())
      const showOutput = yield* runCli(["runs", "show", runId], durableCliLayer())
      const artifactsOutput = yield* runCli(["runs", "artifacts", runId], durableCliLayer())
      const logsOutput = yield* runCli(["runs", "logs", runId], durableCliLayer())
      const logRef = parseLogRef(logsOutput)
      const artifactRef = parseArtifactRef(artifactsOutput)
      const logOutput = yield* runCli(["runs", "log", logRef], durableCliLayer())
      const artifactOutput = yield* runCli(["runs", "artifact", artifactRef], durableCliLayer())

      expect(listOutput).toContain(runId)
      expect(showOutput).toContain(`run: ${runId}`)
      expect(showOutput).toContain("unit:build succeeded")
      expect(artifactOutput).toContain(artifactRef)
      expect(artifactOutput).toContain("\"artifact\":\"dist\"")
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
      execution: executionContextFor("workflow:storage", "plan:storage", ["unit:build"]),
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
      payloadBase64: Buffer.from('{"artifact":"dist"}\n').toString("base64"),
      contentType: "application/json",
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
      const storedArtifact = yield* artifactStore.readArtifact(artifact.metadata.artifactRef)
      const artifactPayload = yield* artifactStore.readArtifactPayload(artifact.metadata.artifactRef)
      const payload = yield* artifactStore.readLogPayload(log.metadata.logRef)

      expect(storedRun.runId).toBe(runId)
      expect(runs.some((candidate) => candidate.runId === runId)).toBe(true)
      expect(events.map((event) => event._tag)).toContain("RunCreated")
      expect(storedArtifact.artifactRef).toBe(artifact.metadata.artifactRef)
      expect(artifactPayload).toContain('"artifact":"dist"')
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

  it.live("runs the demo workflow end-to-end against Docker, Postgres, and MinIO", () => {
    if (!dockerStorageIntegrationEnabled) {
      return Effect.void
    }

    return Effect.gen(function* () {
      const runOutput = yield* runCli(
        ["run", "./examples/demo-workflow.ts", "--workspace", "./examples/demo-project"],
        realDurableCliLayer(),
      )
      const runId = parseLineValue(runOutput, "run: ")
      const artifactsOutput = yield* runCli(["runs", "artifacts", runId], realDurableCliLayer())
      const artifactRef = parseArtifactRef(artifactsOutput)
      const artifactOutput = yield* runCli(["runs", "artifact", artifactRef], realDurableCliLayer())

      expect(runOutput).toContain("status: succeeded")
      expect(runOutput).toContain("workspace: ")
      expect(runOutput).toContain("examples/demo-project")
      expect(artifactsOutput).toContain("release-manifest")
      expect(artifactOutput).toContain('"generatedBy": "effect-cicd-demo"')
    })
  })
})

const durableStoreLayer = () =>
  makeDurableStorageLayer().pipe(
    Layer.provideMerge(storageSupportLayer),
    Layer.provideMerge(runtimeSupportLayer),
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
  const runControllerLayer = RunController.layer.pipe(Layer.provideMerge(orchestratorLayer))

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
    runControllerLayer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(storageLayer),
    ),
  ).pipe(Layer.provideMerge(runtimeSupportLayer), Layer.provideMerge(storageConfigLayer(false)))
}

const realDurableCliLayer = () => {
  const storageLayer = durableStoreLayer()
  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(storageLayer),
    Layer.provideMerge(
      LocalContainerExecutor.layer.pipe(
        Layer.provideMerge(NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(runtimeSupportLayer))),
      ),
    ),
  )
  const runControllerLayer = RunController.layer.pipe(Layer.provideMerge(orchestratorLayer))

  return Layer.mergeAll(
    TestConsole.layer,
    terminalLayer,
    Stdio.layerTest({}),
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    StorageRuntimeConfig.layer,
    orchestratorLayer,
    runControllerLayer,
    Engine.layer.pipe(
      Layer.provideMerge(Planner.layer),
      Layer.provideMerge(orchestratorLayer),
      Layer.provideMerge(runControllerLayer),
      Layer.provideMerge(storageLayer),
    ),
  ).pipe(Layer.provideMerge(runtimeSupportLayer), Layer.provideMerge(storageConfigLayer(false)))
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

const parseArtifactRef = (output: string) => {
  const line = output
    .split("\n")
    .find((candidate) => candidate !== "artifacts:" && candidate.includes(" status=") && candidate.includes(" artifact:"))
  if (line === undefined) {
    throw new Error("Missing artifact line")
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
    execution: executionContextFor(workflowId, `plan:${workflowId}`, ["unit:build", "unit:test"]),
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

const executionContextFor = (workflowId: string, planId: string, unitIds: ReadonlyArray<string>) =>
  new RunExecutionContext({
    plan: new ExecutionPlan({
      planId: PlanId.make(planId),
      schemaVersion: "0.1.0",
      workflowId: WorkflowId.make(workflowId),
      workflowName: workflowId.replace("workflow:", ""),
      metadata: {},
      units: unitIds.map(
        (unitId, index) =>
          new PlanUnit({
            unitId: UnitId.make(unitId),
            name: unitId.replace("unit:", ""),
            dependencies: index === 0 ? [] : [UnitId.make(unitIds[index - 1]!)],
            payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
            logExpectations: [new NamedDeclaration({ name: "stdout", metadata: {} })],
            artifactExpectations: [new ArtifactDeclaration({ name: "dist", kind: "file", path: "dist/output.txt", metadata: {} })],
            policies: [],
            diagnostics: [],
          }),
      ),
      dependencies: unitIds.slice(1).map(
        (unitId, index) =>
          new PlanDependency({ from: UnitId.make(unitIds[index]!), to: UnitId.make(unitId) }),
      ),
      diagnostics: [],
    }),
    options: new RunExecutionOptions({ workspacePath: "/repo/workspace" }),
    submittedAt: new Date(0),
  })

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
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("Not implemented")),
  ),
)

const runtimeSupportLayer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer)

const runtimeEnv = ((globalThis as { readonly Bun?: { readonly env: Record<string, string | undefined> } }).Bun?.env ??
  process.env) as Record<string, string | undefined>

const durableSuccessPayloads = (): NonNullable<TestExecutorLayerOptions["resultsByUnitId"]> => ({
  "unit:build": successPayload("workflow:fixture:valid", "unit:build", "dist", "build stdout"),
  "unit:test": successPayload("workflow:fixture:valid", "unit:test", "coverage", "test stdout"),
  "unit:deploy": successPayload("workflow:fixture:valid", "unit:deploy", "release-manifest", "deploy stdout"),
})

const successPayload = (workflowId: string, unitId: string, artifactName: string, logSummary: string) => {
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
          category: "file",
          status: "available",
          summary: artifactName,
        }),
        payloadBase64: Buffer.from(JSON.stringify({ artifact: artifactName, unitId }) + "\n").toString("base64"),
        contentType: "application/json",
      }),
    ],
  } satisfies NonNullable<TestExecutorLayerOptions["resultsByUnitId"]>[string]
}

const storageIntegrationEnabled =
  runtimeEnv.RUN_STORAGE_TESTS === "1" &&
  (runtimeEnv.POSTGRES_URL !== undefined || runtimeEnv.PGHOST !== undefined) &&
  runtimeEnv.S3_BUCKET !== undefined &&
  (runtimeEnv.S3_SECRET_KEY !== undefined || runtimeEnv.S3_SECRET_ACCESS_KEY !== undefined) &&
  (runtimeEnv.S3_ACCESS_KEY !== undefined || runtimeEnv.S3_ACCESS_KEY_ID !== undefined)

const dockerStorageIntegrationEnabled =
  storageIntegrationEnabled &&
  runtimeEnv.RUN_DOCKER_TESTS === "1" &&
  Bun.spawnSync({
    cmd: ["docker", "info", "--format", "{{.ServerVersion}}"],
    stdout: "ignore",
    stderr: "ignore",
  }).success
