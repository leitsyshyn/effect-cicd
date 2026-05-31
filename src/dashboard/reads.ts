import type { Effect } from "effect"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import type { RunDetailDto, RunStageDto, RunSummaryDto, RunUnitDto, TimelineEventDto, PayloadMetadataDto } from "./types.ts"

export interface DashboardEngine {
  readonly listRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, unknown, never>
  readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, unknown, never>
  readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, unknown, never>
  readonly readArtifacts: (runId: RunId) => Effect.Effect<ReadonlyArray<ArtifactMetadata>, unknown, never>
  readonly readArtifactPayload: (artifactRef: ArtifactRef) => Effect.Effect<string, unknown, never>
  readonly readLogs: (runId: RunId) => Effect.Effect<ReadonlyArray<LogMetadata>, unknown, never>
  readonly readLogPayload: (logRef: LogRef) => Effect.Effect<string, unknown, never>
}

export const mapRunSummary = (run: WorkflowRunState): RunSummaryDto => ({
  runId: run.runId,
  workflowId: run.workflowId,
  status: run.status,
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
  ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt.toISOString() }),
  ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt.toISOString() }),
  ...(run.failure?.message === undefined ? {} : { failureMessage: run.failure.message }),
  progress: {
    totalUnits: run.progress.totalUnits,
    completedUnits: run.progress.completedUnits,
    failedUnits: run.progress.failedUnits,
    skippedUnits: run.progress.skippedUnits,
  },
})

export const mapPayloadMetadata = (payload: ArtifactMetadata | LogMetadata): PayloadMetadataDto => ({
  ref: "artifactRef" in payload ? payload.artifactRef : payload.logRef,
  runId: payload.runId,
  ...(payload.unitId === undefined ? {} : { unitId: payload.unitId }),
  ...(payload.attemptId === undefined ? {} : { attemptId: payload.attemptId }),
  name: payload.name,
  ...("category" in payload ? { category: payload.category } : {}),
  status: payload.status,
  ...(payload.sizeBytes === undefined ? {} : { sizeBytes: payload.sizeBytes }),
  ...(payload.checksum === undefined ? {} : { checksum: payload.checksum }),
  ...(payload.createdAt === undefined ? {} : { createdAt: payload.createdAt.toISOString() }),
  ...(payload.summary === undefined ? {} : { summary: payload.summary }),
})

export const mapEvent = (event: WorkflowEvent): TimelineEventDto => {
  const unitId = "unitId" in event ? event.unitId : undefined
  const attemptId = "attemptId" in event ? event.attemptId : undefined
  const artifactRef = "artifact" in event ? event.artifact.artifactRef : undefined
  const logRef = "log" in event ? event.log.logRef : undefined

  return {
    eventId: event.eventId,
    type: event._tag,
    sequence: event.sequence,
    occurredAt: event.occurredAt.toISOString(),
    ...(unitId === undefined ? {} : { unitId }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(artifactRef === undefined ? {} : { artifactRef }),
    ...(logRef === undefined ? {} : { logRef }),
    message: describeEvent(event),
  }
}

export const mapRunDetail = (
  run: WorkflowRunState,
  events: ReadonlyArray<WorkflowEvent>,
  artifacts: ReadonlyArray<ArtifactMetadata>,
  logs: ReadonlyArray<LogMetadata>,
): RunDetailDto => {
  const unitNames = new Map(run.units.map((unit) => [unit.unitId, humanizeUnitName(unit.unitId)]))
  const units = run.units
    .map<RunUnitDto>((unit) => {
      const computedDurationMs = durationMs(unit.startedAt, unit.finishedAt)

      return {
        unitId: unit.unitId,
        name: unitNames.get(unit.unitId) ?? unit.unitId,
        status: unit.status,
        dependencies: unit.dependencies.map(String),
        dependencyNames: unit.dependencies.map((dependency) => unitNames.get(dependency) ?? dependency),
        ...(unit.startedAt === undefined ? {} : { startedAt: unit.startedAt.toISOString() }),
        ...(unit.finishedAt === undefined ? {} : { finishedAt: unit.finishedAt.toISOString() }),
        ...(computedDurationMs === undefined ? {} : { durationMs: computedDurationMs }),
        ...(unit.failure?.message === undefined ? {} : { failureMessage: unit.failure.message }),
        ...(unit.latestAttemptId === undefined ? {} : { latestAttemptId: unit.latestAttemptId }),
        attempts: unit.attempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt.toISOString() }),
          ...(attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt.toISOString() }),
          ...(attempt.failure?.message === undefined ? {} : { failureMessage: attempt.failure.message }),
        })),
        artifactCount: unit.artifacts.length,
        logCount: unit.logs.length,
      }
    })
    .sort((left, right) => left.unitId.localeCompare(right.unitId))

  return {
    run: mapRunSummary(run),
    stages: deriveStages(units),
    dependencies: run.units.flatMap((unit) => unit.dependencies.map((dependency) => ({ from: dependency, to: unit.unitId }))),
    units,
    artifacts: artifacts.map(mapPayloadMetadata),
    logs: logs.map(mapPayloadMetadata),
    events: events.map(mapEvent),
  }
}

export const deriveStages = (units: ReadonlyArray<RunUnitDto>): ReadonlyArray<RunStageDto> => {
  const pending = new Map(units.map((unit) => [unit.unitId, unit]))
  const completed = new Set<string>()
  const stages = new Array<RunStageDto>()

  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((unit) => unit.dependencies.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.unitId.localeCompare(right.unitId))

    if (ready.length === 0) {
      const remaining = [...pending.values()].sort((left, right) => left.unitId.localeCompare(right.unitId))
      stages.push({
        id: `stage-${stages.length + 1}`,
        label: `Stage ${stages.length + 1}`,
        depth: stages.length,
        units: remaining,
      })
      break
    }

    for (const unit of ready) {
      pending.delete(unit.unitId)
      completed.add(unit.unitId)
    }

    stages.push({
      id: `stage-${stages.length + 1}`,
      label: `Stage ${stages.length + 1}`,
      depth: stages.length,
      units: ready,
    })
  }

  return stages
}

const describeEvent = (event: WorkflowEvent): string => {
  switch (event._tag) {
    case "RunCreated":
      return "Run created"
    case "RunStarted":
      return "Run started"
    case "RunSucceeded":
      return "Run succeeded"
    case "RunFailed":
      return `Run failed: ${event.failure.message}`
    case "RunInterrupted":
      return `Run interrupted: ${event.reason}`
    case "UnitReady":
      return `${event.unitId} became ready`
    case "UnitDispatched":
      return `${event.unitId} dispatched`
    case "UnitSucceeded":
      return `${event.unitId} succeeded`
    case "UnitFailed":
      return `${event.unitId} failed: ${event.failure.message}`
    case "UnitSkipped":
      return `${event.unitId} skipped: ${event.reason}`
    case "AttemptStarted":
      return `${event.unitId} attempt ${event.attemptNumber} started`
    case "AttemptSucceeded":
      return `${event.unitId} attempt succeeded`
    case "AttemptFailed":
      return `${event.unitId} attempt failed: ${event.failure.message}`
    case "LogRegistered":
      return `Log registered: ${event.log.name}`
    case "ArtifactRegistered":
      return `Artifact registered: ${event.artifact.name}`
  }
}

const durationMs = (startedAt: Date | undefined, finishedAt: Date | undefined) =>
  startedAt === undefined || finishedAt === undefined ? undefined : finishedAt.getTime() - startedAt.getTime()

const humanizeUnitName = (unitId: string) => unitId.replace(/^unit:/, "").replace(/[-_:]+/g, " ")
