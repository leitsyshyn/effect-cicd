import { Schema } from "effect"

import { AttemptId, BindingId, PlanId, RunId, UnitId, WorkflowId } from "./ids.ts"

export class DslMaterializationFailed extends Schema.TaggedErrorClass<DslMaterializationFailed>()(
  "DslMaterializationFailed",
  {
    message: Schema.String,
  },
) {}

export class WorkflowDefinitionInvalid extends Schema.TaggedErrorClass<WorkflowDefinitionInvalid>()(
  "WorkflowDefinitionInvalid",
  {
    workflowId: Schema.optional(WorkflowId),
    message: Schema.String,
  },
) {}

export class PlanningFailed extends Schema.TaggedErrorClass<PlanningFailed>()("PlanningFailed", {
  workflowId: WorkflowId,
  message: Schema.String,
}) {}

export class PlanNotFound extends Schema.TaggedErrorClass<PlanNotFound>()("PlanNotFound", {
  planId: PlanId,
}) {}

export class RunNotFound extends Schema.TaggedErrorClass<RunNotFound>()("RunNotFound", {
  runId: RunId,
}) {}

export class RunControlRejected extends Schema.TaggedErrorClass<RunControlRejected>()("RunControlRejected", {
  runId: RunId,
  operation: Schema.String,
  message: Schema.String,
}) {}

export class UnitNotFound extends Schema.TaggedErrorClass<UnitNotFound>()("UnitNotFound", {
  runId: RunId,
  unitId: UnitId,
}) {}

export class AttemptNotFound extends Schema.TaggedErrorClass<AttemptNotFound>()("AttemptNotFound", {
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
}) {}

export class StoreUnavailable extends Schema.TaggedErrorClass<StoreUnavailable>()("StoreUnavailable", {
  store: Schema.String,
  message: Schema.String,
}) {}

export class EngineUnavailable extends Schema.TaggedErrorClass<EngineUnavailable>()("EngineUnavailable", {
  message: Schema.String,
}) {}

export class ExecutorFailed extends Schema.TaggedErrorClass<ExecutorFailed>()("ExecutorFailed", {
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  message: Schema.String,
}) {}

export class GitHubBindingRejected extends Schema.TaggedErrorClass<GitHubBindingRejected>()("GitHubBindingRejected", {
  message: Schema.String,
}) {}

export class GitHubWebhookUnauthorized extends Schema.TaggedErrorClass<GitHubWebhookUnauthorized>()(
  "GitHubWebhookUnauthorized",
  {
    repository: Schema.String,
    message: Schema.String,
  },
) {}

export class GitHubConfigMissing extends Schema.TaggedErrorClass<GitHubConfigMissing>()("GitHubConfigMissing", {
  setting: Schema.String,
  message: Schema.String,
}) {}

export class GitHubAuthFailed extends Schema.TaggedErrorClass<GitHubAuthFailed>()("GitHubAuthFailed", {
  operation: Schema.String,
  installationId: Schema.optional(Schema.Int),
  message: Schema.String,
}) {}

export class GitHubApiFailed extends Schema.TaggedErrorClass<GitHubApiFailed>()("GitHubApiFailed", {
  operation: Schema.String,
  statusCode: Schema.optional(Schema.Int),
  message: Schema.String,
}) {}

export class SourceAcquisitionFailed extends Schema.TaggedErrorClass<SourceAcquisitionFailed>()("SourceAcquisitionFailed", {
  repository: Schema.String,
  ref: Schema.String,
  commitSha: Schema.String,
  bindingId: BindingId,
  message: Schema.String,
}) {}

export const DomainError = Schema.Union([
  DslMaterializationFailed,
  WorkflowDefinitionInvalid,
  PlanningFailed,
  PlanNotFound,
  RunNotFound,
  RunControlRejected,
  UnitNotFound,
  AttemptNotFound,
  StoreUnavailable,
  EngineUnavailable,
  ExecutorFailed,
  GitHubBindingRejected,
  GitHubWebhookUnauthorized,
  GitHubConfigMissing,
  GitHubAuthFailed,
  GitHubApiFailed,
  SourceAcquisitionFailed,
])
export type DomainError = typeof DomainError.Type
