import { Schema } from "effect"

import { ArtifactMetadata, LogMetadata } from "./artifacts.ts"
import { AttemptId, PlanId, RunId, UnitId, WorkflowId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const WorkflowRunStatus = Schema.Literals([
  "created",
  "running",
  "succeeded",
  "failed",
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
  "skipped",
  "canceling",
  "canceled",
  "interrupted",
])
export type ExecutionUnitStatus = typeof ExecutionUnitStatus.Type

export const AttemptStatus = Schema.Literals(["created", "running", "succeeded", "failed", "canceled", "interrupted"])
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

export class ExecutionAttemptState extends Schema.Class<ExecutionAttemptState>("ExecutionAttemptState")({
  attemptId: AttemptId,
  runId: RunId,
  unitId: UnitId,
  attemptNumber: PositiveInt,
  status: AttemptStatus,
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  failure: Schema.optional(FailureSummary),
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
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
}) {}

export class WorkflowRunState extends Schema.Class<WorkflowRunState>("WorkflowRunState")({
  runId: RunId,
  workflowId: WorkflowId,
  planId: PlanId,
  status: WorkflowRunStatus,
  units: Schema.Array(ExecutionUnitState),
  progress: ProgressSummary,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  failure: Schema.optional(FailureSummary),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
}) {}
