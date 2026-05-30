import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { WorkflowId } from "../src/domain/ids.ts"
import {
  artifact,
  containerCommand,
  DslMaterializer,
  retry,
  unit,
  workflow,
  type AuthoredUnit,
  type AuthoredWorkflow,
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
        authoredWorkflow({
          units: [
            authoredUnit("unit:build", { name: "build" }),
            authoredUnit("unit:test", { name: "test", dependsOn: ["unit:build"] }),
          ],
        }),
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
          authoredWorkflow({
            units: [authoredUnit("unit:build"), authoredUnit("unit:build", { name: "build again" })],
          }),
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
          authoredWorkflow({
            units: [authoredUnit("unit:test", { dependsOn: ["unit:missing"] })],
          }),
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
          authoredWorkflow({
            units: [authoredUnit("unit:build", { dependsOn: ["unit:build"] })],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("cannot depend on itself")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("retry maxAttempts greater than 1 fails materialization", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const error = yield* materializer
        .materialize(
          authoredWorkflow({
            units: [authoredUnit("unit:build", { policies: [retry({ maxAttempts: 2 })] })],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("DslMaterializationFailed")
      expect(error.message).toContain("maxAttempts")
    }).pipe(Effect.provide(DslMaterializer.layer)),
  )

  it.effect("materialized output is deterministic", () =>
    Effect.gen(function* () {
      const materializer = yield* DslMaterializer
      const authored = authoredWorkflow({
        units: [
          authoredUnit("unit:test", { dependsOn: ["unit:build"] }),
          authoredUnit("unit:build"),
        ],
      })

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
        authoredWorkflow({
          workflowId: "workflow:planner",
          units: [
            authoredUnit("unit:test", { name: "test", dependsOn: ["unit:build"] }),
            authoredUnit("unit:build", { name: "build" }),
          ],
        }),
      )

      const plan = yield* planner.plan(definition)

      expect(plan.workflowId).toBe(WorkflowId.make("workflow:planner"))
      expect(plan.units.map((planUnit) => planUnit.unitId)).toEqual(["unit:build", "unit:test"])
      expect(plan.dependencies.map((dependency) => `${dependency.from}->${dependency.to}`)).toEqual([
        "unit:build->unit:test",
      ])
    }).pipe(Effect.provide(Layer.mergeAll(DslMaterializer.layer, Planner.layer))),
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
    artifacts: [artifact({ name: "dist" })],
    policies: [],
    ...overrides,
  })
