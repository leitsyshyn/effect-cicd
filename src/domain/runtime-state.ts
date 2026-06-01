import { Schema } from "effect"

import { ArtifactMetadata, LogMetadata } from "./artifacts.ts"
import { ExecutionPlan } from "./execution-plan.ts"
import { AttemptId, PlanId, ProjectId, RunId, UnitId, WorkflowId } from "./ids.ts"
import { ReportSummary } from "./reports.ts"
import { DataValueFormat } from "./workflow-definition.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const WorkflowRunStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "canceling",
  "canceled",
  "interrupted",
])
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type

export const ExecutionUnitStatus = Schema.Literals([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "skipped",
  "canceling",
  "canceled",
  "interrupted",
])
export type ExecutionUnitStatus = typeof ExecutionUnitStatus.Type

export const AttemptStatus = Schema.Literals(["created", "running", "succeeded", "failed", "timed_out", "canceled", "interrupted"])
export type AttemptStatus = typeof AttemptStatus.Type

export class FailureSummary extends Schema.Class<FailureSummary>("FailureSummary")({
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export class ProgressSummary extends Schema.Class<ProgressSummary>("ProgressSummary")({
  totalUnits: NonNegativeInt,
  completedUnits: NonNegativeInt,
  failedUnits: NonNegativeInt,
  skippedUnits: NonNegativeInt,
}) {}

export class ResolvedInputValue extends Schema.Class<ResolvedInputValue>("ResolvedInputValue")({
  name: Schema.String,
  value: Schema.Unknown,
  source: Schema.String,
}) {}

export class OutputValueSummary extends Schema.Class<OutputValueSummary>("OutputValueSummary")({
  name: Schema.String,
  value: Schema.Unknown,
  format: DataValueFormat,
  unitId: Schema.optional(UnitId),
  path: Schema.optional(Schema.String),
}) {}

export class RunExecutionOptions extends Schema.Class<RunExecutionOptions>("RunExecutionOptions")({
  workspacePath: Schema.optional(Schema.String),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class RunExecutionContext extends Schema.Class<RunExecutionContext>("RunExecutionContext")({
  plan: ExecutionPlan,
  options: RunExecutionOptions,
  submittedAt: Schema.Date,
  retriedFromRunId: Schema.optional(RunId),
}) {}

export class ExecutionAttemptState extends Schema.Class<ExecutionAttemptState>("ExecutionAttemptState")({
  attemptId: AttemptId,
  runId: RunId,
  unitId: UnitId,
  attemptNumber: PositiveInt,
  status: AttemptStatus,
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  failure: Schema.optional(FailureSummary),
  cancellationReason: Schema.optional(Schema.String),
  resolvedInputs: Schema.optional(Schema.Array(ResolvedInputValue)),
  outputs: Schema.optional(Schema.Array(OutputValueSummary)),
  reports: Schema.optional(Schema.Array(ReportSummary)),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
}) {}

export class ExecutionUnitState extends Schema.Class<ExecutionUnitState>("ExecutionUnitState")({
  runId: RunId,
  unitId: UnitId,
  status: ExecutionUnitStatus,
  dependencies: Schema.Array(UnitId),
  latestAttemptId: Schema.optional(AttemptId),
  attempts: Schema.Array(ExecutionAttemptState),
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  failure: Schema.optional(FailureSummary),
  cancellationReason: Schema.optional(Schema.String),
  resolvedInputs: Schema.optional(Schema.Array(ResolvedInputValue)),
  outputs: Schema.optional(Schema.Array(OutputValueSummary)),
  reports: Schema.optional(Schema.Array(ReportSummary)),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
}) {}

export class WorkflowRunState extends Schema.Class<WorkflowRunState>("WorkflowRunState")({
  runId: RunId,
  projectId: ProjectId,
  workflowId: WorkflowId,
  planId: PlanId,
  execution: RunExecutionContext,
  status: WorkflowRunStatus,
  units: Schema.Array(ExecutionUnitState),
  progress: ProgressSummary,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  failure: Schema.optional(FailureSummary),
  cancellationReason: Schema.optional(Schema.String),
  inputs: Schema.optional(Schema.Array(ResolvedInputValue)),
  outputs: Schema.optional(Schema.Array(OutputValueSummary)),
  reports: Schema.optional(Schema.Array(ReportSummary)),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
}) {}
