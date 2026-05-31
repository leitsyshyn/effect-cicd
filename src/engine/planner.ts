import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { WorkflowDefinitionInvalid } from "../domain/errors.ts"
import {
  ContainerCommandDescriptor,
  ExecutionPlan,
  PlanCancellationPolicy,
  PlanDependency,
  PlanRetryPolicy,
  PlanTimeoutPolicy,
  PlanUnit,
} from "../domain/execution-plan.ts"
import { PlanId, UnitId } from "../domain/ids.ts"
import {
  NamedDeclaration,
  NormalizedWorkflowDefinition,
  type PayloadDeclaration,
  type PolicyDeclaration,
} from "../domain/workflow-definition.ts"
import type { PlanningFailed } from "../domain/errors.ts"

export class Planner extends Context.Service<
  Planner,
  {
    readonly validate: (definition: NormalizedWorkflowDefinition) => Effect.Effect<void, WorkflowDefinitionInvalid>
    readonly plan: (
      definition: NormalizedWorkflowDefinition,
    ) => Effect.Effect<ExecutionPlan, WorkflowDefinitionInvalid | PlanningFailed>
  }
>()("@effect-cicd/engine/Planner") {
  static readonly layer = Layer.effect(
    Planner,
    Effect.gen(function* () {
      const validate = Effect.fn("Planner.validate")(function* (definition: NormalizedWorkflowDefinition) {
        const validationFailure = validateDefinition(definition)
        if (validationFailure !== undefined) {
          return yield* invalid(definition, validationFailure)
        }
      })

      const plan = Effect.fn("Planner.plan")(function* (definition: NormalizedWorkflowDefinition) {
        yield* validate(definition)
        return createPlan(definition)
      })

      return { validate, plan }
    }),
  )
}

const supportedSchemaVersion = "0.1.0"

const invalid = (definition: NormalizedWorkflowDefinition, message: string) =>
  Effect.fail(
    new WorkflowDefinitionInvalid({
      workflowId: definition.workflowId,
      message,
    }),
  )

const validateDefinition = (definition: NormalizedWorkflowDefinition): string | undefined => {
  if (definition.schemaVersion !== supportedSchemaVersion) {
    return `Unsupported workflow schema version: ${definition.schemaVersion}`
  }

  if (definition.name.trim().length === 0) {
    return "Workflow name must be non-empty"
  }

  if (definition.units.length === 0) {
    return "Workflow must declare at least one unit"
  }

  const unitIds = new Set<string>()
  for (const unit of definition.units) {
    const unitId = unit.unitId.toString()

    if (unitIds.has(unitId)) {
      return `Duplicate unit id: ${unit.unitId}`
    }
    unitIds.add(unitId)

    if (unit.name.trim().length === 0) {
      return `Unit ${unit.unitId} name must be non-empty`
    }

    for (const policy of unit.policies) {
      if (policy._tag === "RetryPolicyDeclaration" && policy.maxAttempts > 1) {
        return `Unit ${unit.unitId} retry maxAttempts greater than 1 is not supported`
      }
    }

    for (const artifact of unit.artifacts) {
      if (artifact.path.trim().length === 0) {
        return `Unit ${unit.unitId} artifact ${artifact.name} path must be non-empty`
      }

      if (artifact.path.startsWith("/")) {
        return `Unit ${unit.unitId} artifact ${artifact.name} path must be relative to the workspace root`
      }
    }
  }

  const dependencyIds = new Set<string>()
  for (const dependency of definition.dependencies) {
    if (!unitIds.has(dependency.from.toString())) {
      return `Dependency source does not reference an existing unit: ${dependency.from}`
    }

    if (!unitIds.has(dependency.to.toString())) {
      return `Dependency target does not reference an existing unit: ${dependency.to}`
    }

    if (dependency.from === dependency.to) {
      return `Unit ${dependency.from} cannot depend on itself`
    }

    const dependencyId = dependencyKey(dependency.from, dependency.to)
    if (dependencyIds.has(dependencyId)) {
      return `Duplicate dependency: ${dependency.from} -> ${dependency.to}`
    }
    dependencyIds.add(dependencyId)
  }

  if (hasCycle(definition)) {
    return "Dependency graph contains a cycle"
  }

  return undefined
}



const hasCycle = (definition: NormalizedWorkflowDefinition) => {
  const adjacency = new Map<string, Array<string>>()

  for (const unit of definition.units) {
    adjacency.set(unit.unitId.toString(), [])
  }

  for (const dependency of definition.dependencies) {
    adjacency.get(dependency.from.toString())?.push(dependency.to.toString())
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (unitId: string): boolean => {
    if (visiting.has(unitId)) {
      return true
    }
    if (visited.has(unitId)) {
      return false
    }

    visiting.add(unitId)
    for (const dependency of adjacency.get(unitId) ?? []) {
      if (visit(dependency)) {
        return true
      }
    }
    visiting.delete(unitId)
    visited.add(unitId)

    return false
  }

  for (const unitId of adjacency.keys()) {
    if (visit(unitId)) {
      return true
    }
  }

  return false
}

const createPlan = (definition: NormalizedWorkflowDefinition) => {
  const dependencies = [...definition.dependencies].sort(compareDependencyDeclarations)
  const dependencyIdsByUnit = new Map<string, Array<UnitId>>()

  for (const unit of definition.units) {
    dependencyIdsByUnit.set(unit.unitId.toString(), [])
  }

  for (const dependency of dependencies) {
    dependencyIdsByUnit.get(dependency.to.toString())?.push(dependency.from)
  }

  return new ExecutionPlan({
    planId: PlanId.make(`plan:${definition.workflowId}`),
    schemaVersion: definition.schemaVersion,
    workflowId: definition.workflowId,
    workflowName: definition.name,
    metadata: definition.metadata,
    units: [...definition.units].sort(compareUnits).map(
      (unit) =>
        new PlanUnit({
          unitId: unit.unitId,
          name: unit.name,
          dependencies: [...(dependencyIdsByUnit.get(unit.unitId.toString()) ?? [])].sort(compareUnitIds),
          payloadDescriptor: convertPayloadDeclaration(unit.payloadDeclaration),
          logExpectations: [new NamedDeclaration({ name: "stdout", metadata: {} })],
          artifactExpectations: unit.artifacts,
          policies: unit.policies.map(convertPolicyDeclaration),
          source: unit.source,
          diagnostics: [],
        }),
    ),
    dependencies: dependencies.map(
      (dependency) =>
        new PlanDependency({
          from: dependency.from,
          to: dependency.to,
        }),
    ),
    diagnostics: [],
  })
}

const convertPayloadDeclaration = (payloadDeclaration: PayloadDeclaration) => {
  switch (payloadDeclaration._tag) {
    case "ContainerCommandDeclaration":
      return new ContainerCommandDescriptor({
        image: payloadDeclaration.image,
        command: payloadDeclaration.command,
        env: payloadDeclaration.env ?? {},
        workingDirectory: payloadDeclaration.workingDirectory,
      })
  }
}

const convertPolicyDeclaration = (policyDeclaration: PolicyDeclaration) => {
  switch (policyDeclaration._tag) {
    case "RetryPolicyDeclaration":
      return new PlanRetryPolicy({ maxAttempts: policyDeclaration.maxAttempts })
    case "TimeoutPolicyDeclaration":
      return new PlanTimeoutPolicy({ seconds: policyDeclaration.seconds })
    case "CancellationPolicyDeclaration":
      return new PlanCancellationPolicy({ mode: policyDeclaration.mode })
  }
}

const compareUnits = (left: { readonly unitId: UnitId }, right: { readonly unitId: UnitId }) =>
  compareStrings(left.unitId, right.unitId)

const compareDependencyDeclarations = (
  left: { readonly from: UnitId; readonly to: UnitId },
  right: { readonly from: UnitId; readonly to: UnitId },
) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to)

const compareUnitIds = (left: UnitId, right: UnitId) => compareStrings(left, right)

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const dependencyKey = (from: UnitId, to: UnitId) => `${from}\u0000${to}`
