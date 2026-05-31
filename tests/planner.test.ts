import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { ContainerCommandDescriptor } from "../src/domain/execution-plan.ts"
import { UnitId, WorkflowId } from "../src/domain/ids.ts"
import {
  ArtifactDeclaration,
  CancellationPolicyDeclaration,
  ContainerCommandDeclaration,
  DependencyDeclaration,
  NormalizedWorkflowDefinition,
  RetryPolicyDeclaration,
  SourceMetadata,
  TimeoutPolicyDeclaration,
  UnitDeclaration,
} from "../src/domain/workflow-definition.ts"
import { Planner } from "../src/engine/planner.ts"

describe("Planner", () => {
  it.effect("valid workflow validates successfully", () =>
    Effect.gen(function* () {
      const planner = yield* Planner

      yield* planner.validate(workflow())
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("plans into deterministic canonical order", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const plan = yield* planner.plan(
        workflow({
          units: [unit("unit:test"), unit("unit:deploy"), unit("unit:build")],
          dependencies: [
            dependency("unit:test", "unit:deploy"),
            dependency("unit:build", "unit:test"),
            dependency("unit:build", "unit:deploy"),
          ],
        }),
      )

      expect(plan.planId).toBe("plan:workflow:test")
      expect(plan.units.map((planUnit) => planUnit.unitId)).toEqual(["unit:build", "unit:deploy", "unit:test"])
      expect(plan.dependencies.map((planDependency) => `${planDependency.from}->${planDependency.to}`)).toEqual([
        "unit:build->unit:deploy",
        "unit:build->unit:test",
        "unit:test->unit:deploy",
      ])
      expect(plan.units.find((planUnit) => planUnit.unitId === "unit:deploy")?.dependencies).toEqual([
        "unit:build",
        "unit:test",
      ])
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("unknown dependency target fails validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(workflow({ dependencies: [dependency("unit:build", "unit:missing")] }))
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("Dependency target")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("duplicate unit ids fail validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(workflow({ units: [unit("unit:build"), unit("unit:build")] }))
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("Duplicate unit id")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("self-dependency fails validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(workflow({ dependencies: [dependency("unit:build", "unit:build")] }))
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("cannot depend on itself")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("duplicate dependencies fail validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(
          workflow({
            units: [unit("unit:build"), unit("unit:test")],
            dependencies: [dependency("unit:build", "unit:test"), dependency("unit:build", "unit:test")],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("Duplicate dependency")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("cycle fails validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(
          workflow({
            units: [unit("unit:a"), unit("unit:b"), unit("unit:c")],
            dependencies: [dependency("unit:a", "unit:b"), dependency("unit:b", "unit:c"), dependency("unit:c", "unit:a")],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("cycle")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("retry policy with maxAttempts greater than 1 fails validation", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const error = yield* planner
        .validate(
          workflow({
            units: [unit("unit:build", { policies: [new RetryPolicyDeclaration({ maxAttempts: 2 })] })],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("WorkflowDefinitionInvalid")
      expect(error.message).toContain("maxAttempts")
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("converts container declaration into descriptor and defaults env", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const plan = yield* planner.plan(
        workflow({
          units: [
            unit("unit:build", {
              payloadDeclaration: new ContainerCommandDeclaration({
                image: "oven/bun:latest",
                command: ["bun", "test"],
                workingDirectory: "/workspace",
              }),
              artifacts: [named("coverage")],
              policies: [
                new RetryPolicyDeclaration({ maxAttempts: 1 }),
                new TimeoutPolicyDeclaration({ seconds: 60 }),
                new CancellationPolicyDeclaration({ mode: "fail-fast" }),
              ],
            }),
          ],
        }),
      )

      const payloadDescriptor = plan.units[0]?.payloadDescriptor
      expect(payloadDescriptor).toBeInstanceOf(ContainerCommandDescriptor)
      expect(payloadDescriptor).toMatchObject({
        image: "oven/bun:latest",
        command: ["bun", "test"],
        env: {},
        workingDirectory: "/workspace",
      })
      expect(plan.units[0]?.artifactExpectations.map((artifact) => artifact.name)).toEqual(["coverage"])
      expect(plan.units[0]?.logExpectations.map((log) => log.name)).toEqual(["stdout"])
      expect(plan.units[0]?.policies.map((policy) => policy._tag)).toEqual([
        "PlanRetryPolicy",
        "PlanTimeoutPolicy",
        "PlanCancellationPolicy",
      ])
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("preserves source metadata", () =>
    Effect.gen(function* () {
      const planner = yield* Planner
      const source = new SourceMetadata({ file: "workflow.ts", line: 12, column: 3, origin: "test" })
      const artifactSource = new SourceMetadata({ file: "workflow.ts", line: 13 })
      const plan = yield* planner.plan(
        workflow({
          units: [unit("unit:build", { source, artifacts: [named("dist", artifactSource)] })],
        }),
      )

      expect(plan.units[0]?.source).toEqual(source)
      expect(plan.units[0]?.artifactExpectations[0]?.source).toEqual(artifactSource)
    }).pipe(Effect.provide(Planner.layer)),
  )

  it.effect("service can be used through Effect.provide(Planner.layer)", () =>
    Effect.gen(function* () {
      const plan = yield* Effect.gen(function* () {
        const planner = yield* Planner
        return yield* planner.plan(workflow())
      }).pipe(Effect.provide(Planner.layer))

      expect(plan.workflowId).toBe("workflow:test")
      expect(plan.diagnostics).toEqual([])
    }),
  )
})

const workflow = (overrides: Partial<ConstructorParameters<typeof NormalizedWorkflowDefinition>[0]> = {}) =>
  new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:test"),
    name: "test workflow",
    metadata: { owner: "ci" },
    units: [unit("unit:build")],
    dependencies: [],
    inputs: [],
    outputs: [],
    artifacts: [],
    reports: [],
    ...overrides,
  })

const unit = (unitId: string, overrides: Partial<ConstructorParameters<typeof UnitDeclaration>[0]> = {}) =>
  new UnitDeclaration({
    unitId: UnitId.make(unitId),
    name: unitId.replace("unit:", ""),
    payloadDeclaration: new ContainerCommandDeclaration({
      image: "alpine:latest",
      command: ["sh", "-c", "true"],
    }),
    metadata: {},
    inputs: [],
    outputs: [],
    artifacts: [],
    policies: [],
    ...overrides,
  })

const dependency = (from: string, to: string) =>
  new DependencyDeclaration({
    from: UnitId.make(from),
    to: UnitId.make(to),
    metadata: {},
  })

const named = (name: string, source?: SourceMetadata) =>
  new ArtifactDeclaration({
    name,
    kind: "file",
    path: `artifacts/${name}.txt`,
    contentType: "text/plain",
    metadata: {},
    source,
  })
