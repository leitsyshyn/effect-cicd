import { Schema } from "effect"

import { ArtifactMetadata, LogMetadata } from "./artifacts.ts"
import { FailureSummary } from "./runtime-state.ts"
import { AttemptId, EventId, RunId, UnitId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

const EventBase = {
  eventId: EventId,
  runId: RunId,
  occurredAt: Schema.Date,
  sequence: NonNegativeInt,
}

export class RunCreated extends Schema.TaggedClass<RunCreated>()("RunCreated", EventBase) {}
export class RunStarted extends Schema.TaggedClass<RunStarted>()("RunStarted", EventBase) {}
export class RunResumed extends Schema.TaggedClass<RunResumed>()("RunResumed", {
  ...EventBase,
  reason: Schema.String,
}) {}
export class RunCancellationRequested extends Schema.TaggedClass<RunCancellationRequested>()("RunCancellationRequested", {
  ...EventBase,
  reason: Schema.String,
}) {}

export class UnitReady extends Schema.TaggedClass<UnitReady>()("UnitReady", {
  ...EventBase,
  unitId: UnitId,
}) {}

export class UnitDispatched extends Schema.TaggedClass<UnitDispatched>()("UnitDispatched", {
  ...EventBase,
  unitId: UnitId,
  attemptId: AttemptId,
}) {}

export class AttemptStarted extends Schema.TaggedClass<AttemptStarted>()("AttemptStarted", {
  ...EventBase,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
}) {}

export class AttemptSucceeded extends Schema.TaggedClass<AttemptSucceeded>()(
  "AttemptSucceeded",
  {
    ...EventBase,
    unitId: UnitId,
    attemptId: AttemptId,
  },
) {}

export class AttemptFailed extends Schema.TaggedClass<AttemptFailed>()("AttemptFailed", {
  ...EventBase,
  unitId: UnitId,
  attemptId: AttemptId,
  failure: FailureSummary,
}) {}

export class RetryScheduled extends Schema.TaggedClass<RetryScheduled>()("RetryScheduled", {
  ...EventBase,
  unitId: UnitId,
  attemptId: AttemptId,
  nextAttemptNumber: PositiveInt,
  reason: Schema.String,
}) {}

export class AttemptCanceled extends Schema.TaggedClass<AttemptCanceled>()("AttemptCanceled", {
  ...EventBase,
  unitId: UnitId,
  attemptId: AttemptId,
  reason: Schema.String,
}) {}

export class UnitSucceeded extends Schema.TaggedClass<UnitSucceeded>()("UnitSucceeded", {
  ...EventBase,
  unitId: UnitId,
}) {}

export class UnitFailed extends Schema.TaggedClass<UnitFailed>()("UnitFailed", {
  ...EventBase,
  unitId: UnitId,
  failure: FailureSummary,
}) {}

export class UnitSkipped extends Schema.TaggedClass<UnitSkipped>()("UnitSkipped", {
  ...EventBase,
  unitId: UnitId,
  reason: Schema.String,
}) {}

export class UnitCanceled extends Schema.TaggedClass<UnitCanceled>()("UnitCanceled", {
  ...EventBase,
  unitId: UnitId,
  reason: Schema.String,
}) {}

export class LogRegistered extends Schema.TaggedClass<LogRegistered>()("LogRegistered", {
  ...EventBase,
  unitId: Schema.optional(UnitId),
  attemptId: Schema.optional(AttemptId),
  log: LogMetadata,
}) {}

export class ArtifactRegistered extends Schema.TaggedClass<ArtifactRegistered>()(
  "ArtifactRegistered",
  {
    ...EventBase,
    unitId: Schema.optional(UnitId),
    attemptId: Schema.optional(AttemptId),
    artifact: ArtifactMetadata,
  },
) {}

export class RunSucceeded extends Schema.TaggedClass<RunSucceeded>()(
  "RunSucceeded",
  EventBase,
) {}

export class RunFailed extends Schema.TaggedClass<RunFailed>()("RunFailed", {
  ...EventBase,
  failure: FailureSummary,
}) {}

export class RunCanceled extends Schema.TaggedClass<RunCanceled>()("RunCanceled", {
  ...EventBase,
  reason: Schema.String,
}) {}

export class RunInterrupted extends Schema.TaggedClass<RunInterrupted>()("RunInterrupted", {
  ...EventBase,
  reason: Schema.String,
}) {}

export const WorkflowEvent = Schema.Union([
  RunCreated,
  RunStarted,
  RunResumed,
  RunCancellationRequested,
  UnitReady,
  UnitDispatched,
  AttemptStarted,
  AttemptSucceeded,
  AttemptFailed,
  RetryScheduled,
  AttemptCanceled,
  UnitSucceeded,
  UnitFailed,
  UnitSkipped,
  UnitCanceled,
  LogRegistered,
  ArtifactRegistered,
  RunSucceeded,
  RunFailed,
  RunCanceled,
  RunInterrupted,
])
export type WorkflowEvent = typeof WorkflowEvent.Type
