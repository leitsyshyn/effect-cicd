import type { Effect } from "effect"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { type ExecutionPlan, type PlanUnit } from "../domain/execution-plan.ts"
import type {
  OutputValueDto,
  PayloadMetadataDto,
  PlanningDiagnosticDto,
  RunDetailDto,
  RunStageDto,
  RunSummaryDto,
  RunUnitDto,
  SourceLocationDto,
  TimelineEventDto,
  TriggerDto,
} from "./types.ts"
import { isCancelableStatus, isRetryableStatus } from "./lib/run-status.ts"

export interface DashboardEngine {
  readonly listRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, unknown, never>
  readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, unknown, never>
  readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, unknown, never>
  readonly readArtifacts: (runId: RunId) => Effect.Effect<ReadonlyArray<ArtifactMetadata>, unknown, never>
  readonly readArtifactPayload: (artifactRef: ArtifactRef) => Effect.Effect<string, unknown, never>
  readonly readLogs: (runId: RunId) => Effect.Effect<ReadonlyArray<LogMetadata>, unknown, never>
  readonly readLogPayload: (logRef: LogRef) => Effect.Effect<string, unknown, never>
  readonly cancelRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, unknown, never>
  readonly retryRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, unknown, never>
  readonly gcRunArtifacts: (runId: RunId) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, unknown, never>
  readonly version: () => Effect.Effect<string, unknown, never>
}

export const mapRunSummary = (run: WorkflowRunState): RunSummaryDto => {
  const computedDurationMs = durationMs(run.startedAt, run.finishedAt)

  return {
    runId: run.runId,
    projectId: run.projectId,
    planId: run.planId,
    workflowId: run.workflowId,
    workflowName: run.execution.plan.workflowName,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt.toISOString() }),
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt.toISOString() }),
    ...(computedDurationMs === undefined ? {} : { durationMs: computedDurationMs }),
    ...(run.failure?.message === undefined ? {} : { failureMessage: run.failure.message }),
    ...(run.cancellationReason === undefined ? {} : { cancellationReason: run.cancellationReason }),
    progress: {
      totalUnits: run.progress.totalUnits,
      completedUnits: run.progress.completedUnits,
      failedUnits: run.progress.failedUnits,
      skippedUnits: run.progress.skippedUnits,
    },
    controls: {
      canCancel: isCancelableStatus(run.status),
      canRetry: isRetryableStatus(run.status),
      canGc: run.artifacts.length + run.logs.length > 0,
    },
  }
}

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
  ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt.toISOString() }),
  ...(payload.createdAt === undefined ? {} : { ageMillis: Date.now() - payload.createdAt.getTime() }),
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
  const unitPlans = new Map(run.execution.plan.units.map((unit) => [unit.unitId, unit] as const))
  const unitNames = new Map(run.execution.plan.units.map((unit) => [unit.unitId, unit.name.length === 0 ? humanizeUnitName(unit.unitId) : unit.name] as const))
  const units = run.units
    .map<RunUnitDto>((unit) => {
      const planUnit = unitPlans.get(unit.unitId)
      const computedDurationMs = durationMs(unit.startedAt, unit.finishedAt)
      const payload = planUnit?.payloadDescriptor

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
        ...(unit.cancellationReason === undefined ? {} : { cancellationReason: unit.cancellationReason }),
        ...(unit.skipReason === undefined ? {} : { skipReason: unit.skipReason }),
        ...(unit.latestAttemptId === undefined ? {} : { latestAttemptId: unit.latestAttemptId }),
        ...(unit.nextRetryAt === undefined ? {} : { nextRetryAt: unit.nextRetryAt.toISOString() }),
        ...(payload === undefined ? {} : mapPayloadDescriptor(payload)),
        ...(planUnit?.source === undefined ? {} : { source: mapSourceLocation(planUnit.source) }),
        attempts: unit.attempts.map((attempt) => {
          const attemptDuration = durationMs(attempt.startedAt, attempt.finishedAt)

          return {
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt.toISOString() }),
            ...(attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt.toISOString() }),
            ...(attemptDuration === undefined ? {} : { durationMs: attemptDuration }),
            ...(attempt.failure?.message === undefined ? {} : { failureMessage: attempt.failure.message }),
            ...(attempt.cancellationReason === undefined ? {} : { cancellationReason: attempt.cancellationReason }),
          }
        }),
        inputs: (unit.resolvedInputs ?? []).map((input) => ({ name: input.name, value: input.value, source: input.source })),
        outputs: (unit.outputs ?? []).map(mapOutputValue),
        reports: (unit.reports ?? []).map((report) => ({
          name: report.name,
          format: report.format,
          artifactRef: report.artifact.artifactRef,
          status: report.artifact.status,
        })),
        artifactCount: unit.artifacts.length,
        logCount: unit.logs.length,
      }
    })
    .sort((left, right) => left.unitId.localeCompare(right.unitId))

  return {
    run: mapRunSummary(run),
    source: {
      projectId: run.projectId,
      planId: run.planId,
      ...(run.execution.options.workspacePath === undefined ? {} : { workspacePath: run.execution.options.workspacePath }),
      ...(run.execution.retriedFromRunId === undefined ? {} : { retriedFromRunId: run.execution.retriedFromRunId }),
      triggers: (run.execution.plan.triggers ?? []).map(mapTrigger),
      metadata: Object.entries(run.execution.plan.metadata).map(([key, value]) => ({ key, value: stringifyUnknown(value) })),
      diagnostics: collectDiagnostics(run.execution.plan),
    },
    stages: deriveStages(units),
    dependencies: run.units.flatMap((unit) => unit.dependencies.map((dependency) => ({ from: dependency, to: unit.unitId }))),
    inputs: (run.inputs ?? []).map((input) => ({ name: input.name, value: input.value, source: input.source })),
    outputs: (run.outputs ?? []).map(mapOutputValue),
    reports: (run.reports ?? []).map((report) => ({
      name: report.name,
      format: report.format,
      artifactRef: report.artifact.artifactRef,
      status: report.artifact.status,
    })),
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
        label: stageLabel(stages.length + 1, remaining),
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
      label: stageLabel(stages.length + 1, ready),
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
    case "RunResumed":
      return `Run resumed: ${event.reason}`
    case "RunCancellationRequested":
      return `Cancellation requested: ${event.reason}`
    case "RunSucceeded":
      return "Run succeeded"
    case "RunFailed":
      return `Run failed: ${event.failure.message}`
    case "RunTimedOut":
      return `Run timed out: ${event.failure.message}`
    case "RunCanceled":
      return `Run canceled: ${event.reason}`
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
    case "UnitTimedOut":
      return `${event.unitId} timed out: ${event.failure.message}`
    case "UnitSkipped":
      return `${event.unitId} skipped: ${event.reason}`
    case "AttemptStarted":
      return `${event.unitId} attempt ${event.attemptNumber} started`
    case "AttemptSucceeded":
      return `${event.unitId} attempt succeeded`
    case "AttemptFailed":
      return `${event.unitId} attempt failed: ${event.failure.message}`
    case "AttemptTimedOut":
      return `${event.unitId} attempt timed out: ${event.failure.message}`
    case "RetryScheduled":
      return `${event.unitId} retry ${event.nextAttemptNumber} scheduled: ${event.reason}`
    case "AttemptCanceled":
      return `${event.unitId} attempt canceled: ${event.reason}`
    case "LogRegistered":
      return `Log registered: ${event.log.name}`
    case "ArtifactRegistered":
      return `Artifact registered: ${event.artifact.name}`
    case "ReportRegistered":
      return `Report registered: ${event.report.name}`
    case "ArtifactGcCompleted":
      return `Artifact GC deleted ${event.deletedCount} payloads`
    case "UnitCanceled":
      return `${event.unitId} canceled: ${event.reason}`
  }
}

const durationMs = (startedAt: Date | undefined, finishedAt: Date | undefined) =>
  startedAt === undefined || finishedAt === undefined ? undefined : finishedAt.getTime() - startedAt.getTime()

const humanizeUnitName = (unitId: string) => unitId.replace(/^unit:/, "").replace(/[-_:]+/g, " ")

const mapSourceLocation = (source: { readonly file?: string | undefined; readonly line?: number | undefined; readonly column?: number | undefined; readonly origin?: string | undefined }): SourceLocationDto => ({
  ...(source.file === undefined ? {} : { file: source.file }),
  ...(source.line === undefined ? {} : { line: source.line }),
  ...(source.column === undefined ? {} : { column: source.column }),
  ...(source.origin === undefined ? {} : { origin: source.origin }),
})

const mapOutputValue = (output: { readonly name: string; readonly value: unknown; readonly format?: string | undefined; readonly unitId?: string | undefined; readonly path?: string | undefined }): OutputValueDto => ({
  name: output.name,
  value: output.value,
  ...(output.format === undefined ? {} : { format: output.format }),
  ...(output.unitId === undefined ? {} : { unitId: output.unitId }),
  ...(output.path === undefined ? {} : { path: output.path }),
})

const mapPlanningDiagnostic = (diagnostic: {
  readonly severity: string
  readonly message: string
  readonly unitId?: string | undefined
  readonly source?: { readonly file?: string | undefined; readonly line?: number | undefined; readonly column?: number | undefined; readonly origin?: string | undefined } | undefined
}): PlanningDiagnosticDto => ({
  severity: diagnostic.severity,
  message: diagnostic.message,
  ...(diagnostic.unitId === undefined ? {} : { unitId: diagnostic.unitId }),
  ...(diagnostic.source === undefined ? {} : { source: mapSourceLocation(diagnostic.source) }),
})

const collectDiagnostics = (plan: ExecutionPlan): ReadonlyArray<PlanningDiagnosticDto> => [
  ...plan.diagnostics.map(mapPlanningDiagnostic),
  ...plan.units.flatMap((unit) => unit.diagnostics.map(mapPlanningDiagnostic)),
]

const mapTrigger = (trigger: { readonly _tag: string; readonly branches?: ReadonlyArray<string> | undefined; readonly refs?: ReadonlyArray<string> | undefined; readonly tags?: ReadonlyArray<string> | undefined }): TriggerDto => ({
  type: trigger._tag,
  summary: describeTrigger(trigger),
})

const describeTrigger = (trigger: { readonly _tag: string; readonly branches?: ReadonlyArray<string> | undefined; readonly refs?: ReadonlyArray<string> | undefined; readonly tags?: ReadonlyArray<string> | undefined }) => {
  switch (trigger._tag) {
    case "ManualTriggerDeclaration":
      return "manual"
    case "GitHubPushTriggerDeclaration": {
      const parts = [
        arraySummary(trigger.branches, "branches"),
        arraySummary(trigger.refs, "refs"),
        arraySummary(trigger.tags, "tags"),
      ].filter((value): value is string => value !== undefined)
      return parts.length === 0 ? "github push" : `github push / ${parts.join(" / ")}`
    }
    default:
      return trigger._tag
  }
}

const arraySummary = (value: unknown, label: string) =>
  Array.isArray(value) && value.length > 0 ? `${label}: ${value.join(", ")}` : undefined

const mapPayloadDescriptor = (payload: PlanUnit["payloadDescriptor"]) =>
  payload._tag === "ContainerCommandDescriptor"
    ? {
        command: payload.command.join(" "),
        image: payload.image,
        ...(payload.workingDirectory === undefined ? {} : { workingDirectory: payload.workingDirectory }),
      }
    : {}

const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const stageLabel = (index: number, units: ReadonlyArray<RunUnitDto>) => {
  const names = units.slice(0, 2).map((unit) => unit.name)
  return names.length === 0 ? `Units ${index}` : names.join(" + ")
}

type RawRecord = Record<string, any>

export const mapRawRunSummary = (run: unknown): RunSummaryDto => {
  const value = asRecord(run)
  const startedAt = optionalString(value.startedAt)
  const finishedAt = optionalString(value.finishedAt)
  const workflow = asRecord(value.execution?.plan)
  const progress = asRecord(value.progress)

  return {
    runId: stringValue(value.runId),
    projectId: stringValue(value.projectId),
    planId: stringValue(value.planId),
    workflowId: stringValue(value.workflowId),
    ...(optionalString(workflow.workflowName) === undefined ? {} : { workflowName: optionalString(workflow.workflowName)! }),
    status: stringValue(value.status),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(durationFromStrings(startedAt, finishedAt) === undefined ? {} : { durationMs: durationFromStrings(startedAt, finishedAt)! }),
    ...(optionalString(value.failure?.message) === undefined ? {} : { failureMessage: optionalString(value.failure?.message)! }),
    ...(optionalString(value.cancellationReason) === undefined ? {} : { cancellationReason: optionalString(value.cancellationReason)! }),
    progress: {
      totalUnits: numberValue(progress.totalUnits),
      completedUnits: numberValue(progress.completedUnits),
      failedUnits: numberValue(progress.failedUnits),
      skippedUnits: numberValue(progress.skippedUnits),
    },
    controls: {
      canCancel: isCancelableStatus(stringValue(value.status)),
      canRetry: isRetryableStatus(stringValue(value.status)),
      canGc: arrayValue(value.artifacts).length + arrayValue(value.logs).length > 0,
    },
  }
}

export const mapRawPayloadMetadata = (payload: unknown): PayloadMetadataDto => {
  const value = asRecord(payload)
  const ref = optionalString(value.artifactRef) ?? stringValue(value.logRef)

  return {
    ref,
    runId: stringValue(value.runId),
    ...(optionalString(value.unitId) === undefined ? {} : { unitId: optionalString(value.unitId)! }),
    ...(optionalString(value.attemptId) === undefined ? {} : { attemptId: optionalString(value.attemptId)! }),
    name: stringValue(value.name),
    ...(optionalString(value.category) === undefined ? {} : { category: optionalString(value.category)! }),
    status: stringValue(value.status),
    ...(optionalNumber(value.sizeBytes) === undefined ? {} : { sizeBytes: optionalNumber(value.sizeBytes)! }),
    ...(optionalString(value.checksum) === undefined ? {} : { checksum: optionalString(value.checksum)! }),
    ...(optionalString(value.createdAt) === undefined ? {} : { createdAt: optionalString(value.createdAt)! }),
    ...(optionalString(value.expiresAt) === undefined ? {} : { expiresAt: optionalString(value.expiresAt)! }),
    ...(optionalString(value.createdAt) === undefined ? {} : { ageMillis: Date.now() - new Date(optionalString(value.createdAt)!).getTime() }),
    ...(optionalString(value.summary) === undefined ? {} : { summary: optionalString(value.summary)! }),
  }
}

export const mapRawEvent = (event: unknown): TimelineEventDto => {
  const value = asRecord(event)

  return {
    eventId: stringValue(value.eventId),
    type: stringValue(value._tag),
    sequence: numberValue(value.sequence),
    occurredAt: stringValue(value.occurredAt),
    ...(optionalString(value.unitId) === undefined ? {} : { unitId: optionalString(value.unitId)! }),
    ...(optionalString(value.attemptId) === undefined ? {} : { attemptId: optionalString(value.attemptId)! }),
    ...(optionalString(value.artifact?.artifactRef) === undefined ? {} : { artifactRef: optionalString(value.artifact?.artifactRef)! }),
    ...(optionalString(value.log?.logRef) === undefined ? {} : { logRef: optionalString(value.log?.logRef)! }),
    message: describeRawEvent(value),
  }
}

export const mapRawRunDetail = (
  run: unknown,
  events: ReadonlyArray<unknown>,
  artifacts: ReadonlyArray<unknown>,
  logs: ReadonlyArray<unknown>,
): RunDetailDto => {
  const value = asRecord(run)
  const plan = asRecord(value.execution?.plan)
  const planUnits = new Map(arrayValue(plan.units).map((unit) => [stringValue(asRecord(unit).unitId), asRecord(unit)] as const))
  const unitNames = new Map(arrayValue(plan.units).map((unit) => {
    const item = asRecord(unit)
    const unitId = stringValue(item.unitId)
    return [unitId, optionalString(item.name) ?? humanizeUnitName(unitId)] as const
  }))

  const units = arrayValue(value.units)
    .map<RunUnitDto>((unit) => {
      const item = asRecord(unit)
      const planUnit = planUnits.get(stringValue(item.unitId)) ?? {}
      const startedAt = optionalString(item.startedAt)
      const finishedAt = optionalString(item.finishedAt)

      return {
        unitId: stringValue(item.unitId),
        name: unitNames.get(stringValue(item.unitId)) ?? stringValue(item.unitId),
        status: stringValue(item.status),
        dependencies: arrayValue(item.dependencies).map(stringValue),
        dependencyNames: arrayValue(item.dependencies).map((dependency) => unitNames.get(stringValue(dependency)) ?? stringValue(dependency)),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(durationFromStrings(startedAt, finishedAt) === undefined ? {} : { durationMs: durationFromStrings(startedAt, finishedAt)! }),
        ...(optionalString(item.failure?.message) === undefined ? {} : { failureMessage: optionalString(item.failure?.message)! }),
        ...(optionalString(item.cancellationReason) === undefined ? {} : { cancellationReason: optionalString(item.cancellationReason)! }),
        ...(optionalString(item.skipReason) === undefined ? {} : { skipReason: optionalString(item.skipReason)! }),
        ...(optionalString(item.latestAttemptId) === undefined ? {} : { latestAttemptId: optionalString(item.latestAttemptId)! }),
        ...(optionalString(item.nextRetryAt) === undefined ? {} : { nextRetryAt: optionalString(item.nextRetryAt)! }),
        ...(mapRawPayloadDescriptor(planUnit.payloadDescriptor) === undefined ? {} : mapRawPayloadDescriptor(planUnit.payloadDescriptor)!),
        ...(planUnit.source === undefined ? {} : { source: mapRawSourceLocation(planUnit.source) }),
        attempts: arrayValue(item.attempts).map((attempt) => {
          const attemptValue = asRecord(attempt)
          const attemptStartedAt = optionalString(attemptValue.startedAt)
          const attemptFinishedAt = optionalString(attemptValue.finishedAt)

          return {
            attemptId: stringValue(attemptValue.attemptId),
            attemptNumber: numberValue(attemptValue.attemptNumber),
            status: stringValue(attemptValue.status),
            ...(attemptStartedAt === undefined ? {} : { startedAt: attemptStartedAt }),
            ...(attemptFinishedAt === undefined ? {} : { finishedAt: attemptFinishedAt }),
            ...(durationFromStrings(attemptStartedAt, attemptFinishedAt) === undefined ? {} : { durationMs: durationFromStrings(attemptStartedAt, attemptFinishedAt)! }),
            ...(optionalString(attemptValue.failure?.message) === undefined ? {} : { failureMessage: optionalString(attemptValue.failure?.message)! }),
            ...(optionalString(attemptValue.cancellationReason) === undefined ? {} : { cancellationReason: optionalString(attemptValue.cancellationReason)! }),
          }
        }),
        inputs: arrayValue(item.resolvedInputs).map((input) => {
          const inputValue = asRecord(input)
          return { name: stringValue(inputValue.name), value: inputValue.value, ...(optionalString(inputValue.source) === undefined ? {} : { source: optionalString(inputValue.source)! }) }
        }),
        outputs: arrayValue(item.outputs).map(mapRawOutputValue),
        reports: arrayValue(item.reports).map((report) => {
          const reportValue = asRecord(report)
          const artifact = asRecord(reportValue.artifact)
          return {
            name: stringValue(reportValue.name),
            format: stringValue(reportValue.format),
            artifactRef: stringValue(artifact.artifactRef),
            status: stringValue(artifact.status),
          }
        }),
        artifactCount: arrayValue(item.artifacts).length,
        logCount: arrayValue(item.logs).length,
      }
    })
    .sort((left, right) => left.unitId.localeCompare(right.unitId))

  return {
    run: mapRawRunSummary(value),
    source: {
      projectId: stringValue(value.projectId),
      planId: stringValue(value.planId),
      ...(optionalString(value.execution?.options?.workspacePath) === undefined ? {} : { workspacePath: optionalString(value.execution?.options?.workspacePath)! }),
      ...(optionalString(value.execution?.retriedFromRunId) === undefined ? {} : { retriedFromRunId: optionalString(value.execution?.retriedFromRunId)! }),
      triggers: arrayValue(plan.triggers).map(mapRawTrigger),
      metadata: Object.entries(asRecord(plan.metadata)).map(([key, raw]) => ({ key, value: stringifyUnknown(raw) })),
      diagnostics: [
        ...arrayValue(plan.diagnostics).map(mapRawPlanningDiagnostic),
        ...arrayValue(plan.units).flatMap((unit) => arrayValue(asRecord(unit).diagnostics).map(mapRawPlanningDiagnostic)),
      ],
    },
    stages: deriveStages(units),
    dependencies: arrayValue(value.units).flatMap((unit) => {
      const item = asRecord(unit)
      return arrayValue(item.dependencies).map((dependency) => ({ from: stringValue(dependency), to: stringValue(item.unitId) }))
    }),
    inputs: arrayValue(value.inputs).map((input) => {
      const inputValue = asRecord(input)
      return { name: stringValue(inputValue.name), value: inputValue.value, ...(optionalString(inputValue.source) === undefined ? {} : { source: optionalString(inputValue.source)! }) }
    }),
    outputs: arrayValue(value.outputs).map(mapRawOutputValue),
    reports: arrayValue(value.reports).map((report) => {
      const reportValue = asRecord(report)
      const artifact = asRecord(reportValue.artifact)
      return {
        name: stringValue(reportValue.name),
        format: stringValue(reportValue.format),
        artifactRef: stringValue(artifact.artifactRef),
        status: stringValue(artifact.status),
      }
    }),
    units,
    artifacts: artifacts.map(mapRawPayloadMetadata),
    logs: logs.map(mapRawPayloadMetadata),
    events: events.map(mapRawEvent),
  }
}

const mapRawPayloadDescriptor = (payload: unknown) => {
  const value = asRecord(payload)
  const command = arrayValue(value.command).map(stringValue).join(" ")
  if (command.length === 0 && optionalString(value.image) === undefined && optionalString(value.workingDirectory) === undefined) {
    return undefined
  }

  return {
    ...(command.length === 0 ? {} : { command }),
    ...(optionalString(value.image) === undefined ? {} : { image: optionalString(value.image)! }),
    ...(optionalString(value.workingDirectory) === undefined ? {} : { workingDirectory: optionalString(value.workingDirectory)! }),
  }
}

const mapRawSourceLocation = (source: unknown): SourceLocationDto => {
  const value = asRecord(source)
  return {
    ...(optionalString(value.file) === undefined ? {} : { file: optionalString(value.file)! }),
    ...(optionalNumber(value.line) === undefined ? {} : { line: optionalNumber(value.line)! }),
    ...(optionalNumber(value.column) === undefined ? {} : { column: optionalNumber(value.column)! }),
    ...(optionalString(value.origin) === undefined ? {} : { origin: optionalString(value.origin)! }),
  }
}

const mapRawOutputValue = (output: unknown): OutputValueDto => {
  const value = asRecord(output)
  return {
    name: stringValue(value.name),
    value: value.value,
    ...(optionalString(value.format) === undefined ? {} : { format: optionalString(value.format)! }),
    ...(optionalString(value.unitId) === undefined ? {} : { unitId: optionalString(value.unitId)! }),
    ...(optionalString(value.path) === undefined ? {} : { path: optionalString(value.path)! }),
  }
}

const mapRawPlanningDiagnostic = (diagnostic: unknown): PlanningDiagnosticDto => {
  const value = asRecord(diagnostic)
  return {
    severity: stringValue(value.severity),
    message: stringValue(value.message),
    ...(optionalString(value.unitId) === undefined ? {} : { unitId: optionalString(value.unitId)! }),
    ...(value.source === undefined ? {} : { source: mapRawSourceLocation(value.source) }),
  }
}

const mapRawTrigger = (trigger: unknown): TriggerDto => {
  const value = asRecord(trigger)
  return {
    type: stringValue(value._tag),
    summary: describeTrigger({
      _tag: stringValue(value._tag),
      branches: arrayValue(value.branches).map(stringValue),
      refs: arrayValue(value.refs).map(stringValue),
      tags: arrayValue(value.tags).map(stringValue),
    }),
  }
}

const describeRawEvent = (event: RawRecord) => {
  switch (stringValue(event._tag)) {
    case "RunCreated":
      return "Run created"
    case "RunStarted":
      return "Run started"
    case "RunResumed":
      return `Run resumed: ${stringValue(event.reason)}`
    case "RunCancellationRequested":
      return `Cancellation requested: ${stringValue(event.reason)}`
    case "RunSucceeded":
      return "Run succeeded"
    case "RunFailed":
      return `Run failed: ${stringValue(event.failure?.message)}`
    case "RunTimedOut":
      return `Run timed out: ${stringValue(event.failure?.message)}`
    case "RunCanceled":
      return `Run canceled: ${stringValue(event.reason)}`
    case "RunInterrupted":
      return `Run interrupted: ${stringValue(event.reason)}`
    case "UnitReady":
      return `${stringValue(event.unitId)} became ready`
    case "UnitDispatched":
      return `${stringValue(event.unitId)} dispatched`
    case "UnitSucceeded":
      return `${stringValue(event.unitId)} succeeded`
    case "UnitFailed":
      return `${stringValue(event.unitId)} failed: ${stringValue(event.failure?.message)}`
    case "UnitTimedOut":
      return `${stringValue(event.unitId)} timed out: ${stringValue(event.failure?.message)}`
    case "UnitSkipped":
      return `${stringValue(event.unitId)} skipped: ${stringValue(event.reason)}`
    case "AttemptStarted":
      return `${stringValue(event.unitId)} attempt ${numberValue(event.attemptNumber)} started`
    case "AttemptSucceeded":
      return `${stringValue(event.unitId)} attempt succeeded`
    case "AttemptFailed":
      return `${stringValue(event.unitId)} attempt failed: ${stringValue(event.failure?.message)}`
    case "AttemptTimedOut":
      return `${stringValue(event.unitId)} attempt timed out: ${stringValue(event.failure?.message)}`
    case "RetryScheduled":
      return `${stringValue(event.unitId)} retry ${numberValue(event.nextAttemptNumber)} scheduled: ${stringValue(event.reason)}`
    case "AttemptCanceled":
      return `${stringValue(event.unitId)} attempt canceled: ${stringValue(event.reason)}`
    case "LogRegistered":
      return `Log registered: ${stringValue(event.log?.name)}`
    case "ArtifactRegistered":
      return `Artifact registered: ${stringValue(event.artifact?.name)}`
    case "ReportRegistered":
      return `Report registered: ${stringValue(event.report?.name)}`
    case "ArtifactGcCompleted":
      return `Artifact GC deleted ${numberValue(event.deletedCount)} payloads`
    case "UnitCanceled":
      return `${stringValue(event.unitId)} canceled: ${stringValue(event.reason)}`
    default:
      return stringValue(event._tag)
  }
}

const asRecord = (value: unknown): RawRecord => (typeof value === "object" && value !== null ? (value as RawRecord) : {})
const arrayValue = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])
const stringValue = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""))
const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)
const numberValue = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0))
const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)
const durationFromStrings = (startedAt: string | undefined, finishedAt: string | undefined) =>
  startedAt === undefined || finishedAt === undefined ? undefined : new Date(finishedAt).getTime() - new Date(startedAt).getTime()
