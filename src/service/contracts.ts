import { Schema } from "effect"

import { ExecutionPlan } from "../domain/execution-plan.ts"
import { ProjectSummary } from "../domain/project.ts"
import { RunId } from "../domain/ids.ts"
import { RunExecutionOptions } from "../domain/runtime-state.ts"
import { SecretSummary } from "../domain/secrets.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"

export class RunSubmissionRequest extends Schema.Class<RunSubmissionRequest>("RunSubmissionRequest")({
  plan: ExecutionPlan,
  options: Schema.optional(RunExecutionOptions),
}) {}

export class WorkflowRunSubmissionRequest extends Schema.Class<WorkflowRunSubmissionRequest>("WorkflowRunSubmissionRequest")({
  definition: NormalizedWorkflowDefinition,
  options: Schema.optional(RunExecutionOptions),
}) {}

export class ServiceErrorResponse extends Schema.Class<ServiceErrorResponse>("ServiceErrorResponse")({
  error: Schema.String,
  tag: Schema.optional(Schema.String),
}) {}

export class RunActionRequest extends Schema.Class<RunActionRequest>("RunActionRequest")({
  runId: RunId,
  reason: Schema.optional(Schema.String),
}) {}

export class SecretSetRequest extends Schema.Class<SecretSetRequest>("SecretSetRequest")({
  projectId: Schema.String,
  key: Schema.String,
  value: Schema.String,
}) {}

export { SecretSummary }
export { ProjectSummary }
