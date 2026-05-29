import { Effect, Schema } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { ExecutorFailed } from "../domain/errors.ts"
import { PayloadDescriptor, PlanPolicy } from "../domain/execution-plan.ts"
import { AttemptId, RunId, UnitId } from "../domain/ids.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export class DispatchInput extends Schema.Class<DispatchInput>("DispatchInput")({
  name: Schema.String,
  value: Schema.Unknown,
}) {}

export class DispatchRequest extends Schema.Class<DispatchRequest>("DispatchRequest")({
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
  payloadDescriptor: PayloadDescriptor,
  inputs: Schema.Array(DispatchInput),
  artifactNames: Schema.Array(Schema.String),
  logNames: Schema.Array(Schema.String),
  policies: Schema.Array(PlanPolicy),
  correlation: Schema.Record(Schema.String, Schema.String),
}) {}

export class ExecutorFailureSummary extends Schema.Class<ExecutorFailureSummary>("ExecutorFailureSummary")({
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export const ExecutorOutcome = Schema.Literals(["succeeded", "failed", "canceled", "interrupted"])
export type ExecutorOutcome = typeof ExecutorOutcome.Type

export class ExecutorResult extends Schema.Class<ExecutorResult>("ExecutorResult")({
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
  outcome: ExecutorOutcome,
  exitCode: Schema.optional(Schema.Int),
  failure: Schema.optional(ExecutorFailureSummary),
  outputs: Schema.Record(Schema.String, Schema.Unknown),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  diagnostics: Schema.Array(Schema.String),
}) {}

export class Executor extends Context.Service<
  Executor,
  {
    readonly execute: (request: DispatchRequest) => Effect.Effect<ExecutorResult, ExecutorFailed>
  }
>()("@effect-cicd/engine/Executor") {}
