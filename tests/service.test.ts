import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

import { ArtifactMetadata, RegisteredArtifact } from "../src/domain/artifacts.ts"
import { ExecutionPlan, ContainerCommandDescriptor, PlanUnit } from "../src/domain/execution-plan.ts"
import { RunId, UnitId, WorkflowId, PlanId, ArtifactRef, AttemptId, LogRef, ProjectId } from "../src/domain/ids.ts"
import { ProducedReport } from "../src/domain/reports.ts"
import { ProgressSummary, RunExecutionContext, RunExecutionOptions, WorkflowRunState } from "../src/domain/runtime-state.ts"
import {
  ContainerCommandDeclaration,
  NamedDeclaration,
  NormalizedWorkflowDefinition,
  OutputDeclaration,
  ReportDeclaration,
  UnitDeclaration,
  UnitInputDeclaration,
  UnitOutputSourceDeclaration,
  WorkflowInputSourceDeclaration,
  WorkflowOutputDeclaration,
} from "../src/domain/workflow-definition.ts"
import { Engine } from "../src/engine/interface.ts"
import { RunController } from "../src/engine/run-controller.ts"
import { RunUpdate } from "../src/engine/run-updates.ts"
import { ExecutorResult } from "../src/engine/executor.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { EngineServiceConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"
import { engineServiceClientLayer } from "../src/service/client.ts"
import { startServiceServer } from "../src/service/server.ts"
import { SecretStore } from "../src/secrets/store.ts"

describe("service boundary", () => {
  it.live("routes call Engine-backed logic", () =>
    Effect.gen(function* () {
      let validated = false
      let listedRuns = false
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`

      const server = yield* withServer(
        Layer.mergeAll(
          Layer.succeed(EngineServiceConfig, { baseUrl, port }),
          Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
          Layer.succeed(Engine, {
            validate: () =>
              Effect.sync(() => {
                validated = true
              }),
            plan: () => Effect.succeed(samplePlan()),
            startRun: () => Effect.succeed(sampleRunState()),
            submitRun: () => Effect.succeed(sampleRunState()),
            cancelRun: () => Effect.succeed(sampleRunState()),
            retryRun: () => Effect.succeed(sampleRunState()),
            listRuns: () =>
              Effect.sync(() => {
                listedRuns = true
                return [sampleRunState()] as const
              }),
            inspectRun: () => Effect.succeed(sampleRunState()),
            streamRuns: () => Stream.make(sampleRunUpdate()),
            streamRun: () => Stream.make(sampleRunUpdate()),
            readRunEvents: () => Effect.succeed([]),
            readArtifacts: () => Effect.succeed([]),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.succeed(""),
            readLogs: () => Effect.succeed([]),
            readLogPayload: (_logRef: LogRef) => Effect.succeed(""),
          }),
          Layer.succeed(RunController, {
            submitRun: () => Effect.succeed(sampleRunState()),
            cancelRun: () => Effect.succeed(sampleRunState()),
            retryRun: () => Effect.succeed(sampleRunState()),
            recoverOnStartup: () => Effect.succeed([]),
          }),
          Layer.succeed(GitHubIntegration, {
            addBinding: () => Effect.die("unused"),
            listBindings: () => Effect.succeed([]),
            listProjects: () => Effect.succeed([]),
            handleWebhook: () => Effect.die("unused"),
            triggerPush: () => Effect.die("unused"),
          }),
          SecretStore.memoryLayer,
        ),
      )

      const validateResponse = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/workflows/validate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(encodeDefinition(sampleDefinition())),
        }),
      )
      const runsResponse = yield* Effect.promise(() => fetch(`${baseUrl}/api/runs`))
      const runs = yield* Effect.promise(() => runsResponse.json() as Promise<Array<{ readonly runId: string }>>)

      expect(validateResponse.status).toBe(204)
      expect(validated).toBe(true)
      expect(listedRuns).toBe(true)
      expect(runs[0]?.runId).toBe(sampleRunState().runId)

      yield* stopServer(server)
    }),
  )

  it.live("service client talks to HTTP service", () =>
    Effect.gen(function* () {
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`
      const seenPaths = new Array<string>()
      const server = Bun.serve({
        port,
        routes: {
          "/api/runs": {
            GET: () => {
              seenPaths.push("/api/runs")
              return Response.json([encodeRun(sampleRunState())])
            },
          },
        },
      })

      const runs = yield* Effect.gen(function* () {
        const engine = yield* Engine
        return yield* engine.listRuns()
      }).pipe(
        Effect.provide(
          engineServiceClientLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provideMerge(Layer.succeed(EngineServiceConfig, { baseUrl, port })),
          ),
        ),
      )

      expect(seenPaths).toEqual(["/api/runs"])
      expect(runs[0]?.runId).toBe(sampleRunState().runId)

      server.stop(true)
    }),
  )

  it.live("end-to-end service submit and inspect works", () =>
    Effect.gen(function* () {
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`
      const serviceLayer = Layer.mergeAll(
        makeInMemoryServiceEngineLayer(),
        Layer.succeed(EngineServiceConfig, { baseUrl, port }),
        Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([]),
          listProjects: () => Effect.succeed([]),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
        SecretStore.memoryLayer,
      )

      const server = yield* withServer(serviceLayer)

      const result = yield* Effect.gen(function* () {
        const engine = yield* Engine
        const plan = yield* engine.plan(sampleDefinition())
        const submitted = yield* engine.submitRun(plan)
        const completed = yield* waitForTerminalRun(engine, submitted.runId)
        const events = yield* engine.readRunEvents(submitted.runId)
        return { submitted, completed, events }
      }).pipe(
        Effect.provide(
          engineServiceClientLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provideMerge(Layer.succeed(EngineServiceConfig, { baseUrl, port })),
          ),
        ),
      )

      expect(result.submitted.status).toBe("queued")
      expect(result.completed.status).toBe("succeeded")
      expect(result.events.map((event) => event._tag)).toContain("RunSucceeded")

      yield* stopServer(server)
    }),
  )

  it.live("service secret management routes store and list metadata without values", () =>
    Effect.gen(function* () {
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`
      const serviceLayer = Layer.mergeAll(
        makeInMemoryServiceEngineLayer(),
        Layer.succeed(EngineServiceConfig, { baseUrl, port }),
        Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([]),
          listProjects: () => Effect.succeed([]),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
        SecretStore.memoryLayer,
      )

      const server = yield* withServer(serviceLayer)

      const createResponse = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/secrets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "project:demo", key: "NPM_TOKEN", value: "top-secret-token" }),
        }),
      )
      const listResponse = yield* Effect.promise(() => fetch(`${baseUrl}/api/secrets?projectId=project%3Ademo`))
      const secrets = yield* Effect.promise(
        () =>
          listResponse.json() as Promise<Array<{ readonly projectId: string; readonly key: string; readonly updatedAt: string; readonly value?: string }>>,
      )

      expect(createResponse.status).toBe(201)
      expect(secrets).toHaveLength(1)
      expect(secrets[0]?.projectId).toBe("project:demo")
      expect(secrets[0]?.key).toBe("NPM_TOKEN")
      expect(secrets[0]?.value).toBeUndefined()

      yield* stopServer(server)
    }),
  )

  it.live("service client submits workflow input values through the HTTP boundary", () =>
    Effect.gen(function* () {
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`
      const requests = new Array<any>()
      const serviceLayer = Layer.mergeAll(
        makeInMemoryServiceEngineLayer({
          requests,
          resultsByUnitId: {
            "unit:build": {
              outputs: { digest: { sha: "abc123" } },
              reports: [sampleReportPayload("workflow:service:inputs", "unit:build", "summary")],
            },
          },
        }),
        Layer.succeed(EngineServiceConfig, { baseUrl, port }),
        Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([]),
          listProjects: () => Effect.succeed([]),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
        SecretStore.memoryLayer,
      )

      const server = yield* withServer(serviceLayer)

      const result = yield* Effect.gen(function* () {
        const engine = yield* Engine
        const submitted = yield* engine.submitRun(sampleInputPlan(), { inputValues: { release: "1.2.3" } })
        return yield* waitForTerminalRun(engine, submitted.runId)
      }).pipe(
        Effect.provide(
          engineServiceClientLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provideMerge(Layer.succeed(EngineServiceConfig, { baseUrl, port })),
          ),
        ),
      )

      expect(result.inputs?.map((input) => input.name)).toEqual(["release"])
      expect(result.outputs?.map((output) => `${output.name}=${JSON.stringify(output.value)}`)).toEqual(['digest={"sha":"abc123"}'])
      expect(result.reports?.map((report) => report.name)).toEqual(["summary"])
      expect(requests[0]?.inputs.map((input: { readonly name: string; readonly value: unknown }) => ({ name: input.name, value: input.value }))).toEqual([
        { name: "release", value: "1.2.3" },
      ])
      expect(requests[1]?.inputs.map((input: { readonly name: string; readonly value: unknown }) => ({ name: input.name, value: input.value }))).toEqual([
        { name: "release", value: "1.2.3" },
        { name: "digest", value: { sha: "abc123" } },
      ])

      yield* stopServer(server)
    }),
  )

  it.live("service client can cancel a running run through the HTTP boundary", () => {
    let interrupted = false

    return Effect.gen(function* () {
      const port = randomPort()
      const baseUrl = `http://127.0.0.1:${port}`
      const serviceLayer = Layer.mergeAll(
        makeInMemoryServiceEngineLayer({
          resultsByUnitId: {
            "unit:slow": {
              execute: (request) =>
                Effect.sleep("5 seconds").pipe(
                  Effect.as(
                    new ExecutorResult({
                      runId: request.runId,
                      unitId: request.unitId,
                      attemptId: request.attemptId,
                      attemptNumber: request.attemptNumber,
                      outcome: "succeeded",
                      exitCode: 0,
                      outputs: {},
                      reports: [],
                      artifacts: [],
                      logs: [],
                      diagnostics: [],
                    }),
                  ),
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interrupted = true
                    }),
                  ),
                ),
            },
          },
        }),
        Layer.succeed(EngineServiceConfig, { baseUrl, port }),
        Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([]),
          listProjects: () => Effect.succeed([]),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
        SecretStore.memoryLayer,
      )

      const server = yield* withServer(serviceLayer)

      const result = yield* Effect.gen(function* () {
        const engine = yield* Engine
        const submitted = yield* engine.submitRun(slowPlan())
        yield* Effect.sleep("50 millis")
        yield* engine.cancelRun(submitted.runId, "Canceled over HTTP")
        return yield* waitForTerminalRun(engine, submitted.runId)
      }).pipe(
        Effect.provide(
          engineServiceClientLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provideMerge(Layer.succeed(EngineServiceConfig, { baseUrl, port })),
          ),
        ),
      )

      expect(result.status).toBe("canceled")
      expect(interrupted).toBe(true)

      yield* stopServer(server)
    })
  })
})

const withServer = (layer: Layer.Layer<any, any, any>) => startServiceServer.pipe(Effect.provide(layer))

const stopServer = (server: ReturnType<typeof Bun.serve>) =>
  Effect.tryPromise({
    try: () => server.stop(true),
    catch: () => undefined,
  })

const waitForTerminalRun = (
  engine: { readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, unknown> },
  runId: RunId,
): Effect.Effect<WorkflowRunState, unknown> =>
  engine.inspectRun(runId).pipe(
    Effect.flatMap((run) =>
      run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "interrupted"
        ? Effect.succeed(run)
        : Effect.sleep("50 millis").pipe(Effect.flatMap(() => waitForTerminalRun(engine, runId))),
    ),
  )

const sampleDefinition = () =>
  new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:service:test"),
    name: "service test",
    metadata: {},
    units: [
      new UnitDeclaration({
        unitId: UnitId.make("unit:build"),
        name: "build",
        payloadDeclaration: new ContainerCommandDeclaration({ image: "oven/bun:1", command: ["bun", "test"] }),
        metadata: {},
        inputs: [],
        outputs: [],
        artifacts: [],
        policies: [],
      }),
    ],
    dependencies: [],
    inputs: [],
    outputs: [],
    artifacts: [],
    reports: [],
  })

const samplePlan = () =>
  new ExecutionPlan({
    planId: PlanId.make("plan:workflow:service:test"),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:service:test"),
    workflowName: "service test",
    metadata: {},
    units: [
      new PlanUnit({
        unitId: UnitId.make("unit:build"),
        name: "build",
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

const sampleInputPlan = () =>
  new ExecutionPlan({
    planId: PlanId.make("plan:workflow:service:inputs"),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:service:inputs"),
    workflowName: "service inputs",
    metadata: {},
    inputs: [new NamedDeclaration({ name: "release", metadata: {} })],
    outputs: [
      new WorkflowOutputDeclaration({
        name: "digest",
        from: new UnitOutputSourceDeclaration({ unitId: UnitId.make("unit:build"), outputName: "digest" }),
        metadata: {},
      }),
    ],
    units: [
      new PlanUnit({
        unitId: UnitId.make("unit:build"),
        name: "build",
        dependencies: [],
        payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
        inputs: [
          new UnitInputDeclaration({
            name: "release",
            from: new WorkflowInputSourceDeclaration({ inputName: "release" }),
            metadata: {},
          }),
        ],
        outputs: [new OutputDeclaration({ name: "digest", path: "outputs/digest.json", format: "json", metadata: {} })],
        reports: [sampleReportDeclaration("summary")],
        logExpectations: [],
        artifactExpectations: [],
        policies: [],
        diagnostics: [],
      }),
      new PlanUnit({
        unitId: UnitId.make("unit:deploy"),
        name: "deploy",
        dependencies: [UnitId.make("unit:build")],
        payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
        inputs: [
          new UnitInputDeclaration({
            name: "release",
            from: new WorkflowInputSourceDeclaration({ inputName: "release" }),
            metadata: {},
          }),
          new UnitInputDeclaration({
            name: "digest",
            from: new UnitOutputSourceDeclaration({ unitId: UnitId.make("unit:build"), outputName: "digest" }),
            metadata: {},
          }),
        ],
        outputs: [],
        reports: [],
        logExpectations: [],
        artifactExpectations: [],
        policies: [],
        diagnostics: [],
      }),
    ],
    dependencies: [
      {
        from: UnitId.make("unit:build"),
        to: UnitId.make("unit:deploy"),
      },
    ],
    diagnostics: [],
  })

const slowPlan = () =>
  new ExecutionPlan({
    planId: PlanId.make("plan:workflow:service:cancel"),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:service:cancel"),
    workflowName: "service cancel",
    metadata: {},
    inputs: [],
    outputs: [],
    units: [
      new PlanUnit({
        unitId: UnitId.make("unit:slow"),
        name: "slow",
        dependencies: [],
        payloadDescriptor: new ContainerCommandDescriptor({ image: "oven/bun:1", command: ["bun", "test"], env: {} }),
        inputs: [],
        outputs: [],
        reports: [],
        logExpectations: [],
        artifactExpectations: [],
        policies: [],
        diagnostics: [],
      }),
    ],
    dependencies: [],
    diagnostics: [],
  })

const sampleReportDeclaration = (name: string) =>
  new ReportDeclaration({
    name,
    path: `reports/${name}.txt`,
    format: "text",
    contentType: "text/plain",
    metadata: {},
  })

const sampleReportPayload = (workflowId: string, unitId: string, name: string) =>
  new ProducedReport({
    name,
    unitId: UnitId.make(unitId),
    attemptId: AttemptId.make(`attempt:run:plan:${workflowId}:${unitId}:1`),
    format: "text",
    contentType: "text/plain",
    artifact: new RegisteredArtifact({
      metadata: new ArtifactMetadata({
        artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:report:${name}`),
        runId: RunId.make(`run:plan:${workflowId}`),
        unitId: UnitId.make(unitId),
        attemptId: AttemptId.make(`attempt:run:plan:${workflowId}:${unitId}:1`),
        name,
        category: "report",
        status: "available",
        summary: `${name}.txt`,
      }),
      payloadBase64: Buffer.from(`${name}\n`).toString("base64"),
      contentType: "text/plain",
    }),
  })

const sampleRunState = () =>
  new WorkflowRunState({
    runId: RunId.make("run:service:test"),
    projectId: ProjectId.make("project:service:test"),
    workflowId: WorkflowId.make("workflow:service:test"),
    planId: PlanId.make("plan:workflow:service:test"),
    execution: new RunExecutionContext({
      plan: samplePlan(),
      options: new RunExecutionOptions({ workspacePath: "/repo/workspace" }),
      submittedAt: new Date(0),
    }),
    status: "succeeded",
    units: [],
    progress: new ProgressSummary({ totalUnits: 0, completedUnits: 0, failedUnits: 0, skippedUnits: 0 }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: new Date(0),
    artifacts: [],
    logs: [],
  })

const sampleRunUpdate = () =>
  new RunUpdate({
    runId: sampleRunState().runId,
    status: sampleRunState().status,
    updatedAt: sampleRunState().updatedAt,
    terminal: true,
    eventType: "snapshot",
  })

const encodeRun = (run: WorkflowRunState) => Schema.encodeSync(Schema.toCodecJson(WorkflowRunState))(run)

const encodeDefinition = (definition: NormalizedWorkflowDefinition) =>
  Schema.encodeSync(Schema.toCodecJson(NormalizedWorkflowDefinition))(definition)

const randomPort = () => 39000 + Math.floor(Math.random() * 1000)
