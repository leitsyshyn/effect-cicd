import { Schema } from "effect"

import { ExecutionPlan } from "../domain/execution-plan.ts"
import { RunId } from "../domain/ids.ts"
import { RunExecutionOptions } from "../domain/runtime-state.ts"

export class RunSubmissionRequest extends Schema.Class<RunSubmissionRequest>("RunSubmissionRequest")({
  plan: ExecutionPlan,
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
