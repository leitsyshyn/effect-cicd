import { Schema } from "effect"

import { UnitId, WorkflowId } from "./ids.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0))

export class SourceMetadata extends Schema.Class<SourceMetadata>("SourceMetadata")({
  file: Schema.optional(Schema.String),
  line: Schema.optional(PositiveInt),
  column: Schema.optional(PositiveInt),
  origin: Schema.optional(Schema.String),
}) {}

export class NamedDeclaration extends Schema.Class<NamedDeclaration>("NamedDeclaration")({
  name: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class DependencyDeclaration extends Schema.Class<DependencyDeclaration>("DependencyDeclaration")({
  from: UnitId,
  to: UnitId,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class ContainerCommandDeclaration extends Schema.TaggedClass<ContainerCommandDeclaration>()(
  "ContainerCommandDeclaration",
  {
    image: Schema.String,
    command: Schema.NonEmptyArray(Schema.String),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    workingDirectory: Schema.optional(Schema.String),
  },
) {}

export const PayloadDeclaration = Schema.Union([ContainerCommandDeclaration])
export type PayloadDeclaration = typeof PayloadDeclaration.Type

export class RetryPolicyDeclaration extends Schema.TaggedClass<RetryPolicyDeclaration>()(
  "RetryPolicyDeclaration",
  {
    maxAttempts: PositiveInt,
  },
) {}

export class TimeoutPolicyDeclaration extends Schema.TaggedClass<TimeoutPolicyDeclaration>()(
  "TimeoutPolicyDeclaration",
  {
    seconds: PositiveNumber,
  },
) {}

export class CancellationPolicyDeclaration extends Schema.TaggedClass<CancellationPolicyDeclaration>()(
  "CancellationPolicyDeclaration",
  {
    mode: Schema.Literals(["best-effort", "fail-fast"]),
  },
) {}

export const PolicyDeclaration = Schema.Union([
  RetryPolicyDeclaration,
  TimeoutPolicyDeclaration,
  CancellationPolicyDeclaration,
])
export type PolicyDeclaration = typeof PolicyDeclaration.Type

export class UnitDeclaration extends Schema.Class<UnitDeclaration>("UnitDeclaration")({
  unitId: UnitId,
  name: Schema.String,
  payloadDeclaration: PayloadDeclaration,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  inputs: Schema.Array(NamedDeclaration),
  outputs: Schema.Array(NamedDeclaration),
  artifacts: Schema.Array(NamedDeclaration),
  policies: Schema.Array(PolicyDeclaration),
  source: Schema.optional(SourceMetadata),
}) {}

export class NormalizedWorkflowDefinition extends Schema.Class<NormalizedWorkflowDefinition>(
  "NormalizedWorkflowDefinition",
)({
  schemaVersion: Schema.String,
  workflowId: WorkflowId,
  name: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  units: Schema.Array(UnitDeclaration),
  dependencies: Schema.Array(DependencyDeclaration),
  inputs: Schema.Array(NamedDeclaration),
  outputs: Schema.Array(NamedDeclaration),
  artifacts: Schema.Array(NamedDeclaration),
  reports: Schema.Array(NamedDeclaration),
  source: Schema.optional(SourceMetadata),
}) {}
