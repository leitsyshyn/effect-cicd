import { Schema } from "effect"

import { PlanId, UnitId, WorkflowId } from "./ids.ts"
import { SecretRef } from "./secrets.ts"
import { ArtifactDeclaration, NamedDeclaration, SourceMetadata } from "./workflow-definition.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0))

export class PlanningDiagnostic extends Schema.Class<PlanningDiagnostic>("PlanningDiagnostic")({
  severity: Schema.Literals(["info", "warning", "error"]),
  message: Schema.String,
  unitId: Schema.optional(UnitId),
  source: Schema.optional(SourceMetadata),
}) {}

export class ContainerCommandDescriptor extends Schema.TaggedClass<ContainerCommandDescriptor>()(
  "ContainerCommandDescriptor",
  {
    image: Schema.String,
    command: Schema.NonEmptyArray(Schema.String),
    env: Schema.Record(Schema.String, Schema.Union([Schema.String, SecretRef])),
    workingDirectory: Schema.optional(Schema.String),
  },
) {}

export const PayloadDescriptor = Schema.Union([ContainerCommandDescriptor])
export type PayloadDescriptor = typeof PayloadDescriptor.Type

export class PlanRetryPolicy extends Schema.TaggedClass<PlanRetryPolicy>()("PlanRetryPolicy", {
  maxAttempts: PositiveInt,
}) {}

export class PlanTimeoutPolicy extends Schema.TaggedClass<PlanTimeoutPolicy>()(
  "PlanTimeoutPolicy",
  {
    seconds: PositiveNumber,
  },
) {}

export class PlanCancellationPolicy extends Schema.TaggedClass<PlanCancellationPolicy>()(
  "PlanCancellationPolicy",
  {
    mode: Schema.Literals(["best-effort", "fail-fast"]),
  },
) {}

export const PlanPolicy = Schema.Union([PlanRetryPolicy, PlanTimeoutPolicy, PlanCancellationPolicy])
export type PlanPolicy = typeof PlanPolicy.Type

export class PlanDependency extends Schema.Class<PlanDependency>("PlanDependency")({
  from: UnitId,
  to: UnitId,
}) {}

export class PlanUnit extends Schema.Class<PlanUnit>("PlanUnit")({
  unitId: UnitId,
  name: Schema.String,
  dependencies: Schema.Array(UnitId),
  payloadDescriptor: PayloadDescriptor,
  logExpectations: Schema.Array(NamedDeclaration),
  artifactExpectations: Schema.Array(ArtifactDeclaration),
  policies: Schema.Array(PlanPolicy),
  source: Schema.optional(SourceMetadata),
  diagnostics: Schema.Array(PlanningDiagnostic),
}) {}

export class ExecutionPlan extends Schema.Class<ExecutionPlan>("ExecutionPlan")({
  planId: PlanId,
  schemaVersion: Schema.String,
  workflowId: WorkflowId,
  workflowName: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  units: Schema.Array(PlanUnit),
  dependencies: Schema.Array(PlanDependency),
  diagnostics: Schema.Array(PlanningDiagnostic),
}) {}
