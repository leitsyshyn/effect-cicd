import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { WorkflowId } from "../src/domain/ids.ts"
import {
  Artifact,
  Cancellation,
  Command,
  Condition,
  containerCommand,
  DslMaterializer,
  Input,
  Job,
  Output,
  Report,
  Retry,
  Secret,
  Timeout,
  Trigger,
  Workflow,
  artifact,
  type AuthoredUnit,
  type AuthoredWorkflow,
  unit,
  workflow,
} from "../src/dsl/index.ts"
import { Planner } from "../src/engine/planner.ts"

describe("DslMaterializer", () => {
  it.effect("minimal authored workflow materializes successfully", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const definition = yield* materializer.materialize(minimalWorkflow())

      expect(definition.workflowId).toBe(WorkflowId.make("workflow:test"))
      expect(definition.name).toBe("test workflow")
      expect(definition.units).toHaveLength(1)
      expect(definition.units[0]?.payloadDeclaration._tag).toBe("ContainerCommandDeclaration")
      expect(definition.units[0]?.artifacts.map((entry) => entry.name)).toEqual(["dist"])
      expect(definition.dependencies).toEqual([])
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("unit-local dependencies lower into explicit dependency declarations", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const definition = yield* materializer.materialize(
        Workflow.make("workflow:test").pipe(
          Workflow.named("test workflow"),
          Workflow.job(
            Job.make("unit:build").pipe(Job.named("build"), Job.image("oven/bun:latest"), Job.run("bun run build")),
            Job.make("unit:test").pipe(
              Job.named("test"),
              Job.image("oven/bun:latest"),
              Job.dependsOn("unit:build"),
              Job.run("bun test"),
            ),
          ),
        ),
      )

      expect(definition.dependencies.map((dependency) => `${dependency.from}->${dependency.to}`)).toEqual([
        "unit:build->unit:test",
      ])
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("duplicate unit ids fail materialization", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const error = yield* materializer
        .materialize(
          Workflow.make("workflow:test").pipe(
            Workflow.named("test workflow"),
            Workflow.job(
              Job.make("unit:build").pipe(Job.image("oven/bun:latest"), Job.run("bun run build")),
              Job.make("unit:build").pipe(Job.named("build again"), Job.image("oven/bun:latest"), Job.run("bun run build")),
            ),
          ),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("Duplicate unit id")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("unknown dependency target fails materialization", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const error = yield* materializer
        .materialize(
          Workflow.make("workflow:test").pipe(
            Workflow.named("test workflow"),
            Workflow.job(
              Job.make("unit:test").pipe(
                Job.image("oven/bun:latest"),
                Job.dependsOn("unit:missing"),
                Job.run("bun test"),
              ),
            ),
          ),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("Dependency target")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("self-dependency fails materialization", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const error = yield* materializer
        .materialize(
          Workflow.make("workflow:test").pipe(
            Workflow.named("test workflow"),
            Workflow.job(
              Job.make("unit:build").pipe(
                Job.image("oven/bun:latest"),
                Job.dependsOn("unit:build"),
                Job.run("bun run build"),
              ),
            ),
          ),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("cannot depend on itself")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("canonical public DSL authoring materializes conditions policies artifacts reports and outputs", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const definition = yield* materializer.materialize(
        Workflow.make("payments-ci").pipe(
          Workflow.named("Payments CI"),
          Workflow.on(Trigger.manual(), Trigger.githubPush({ branches: ["main"] })),
          Workflow.input(Input.make("release")),
          Workflow.output(Output.fromJob("build", "releaseVersion", "version")),
          Workflow.job(
            Job.make("build").pipe(
              Job.image("node:22"),
              Job.exec(Command.shell("pnpm build")),
              Job.env("CI", "true"),
              Job.secret("NPM_TOKEN"),
              Job.input(Input.fromWorkflow("release")),
              Job.output(Output.file("releaseVersion", "outputs/release-version.txt", { format: "text" })),
              Job.artifact(Artifact.file("dist", "dist")),
              Job.report(Report.file("summary", "reports/summary.txt")),
              Job.when(Condition.branch("main"), Condition.inputEquals("release", "stable")),
              Job.retry(Retry.times(2)),
              Job.timeout(Timeout.minutes(10)),
              Job.cancel(Cancellation.failFast()),
            ),
          ),
        ),
      )

      expect(definition.triggers?.map((trigger) => trigger._tag)).toEqual(["ManualTriggerDeclaration", "GitHubPushTriggerDeclaration"])
      expect(definition.inputs.map((input) => input.name)).toEqual(["release"])
      expect(definition.outputs?.map((output) => output.name)).toEqual(["version"])
      expect(definition.units[0]?.inputs?.map((input) => input.name)).toEqual(["release"])
      expect(definition.units[0]?.outputs?.map((output) => output.name)).toEqual(["releaseVersion"])
      expect(definition.units[0]?.artifacts.map((artifact) => artifact.name)).toEqual(["dist"])
      expect(definition.units[0]?.reports?.map((report) => report.name)).toEqual(["summary"])
      expect(definition.units[0]?.conditions?.map((condition) => condition._tag)).toEqual([
        "TriggerBranchConditionDeclaration",
        "WorkflowInputEqualsConditionDeclaration",
      ])
      expect(definition.units[0]?.policies.map((policy) => policy._tag)).toEqual([
        "RetryPolicyDeclaration",
        "TimeoutPolicyDeclaration",
        "CancellationPolicyDeclaration",
      ])
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("reusable job fragments compose into a static workflow", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const bunJob = (jobId: string, command: string) =>
        Job.make(jobId).pipe(Job.image("oven/bun:latest"), Job.run(command), Job.env({ CI: "true" }))

      const authored = Workflow.make("workflow:test").pipe(
        Workflow.named("test workflow"),
        Workflow.job(
          bunJob("unit:build", "bun run build"),
          bunJob("unit:test", "bun test").pipe(Job.dependsOn("unit:build")),
        ),
      )

      const first = yield* materializer.materialize(authored)
      const second = yield* materializer.materialize(authored)

      expect(first).toEqual(second)
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("Planner can consume materialized output successfully", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const planner = yield* Planner
      const definition = yield* materializer.materialize(
        Workflow.make("workflow:planner").pipe(
          Workflow.named("planner workflow"),
          Workflow.job(
            Job.make("unit:test").pipe(
              Job.named("test"),
              Job.image("oven/bun:latest"),
              Job.dependsOn("unit:build"),
              Job.run("bun test"),
            ),
            Job.make("unit:build").pipe(Job.named("build"), Job.image("oven/bun:latest"), Job.run("bun run build")),
          ),
        ),
      )

      const plan = yield* planner.plan(definition)

      expect(plan.workflowId).toBe(WorkflowId.make("workflow:planner"))
      expect(plan.units.map((planUnit) => planUnit.unitId)).toEqual(["unit:build", "unit:test"])
      expect(plan.dependencies.map((dependency) => `${dependency.from}->${dependency.to}`)).toEqual([
        "unit:build->unit:test",
      ])
    }).pipe(Effect.provide(Layer.mergeAll(DslMaterializer.layer, Planner.layer))),
  )

  it.effect("secret env references materialize explicitly", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const definition = yield* materializer.materialize(
        Workflow.make("workflow:test").pipe(
          Workflow.named("test workflow"),
          Workflow.job(
            Job.make("unit:build").pipe(
              Job.image("oven/bun:latest"),
              Job.exec(Command.argv("bun", ["run", "build"])),
              Job.env({ CI: "true" }),
              Job.env({ NPM_TOKEN: Secret.ref("NPM_TOKEN") }),
            ),
          ),
        ),
      )

      expect(definition.units[0]?.payloadDeclaration.env).toEqual({ CI: "true", NPM_TOKEN: Secret.ref("NPM_TOKEN") })
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("missing image or command in the public DSL fails materialization clearly", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const error = yield* materializer
        .materialize(
          Workflow.make("workflow:test").pipe(
            Workflow.named("test workflow"),
            Workflow.job(Job.make("unit:build").pipe(Job.image("oven/bun:latest"))),
          ),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("must declare a command")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )
})

const minimalWorkflow = (): AuthoredWorkflow => authoredWorkflow({})

const authoredWorkflow = (overrides: Partial<AuthoredWorkflow>): AuthoredWorkflow =>
  workflow({
    workflowId: "workflow:test",
    name: "test workflow",
    metadata: { owner: "dsl" },
    units: [authoredUnit("unit:build")],
    inputs: [],
    outputs: [],
    artifacts: [],
    reports: [],
    ...overrides,
  })

const authoredUnit = (unitId: string, overrides: Partial<AuthoredUnit> = {}): AuthoredUnit =>
  unit({
    unitId,
    name: unitId.replace("unit:", ""),
    command: containerCommand({
      image: "oven/bun:latest",
      command: ["bun", "run", "build"],
      env: { CI: "true" },
    }),
    dependsOn: [],
    inputs: [],
    outputs: [],
    artifacts: [artifact({ name: "dist", path: "artifacts/dist.txt" })],
    policies: [],
    ...overrides,
  })
