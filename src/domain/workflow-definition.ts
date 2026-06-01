import { Schema } from "effect"

import { UnitId, WorkflowId } from "./ids.ts"
import { SecretRef } from "./secrets.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0))
export const JitterMode = Schema.Literals(["none", "full", "half"])
export type JitterMode = typeof JitterMode.Type

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

export const DataValueFormat = Schema.Literals(["json", "text"])
export type DataValueFormat = typeof DataValueFormat.Type

export class WorkflowInputSourceDeclaration extends Schema.TaggedClass<WorkflowInputSourceDeclaration>()(
  "WorkflowInputSourceDeclaration",
  {
    inputName: Schema.String,
  },
) {}

export class UnitOutputSourceDeclaration extends Schema.TaggedClass<UnitOutputSourceDeclaration>()(
  "UnitOutputSourceDeclaration",
  {
    unitId: UnitId,
    outputName: Schema.String,
  },
) {}

export const ValueSourceDeclaration = Schema.Union([WorkflowInputSourceDeclaration, UnitOutputSourceDeclaration])
export type ValueSourceDeclaration = typeof ValueSourceDeclaration.Type

export class UnitInputDeclaration extends Schema.Class<UnitInputDeclaration>("UnitInputDeclaration")({
  name: Schema.String,
  from: ValueSourceDeclaration,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class OutputDeclaration extends Schema.Class<OutputDeclaration>("OutputDeclaration")({
  name: Schema.String,
  path: Schema.String,
  format: DataValueFormat,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class WorkflowOutputDeclaration extends Schema.Class<WorkflowOutputDeclaration>("WorkflowOutputDeclaration")({
  name: Schema.String,
  from: ValueSourceDeclaration,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class ReportDeclaration extends Schema.Class<ReportDeclaration>("ReportDeclaration")({
  name: Schema.String,
  path: Schema.String,
  format: DataValueFormat,
  contentType: Schema.optional(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class ArtifactDeclaration extends Schema.Class<ArtifactDeclaration>("ArtifactDeclaration")({
  name: Schema.String,
  kind: Schema.Literals(["file"]),
  path: Schema.String,
  contentType: Schema.optional(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class DependencyDeclaration extends Schema.Class<DependencyDeclaration>("DependencyDeclaration")({
  from: UnitId,
  to: UnitId,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.optional(SourceMetadata),
}) {}

export class ManualTriggerDeclaration extends Schema.TaggedClass<ManualTriggerDeclaration>()(
  "ManualTriggerDeclaration",
  {},
) {}

export class GitHubPushTriggerDeclaration extends Schema.TaggedClass<GitHubPushTriggerDeclaration>()(
  "GitHubPushTriggerDeclaration",
  {
    branches: Schema.optional(Schema.Array(Schema.String)),
    refs: Schema.optional(Schema.Array(Schema.String)),
    tags: Schema.optional(Schema.Array(Schema.String)),
  },
) {}

export const TriggerDeclaration = Schema.Union([ManualTriggerDeclaration, GitHubPushTriggerDeclaration])
export type TriggerDeclaration = typeof TriggerDeclaration.Type

export class ContainerCommandDeclaration extends Schema.TaggedClass<ContainerCommandDeclaration>()(
  "ContainerCommandDeclaration",
  {
    image: Schema.String,
    command: Schema.NonEmptyArray(Schema.String),
    env: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, SecretRef]))),
    workingDirectory: Schema.optional(Schema.String),
  },
) {}

export const PayloadDeclaration = Schema.Union([ContainerCommandDeclaration])
export type PayloadDeclaration = typeof PayloadDeclaration.Type

export class RetryPolicyDeclaration extends Schema.TaggedClass<RetryPolicyDeclaration>()(
  "RetryPolicyDeclaration",
  {
    maxAttempts: PositiveInt,
    exponent: PositiveNumber,
    baseDelayMillis: PositiveInt,
    maxDelayMillis: PositiveInt,
    jitter: JitterMode,
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

export class TriggerEventConditionDeclaration extends Schema.TaggedClass<TriggerEventConditionDeclaration>()(
  "TriggerEventConditionDeclaration",
  {
    event: Schema.Literals(["manual", "github.push"]),
  },
) {}

export class TriggerBranchConditionDeclaration extends Schema.TaggedClass<TriggerBranchConditionDeclaration>()(
  "TriggerBranchConditionDeclaration",
  {
    branch: Schema.String,
  },
) {}

export class TriggerRefConditionDeclaration extends Schema.TaggedClass<TriggerRefConditionDeclaration>()(
  "TriggerRefConditionDeclaration",
  {
    ref: Schema.String,
  },
) {}

export class TriggerTagConditionDeclaration extends Schema.TaggedClass<TriggerTagConditionDeclaration>()(
  "TriggerTagConditionDeclaration",
  {
    tag: Schema.String,
  },
) {}

export class WorkflowInputEqualsConditionDeclaration extends Schema.TaggedClass<WorkflowInputEqualsConditionDeclaration>()(
  "WorkflowInputEqualsConditionDeclaration",
  {
    inputName: Schema.String,
    value: Schema.Unknown,
  },
) {}

export class UpstreamStatusConditionDeclaration extends Schema.TaggedClass<UpstreamStatusConditionDeclaration>()(
  "UpstreamStatusConditionDeclaration",
  {
    unitId: UnitId,
    status: Schema.Literals(["succeeded", "failed", "timed_out", "skipped", "canceled"]),
  },
) {}

export const ConditionDeclaration = Schema.Union([
  TriggerEventConditionDeclaration,
  TriggerBranchConditionDeclaration,
  TriggerRefConditionDeclaration,
  TriggerTagConditionDeclaration,
  WorkflowInputEqualsConditionDeclaration,
  UpstreamStatusConditionDeclaration,
])
export type ConditionDeclaration = typeof ConditionDeclaration.Type

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
  inputs: Schema.optional(Schema.Array(UnitInputDeclaration)),
  outputs: Schema.optional(Schema.Array(OutputDeclaration)),
  reports: Schema.optional(Schema.Array(ReportDeclaration)),
  artifacts: Schema.Array(ArtifactDeclaration),
  conditions: Schema.optional(Schema.Array(ConditionDeclaration)),
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
  triggers: Schema.optional(Schema.Array(TriggerDeclaration)),
  units: Schema.Array(UnitDeclaration),
  dependencies: Schema.Array(DependencyDeclaration),
  inputs: Schema.Array(NamedDeclaration),
  outputs: Schema.optional(Schema.Array(WorkflowOutputDeclaration)),
  artifacts: Schema.Array(ArtifactDeclaration),
  reports: Schema.Array(NamedDeclaration),
  source: Schema.optional(SourceMetadata),
}) {}
