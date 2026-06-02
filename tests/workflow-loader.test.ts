import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { DslMaterializer } from "../src/dsl/index.ts"
import {
  WorkflowModuleInvalidExport,
  WorkflowModuleLoader,
  WorkflowModuleMissingExport,
  WorkflowModuleNotFound,
} from "../src/dsl/loader.ts"

describe("WorkflowModuleLoader", () => {
  it.effect("loads default export authored workflow", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const materializer = yield* DslMaterializer
      const authored = yield* loader.load("./tests/fixtures/workflows/valid-workflow.ts")
      const definition = yield* materializer.materialize(authored)

      expect(definition.workflowId).toBe("workflow:fixture:valid")
      expect(definition.units.map((unit) => unit.unitId).sort()).toEqual(["unit:build", "unit:deploy", "unit:test"].sort())
    }).pipe(Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer))),
  )

  it.effect("loads workflows that import @effect-cicd/dsl", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const materializer = yield* DslMaterializer
      const authored = yield* loader.load("./tests/fixtures/workflows/package-import-workflow.ts")
      const definition = yield* materializer.materialize(authored)

      expect(definition.workflowId).toBe("workflow:fixture:package-import")
      expect(definition.triggers?.map((trigger) => trigger._tag)).toEqual(["GitHubPushTriggerDeclaration"])
    }).pipe(Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer))),
  )

  it.effect("fails with WorkflowModuleNotFound when module path is missing", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const error = yield* loader.load("./tests/fixtures/workflows/does-not-exist.ts").pipe(Effect.flip)

      expect(error).toBeInstanceOf(WorkflowModuleNotFound)
      expect(error._tag).toBe("WorkflowModuleNotFound")
    }).pipe(Effect.provide(WorkflowModuleLoader.layer)),
  )

  it.effect("resolves named exports via --export name", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const materializer = yield* DslMaterializer
      const authored = yield* loader.load("./tests/fixtures/workflows/valid-workflow.ts", { exportName: "workflowNamed" })
      const definition = yield* materializer.materialize(authored)

      expect(definition.workflowId).toBe("workflow:fixture:named")
      expect(definition.units).toHaveLength(1)
    }).pipe(Effect.provide(Layer.mergeAll(WorkflowModuleLoader.layer, DslMaterializer.layer))),
  )

  it.effect("fails clearly when export is missing", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const error = yield* loader
        .load("./tests/fixtures/workflows/valid-workflow.ts", { exportName: "missing" })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(WorkflowModuleMissingExport)
      expect(error._tag).toBe("WorkflowModuleMissingExport")
    }).pipe(Effect.provide(WorkflowModuleLoader.layer)),
  )

  it.effect("fails clearly when export is not an authored workflow", () =>
    Effect.gen(function* () {
      const loader = yield* WorkflowModuleLoader
      const error = yield* loader.load("./tests/fixtures/workflows/invalid-export.ts").pipe(Effect.flip)

      expect(error).toBeInstanceOf(WorkflowModuleInvalidExport)
      expect(error._tag).toBe("WorkflowModuleInvalidExport")
    }).pipe(Effect.provide(WorkflowModuleLoader.layer)),
  )
})
