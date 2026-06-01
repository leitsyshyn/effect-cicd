import { describe, expect, it } from "@effect/vitest"
import { Console, Effect, FileSystem, Layer, Path, Stdio, Stream, Terminal } from "effect"
import { TestConsole } from "effect/testing"
import { CliOutput, Command } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { cli, cliVersion, makeCliLayer } from "../src/cli/index.ts"
import { ArtifactRef } from "../src/domain/ids.ts"
import { WorkflowId, UnitId } from "../src/domain/ids.ts"
import { PlanId, ProjectId, RunId } from "../src/domain/ids.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanUnit } from "../src/domain/execution-plan.ts"
import { GitHubBindingSummary } from "../src/domain/github.ts"
import {
  ContainerCommandDeclaration,
  NormalizedWorkflowDefinition,
  UnitDeclaration,
} from "../src/domain/workflow-definition.ts"
import { ExecutionUnitState, ProgressSummary, RunExecutionContext, RunExecutionOptions, WorkflowRunState } from "../src/domain/runtime-state.ts"
import { DslMaterializer } from "../src/dsl/index.ts"
import { WorkflowModuleLoader } from "../src/dsl/loader.ts"
import { Engine } from "../src/engine/interface.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { SecretSummary } from "../src/domain/secrets.ts"
import type { AuthoredWorkflow } from "../src/dsl/authored-workflow.ts"
import { SecretsClient } from "../src/service/client.ts"

describe("CLI", () => {
  it.effect("validate succeeds and prints success text", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["validate", "./tests/fixtures/workflows/valid-workflow.ts"])

      expect(output).toBe("workflow workflow:fixture:valid is valid")
    }),
  )

  it.effect("plan prints canonical unit order and dependencies", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["plan", "./tests/fixtures/workflows/valid-workflow.ts"])

      expect(output).toBe([
        "workflow: workflow:fixture:valid",
        "name: fixture valid workflow",
        "units:",
        "unit:build deps: -",
        "unit:deploy deps: unit:test",
        "unit:test deps: unit:build",
        "dependencies:",
        "unit:build -> unit:test",
        "unit:test -> unit:deploy",
        "diagnostics: 0",
      ].join("\n"))
    }),
  )

  it.effect("run prints a succeeded run summary", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["run", "./tests/fixtures/workflows/valid-workflow.ts"])

      expect(output).toContain("run: run:plan:workflow:fixture:valid:")
      expect(output).toContain("status: succeeded")
      expect(output).toContain("unit:build succeeded")
      expect(output).toContain("unit:test succeeded")
      expect(output).toContain("unit:deploy succeeded")
      expect(output).toContain("RunSucceeded")
      expect(output).toContain("dist artifact:attempt:")
      expect(output).toContain("stdout log:attempt:")
    }),
  )

  it.effect("run prints failed status and RunFailed when build fails", () =>
    Effect.gen(function* () {
      const output = yield* runCli(
        ["run", "./tests/fixtures/workflows/valid-workflow.ts"],
        makeCliLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" } } }),
      )

      expect(output).toContain("status: failed")
      expect(output).toContain("unit:build failed")
      expect(output).toContain("RunFailed")
    }),
  )

  it.effect("command handlers depend on Engine rather than store services", () =>
    Effect.gen(function* () {
      let called = false

      const output = yield* runCli(
        ["validate", "./tests/fixtures/workflows/valid-workflow.ts"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () =>
              Effect.sync(() => {
                called = true
              }),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(called).toBe(true)
      expect(output).toBe("workflow workflow:fixture:valid is valid")
    }),
  )

  it.effect("validate uses DslMaterializer-produced normalized workflow", () =>
    Effect.gen(function* () {
      let validatedWorkflowId: string | undefined

      const output = yield* runCli(
        ["validate", "./tests/fixtures/workflows/valid-workflow.ts"],
        Layer.mergeAll(
          Layer.succeed(WorkflowModuleLoader, {
            resolve: () => Effect.succeed("/tmp/workflow.ts"),
            load: () =>
              Effect.succeed({
                workflowId: "workflow:ignored",
                name: "ignored",
                units: [
                  {
                    unitId: "unit:build",
                    name: "build",
                    command: { _tag: "ContainerCommand", image: "alpine:latest", command: ["sh", "-c", "echo build"] },
                  },
                ],
              } satisfies AuthoredWorkflow),
          }),
          Layer.succeed(DslMaterializer, {
            materialize: () => Effect.succeed(materializedWorkflow("workflow:from-dsl")),
          }),
          Layer.succeed(Engine, {
            validate: (definition) =>
              Effect.sync(() => {
                validatedWorkflowId = definition.workflowId
              }),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(validatedWorkflowId).toBe("workflow:from-dsl")
      expect(output).toBe("workflow workflow:from-dsl is valid")
    }),
  )

  it.effect("validate surfaces DslMaterializer failures for bad workflows", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["validate", "./tests/fixtures/workflows/materialization-error.ts"]).pipe(Effect.exit)

      expect(output._tag).toBe("Failure")
    }),
  )

  it.effect("run defaults workspace to the workflow module directory", () =>
    Effect.gen(function* () {
      let capturedWorkspace: string | undefined

      const output = yield* runCli(
        ["run", "./examples/demo-workflow.ts"],
        Layer.mergeAll(
          Layer.succeed(WorkflowModuleLoader, {
            resolve: () => Effect.succeed("/repo/examples/demo-workflow.ts"),
            load: () => Effect.succeed(sampleAuthoredWorkflow()),
          }),
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.succeed(samplePlan()),
            startRun: (_plan, options) =>
              Effect.sync(() => {
                capturedWorkspace = options?.workspacePath
                return sampleRunState()
              }),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.succeed(sampleRunState()),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.succeed([]),
            readArtifacts: () => Effect.succeed([]),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.succeed([]),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(capturedWorkspace).toBe("/repo/examples")
      expect(output).toContain("workspace: /repo/examples")
    }),
  )

  it.effect("run parses workflow input JSON and forwards it through Engine.submitRun", () =>
    Effect.gen(function* () {
      let capturedInputs: Readonly<Record<string, unknown>> | undefined

      const output = yield* runCli(
        ["run", "./examples/demo-workflow.ts", "--inputs", '{"release":"1.2.3"}'],
        Layer.mergeAll(
          Layer.succeed(WorkflowModuleLoader, {
            resolve: () => Effect.succeed("/repo/examples/demo-workflow.ts"),
            load: () => Effect.succeed(sampleAuthoredWorkflow()),
          }),
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.succeed(samplePlan()),
            startRun: (_plan, options) =>
              Effect.sync(() => {
                capturedInputs = options?.inputValues
                return sampleRunState()
              }),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.succeed(sampleRunState()),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.succeed([]),
            readArtifacts: () => Effect.succeed([]),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.succeed([]),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(capturedInputs).toEqual({ release: "1.2.3" })
      expect(output).toContain('inputs: -')
    }),
  )

  it.effect("runs list forwards project filters through Engine.listRuns", () =>
    Effect.gen(function* () {
      let seenProjectId: string | undefined

      const output = yield* runCli(
        ["runs", "list", "--project", "project:sample"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: (projectId?: string) =>
              Effect.sync(() => {
                seenProjectId = projectId
                return [sampleRunState()]
              }),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(seenProjectId).toBe("project:sample")
      expect(output).toContain("project=project:sample")
    }),
  )

  it.effect("runs artifact prints persisted artifact payloads through Engine", () =>
    Effect.gen(function* () {
      const output = yield* runCli(
        ["runs", "artifact", "artifact:demo"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: () => Effect.succeed('{"artifact":"ok"}\n'),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(output).toBe(['artifact: artifact:demo', '{"artifact":"ok"}', ''].join("\n"))
    }),
  )

  it.effect("runs cancel delegates to Engine.cancelRun", () =>
    Effect.gen(function* () {
      let canceledRunId: string | undefined

      const output = yield* runCli(
        ["runs", "cancel", "run:demo"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: (runId) =>
              Effect.sync(() => {
                canceledRunId = runId
                return new WorkflowRunState({ ...sampleRunState(), runId: RunId.make("run:demo"), status: "canceled" })
              }),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(canceledRunId).toBe("run:demo")
      expect(output).toContain("status: canceled")
    }),
  )

  it.effect("runs show includes skip reasons for skipped units", () =>
    Effect.gen(function* () {
      const output = yield* runCli(
        ["runs", "show", "run:demo"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () =>
              Effect.succeed(
                new WorkflowRunState({
                  ...sampleRunState(),
                  runId: RunId.make("run:demo"),
                  units: [
                    new ExecutionUnitState({
                      ...sampleRunUnitState(),
                      status: "skipped",
                      skipReason: "Condition false: branch is not main",
                    }),
                  ],
                }),
              ),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: (_artifactRef: ArtifactRef) => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(output).toContain("skipped=Condition false: branch is not main")
    }),
  )

  it.effect("artifacts delete delegates to Engine.deleteArtifact", () =>
    Effect.gen(function* () {
      let deletedArtifactRef: string | undefined

      const output = yield* runCli(
        ["artifacts", "delete", "artifact:demo"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: () => Effect.die("unused"),
            deleteArtifact: (artifactRef) =>
              Effect.sync(() => {
                deletedArtifactRef = artifactRef
              }),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteLog: () => Effect.die("unused"),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(deletedArtifactRef).toBe("artifact:demo")
      expect(output).toContain("status: deleted")
    }),
  )

  it.effect("logs delete delegates to Engine.deleteLog", () =>
    Effect.gen(function* () {
      let deletedLogRef: string | undefined

      const output = yield* runCli(
        ["logs", "delete", "log:demo"],
        Layer.mergeAll(
          WorkflowModuleLoader.layer,
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () => Effect.die("unused"),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            submitRun: () => Effect.die("unused"),
            cancelRun: () => Effect.die("unused"),
            retryRun: () => Effect.die("unused"),
            listRuns: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            streamRuns: () => Stream.empty,
            streamRun: () => Stream.empty,
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readArtifactPayload: () => Effect.die("unused"),
            deleteArtifact: () => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
            readLogPayload: () => Effect.die("unused"),
            deleteLog: (logRef) =>
              Effect.sync(() => {
                deletedLogRef = logRef
              }),
            gcRunArtifacts: () => Effect.die("unused"),
            version: () => Effect.succeed("0.0.0"),
          }),
        ),
      )

      expect(deletedLogRef).toBe("log:demo")
      expect(output).toContain("status: deleted")
    }),
  )

  it.effect("bindings add github calls GitHubIntegration and prints the created binding", () =>
    Effect.gen(function* () {
      let seenRepository: string | undefined
      let seenWorkflowModulePath: string | undefined
      let seenInstallationId: number | undefined

      const output = yield* runCli(
        ["bindings", "add", "github", "acme/widgets", ".effect/workflow.ts", "--installation-id", "1001", "--branch", "main"],
        Layer.succeed(GitHubIntegration, {
          addBinding: (request) =>
            Effect.sync(() => {
              seenRepository = request.repository
              seenWorkflowModulePath = request.workflowModulePath
              seenInstallationId = request.installationId
              return sampleBindingSummary()
            }),
          listBindings: () => Effect.die("unused"),
          listProjects: () => Effect.die("unused"),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
      )

      expect(seenRepository).toBe("acme/widgets")
      expect(seenWorkflowModulePath).toBe(".effect/workflow.ts")
      expect(seenInstallationId).toBe(1001)
      expect(output).toContain("binding: binding:github:demo")
      expect(output).toContain("repository: acme/widgets")
      expect(output).toContain("branch: main")
    }),
  )

  it.effect("bindings list prints configured bindings", () =>
    Effect.gen(function* () {
      const output = yield* runCli(
        ["bindings", "list"],
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([sampleBindingSummary()]),
          listProjects: () => Effect.die("unused"),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
      )

      expect(output).toContain("bindings:")
      expect(output).toContain("binding: binding:github:demo")
      expect(output).toContain("workflowModulePath: .effect/workflow.ts")
    }),
  )

  it.effect("secrets list prints only secret metadata", () =>
    Effect.gen(function* () {
      const output = yield* runCli(
        ["secrets", "list", "project:demo"],
        Layer.succeed(SecretsClient, {
          setSecret: () => Effect.die("unused"),
          listSecrets: () =>
            Effect.succeed([
              new SecretSummary({
                projectId: "project:demo",
                key: "NPM_TOKEN",
                createdAt: new Date(0),
                updatedAt: new Date(0),
              }),
            ]),
          deleteSecret: () => Effect.die("unused"),
        }),
      )

      expect(output).toContain("project: project:demo")
      expect(output).toContain("secrets:")
      expect(output).toContain("NPM_TOKEN updatedAt=1970-01-01T00:00:00.000Z")
      expect(output).not.toContain("top-secret-token")
    }),
  )

  it.effect("secrets set sends values through SecretsClient without printing them", () =>
    Effect.gen(function* () {
      const original = process.env.TEST_SECRET_SOURCE
      process.env.TEST_SECRET_SOURCE = "top-secret-token"
      let captured: { readonly projectId: string; readonly key: string; readonly value: string } | undefined

      const output = yield* runCli(
        ["secrets", "set", "project:demo", "NPM_TOKEN", "--from-env", "TEST_SECRET_SOURCE"],
        Layer.succeed(SecretsClient, {
          setSecret: (projectId, key, value) =>
            Effect.sync(() => {
              captured = { projectId, key, value }
            }),
          listSecrets: () => Effect.die("unused"),
          deleteSecret: () => Effect.die("unused"),
        }),
      )

      if (original === undefined) {
        delete process.env.TEST_SECRET_SOURCE
      } else {
        process.env.TEST_SECRET_SOURCE = original
      }

      expect(captured).toEqual({ projectId: "project:demo", key: "NPM_TOKEN", value: "top-secret-token" })
      expect(output).toContain("project: project:demo")
      expect(output).toContain("secret: NPM_TOKEN")
      expect(output).toContain("status: stored")
      expect(output).not.toContain("top-secret-token")
    }),
  )
})

const runCli = (args: ReadonlyArray<string>, runtimeLayer: Layer.Layer<any, any, any> = makeCliLayer()) =>
  Effect.gen(function* () {
    const run = Command.runWith(cli, { version: cliVersion })

    yield* run(args)

    return (yield* TestConsole.logLines).join("\n")
  }).pipe(Effect.provide(makeCliTestLayer(runtimeLayer)))

const makeCliTestLayer = (runtimeLayer: Layer.Layer<any, any, any>) =>
  Layer.mergeAll(runtimeLayer, cliOutputLayer).pipe(Layer.provideMerge(cliSupportLayer))

const materializedWorkflow = (workflowId: string) =>
  new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make(workflowId),
    name: workflowId.replace("workflow:", ""),
    metadata: {},
    units: [
      new UnitDeclaration({
        unitId: UnitId.make("unit:build"),
        name: "build",
        payloadDeclaration: new ContainerCommandDeclaration({
          image: "oven/bun:latest",
          command: ["bun", "run", "build"],
          env: { CI: "true" },
        }),
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

const sampleAuthoredWorkflow = (): AuthoredWorkflow => ({
  workflowId: "workflow:sample",
  name: "sample",
  units: [
    {
      unitId: "unit:build",
      name: "build",
      command: { _tag: "ContainerCommand", image: "oven/bun:1", command: ["bun", "run", "build"] },
      artifacts: [{ name: "dist", path: "dist/output.txt" }],
    },
  ],
})

const samplePlan = () =>
  new ExecutionPlan({
    planId: PlanId.make("plan:workflow:sample"),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:sample"),
    workflowName: "sample",
    metadata: {},
    units: [
      new PlanUnit({
        unitId: UnitId.make("unit:build"),
        name: "build",
        dependencies: [],
        payloadDescriptor: new ContainerCommandDescriptor({
          image: "oven/bun:1",
          command: ["bun", "run", "build"],
          env: {},
        }),
        logExpectations: [],
        artifactExpectations: [],
        policies: [],
        diagnostics: [],
      }),
    ],
    dependencies: [],
    diagnostics: [],
  })

const sampleRunState = () =>
  new WorkflowRunState({
    runId: RunId.make("run:sample"),
    projectId: ProjectId.make("project:sample"),
    workflowId: WorkflowId.make("workflow:sample"),
    planId: PlanId.make("plan:workflow:sample"),
    execution: new RunExecutionContext({
      plan: samplePlan(),
      options: new RunExecutionOptions({ workspacePath: "/repo/examples" }),
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

const sampleRunUnitState = () =>
  new ExecutionUnitState({
    runId: RunId.make("run:sample"),
    unitId: UnitId.make("unit:build"),
    status: "pending",
    dependencies: [],
    attempts: [],
    artifacts: [],
    logs: [],
  })

const sampleBindingSummary = () =>
  new GitHubBindingSummary({
    bindingId: "binding:github:demo" as any,
    projectId: ProjectId.make("project:github:repo:2002"),
    provider: "github",
    installationId: 1001,
    repositoryId: 2002,
    repository: "acme/widgets",
    cloneUrl: "https://github.com/acme/widgets.git",
    sourceKind: "github-archive",
    branch: "main",
    workflowModulePath: ".effect/workflow.ts",
    enabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
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

const cliSupportLayer = Layer.mergeAll(
  TestConsole.layer,
  FileSystem.layerNoop({}),
  Path.layer,
  terminalLayer,
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("Not implemented")),
  ),
  Stdio.layerTest({}),
)

const cliOutputLayer = CliOutput.layer(CliOutput.defaultFormatter({ colors: false }))
