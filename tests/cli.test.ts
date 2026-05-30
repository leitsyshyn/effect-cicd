import { describe, expect, it } from "@effect/vitest"
import { Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { TestConsole } from "effect/testing"
import { CliOutput, Command } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { cli, cliVersion, makeCliLayer } from "../src/cli/index.ts"
import { WorkflowId, UnitId } from "../src/domain/ids.ts"
import {
  ContainerCommandDeclaration,
  NormalizedWorkflowDefinition,
  UnitDeclaration,
} from "../src/domain/workflow-definition.ts"
import { DslMaterializer } from "../src/dsl/index.ts"
import { Engine } from "../src/engine/interface.ts"

describe("CLI", () => {
  it.effect("validate succeeds and prints success text", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["validate"])

      expect(output).toBe("workflow workflow:sample is valid")
    }),
  )

  it.effect("plan prints canonical unit order and dependencies", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["plan"])

      expect(output).toBe([
        "workflow: workflow:sample",
        "name: sample workflow",
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
      const output = yield* runCli(["run"])

      expect(output).toContain("run: run:plan:workflow:sample")
      expect(output).toContain("status: succeeded")
      expect(output).toContain("unit:build succeeded")
      expect(output).toContain("unit:test succeeded")
      expect(output).toContain("unit:deploy succeeded")
      expect(output).toContain("RunSucceeded")
      expect(output).toContain("dist artifact:workflow:sample:unit:build:dist")
      expect(output).toContain("stdout log:workflow:sample:unit:deploy:stdout")
    }),
  )

  it.effect("run prints failed status and RunFailed when build fails", () =>
    Effect.gen(function* () {
      const output = yield* runCli(["run"], makeCliLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" } } }))

      expect(output).toContain("status: failed")
      expect(output).toContain("unit:build failed")
      expect(output).toContain("RunFailed")
    }),
  )

  it.effect("command handlers depend on Engine rather than store services", () =>
    Effect.gen(function* () {
      let called = false

      const output = yield* runCli(
        ["validate"],
        Layer.mergeAll(
          DslMaterializer.layer,
          Layer.succeed(Engine, {
            validate: () =>
              Effect.sync(() => {
                called = true
              }),
            plan: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            inspectRun: () => Effect.die("unused"),
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
          }),
        ),
      )

      expect(called).toBe(true)
      expect(output).toBe("workflow workflow:sample is valid")
    }),
  )

  it.effect("validate uses DslMaterializer-produced normalized workflow", () =>
    Effect.gen(function* () {
      let validatedWorkflowId: string | undefined

      const output = yield* runCli(
        ["validate"],
        Layer.mergeAll(
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
            inspectRun: () => Effect.die("unused"),
            readRunEvents: () => Effect.die("unused"),
            readArtifacts: () => Effect.die("unused"),
            readLogs: () => Effect.die("unused"),
          }),
        ),
      )

      expect(validatedWorkflowId).toBe("workflow:from-dsl")
      expect(output).toBe("workflow workflow:from-dsl is valid")
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
