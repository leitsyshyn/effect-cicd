export interface RunSummaryDto {
  readonly runId: string
  readonly projectId: string
  readonly planId: string
  readonly workflowId: string
  readonly workflowName?: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly durationMs?: number
  readonly failureMessage?: string
  readonly cancellationReason?: string
  readonly progress: {
    readonly totalUnits: number
    readonly completedUnits: number
    readonly failedUnits: number
    readonly skippedUnits: number
  }
  readonly controls: {
    readonly canCancel: boolean
    readonly canRetry: boolean
    readonly canGc: boolean
  }
}

export interface RunUnitAttemptDto {
  readonly attemptId: string
  readonly attemptNumber: number
  readonly status: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly durationMs?: number
  readonly failureMessage?: string
  readonly cancellationReason?: string
}

export interface SourceLocationDto {
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly origin?: string
}

export interface ResolvedValueDto {
  readonly name: string
  readonly value: unknown
  readonly source?: string
}

export interface OutputValueDto {
  readonly name: string
  readonly value: unknown
  readonly source?: string
  readonly format?: string
  readonly unitId?: string
  readonly path?: string
}

export interface ReportDto {
  readonly name: string
  readonly format: string
  readonly artifactRef: string
  readonly status: string
}

export interface PlanningDiagnosticDto {
  readonly severity: string
  readonly message: string
  readonly unitId?: string
  readonly source?: SourceLocationDto
}

export interface TriggerDto {
  readonly type: string
  readonly summary: string
}

export interface RunUnitDto {
  readonly unitId: string
  readonly name: string
  readonly status: string
  readonly dependencies: ReadonlyArray<string>
  readonly dependencyNames: ReadonlyArray<string>
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly durationMs?: number
  readonly failureMessage?: string
  readonly cancellationReason?: string
  readonly skipReason?: string
  readonly latestAttemptId?: string
  readonly nextRetryAt?: string
  readonly command?: string
  readonly image?: string
  readonly workingDirectory?: string
  readonly source?: SourceLocationDto
  readonly attempts: ReadonlyArray<RunUnitAttemptDto>
  readonly inputs?: ReadonlyArray<ResolvedValueDto>
  readonly outputs?: ReadonlyArray<OutputValueDto>
  readonly reports?: ReadonlyArray<ReportDto>
  readonly artifactCount: number
  readonly logCount: number
}

export interface RunStageDto {
  readonly id: string
  readonly label: string
  readonly depth: number
  readonly units: ReadonlyArray<RunUnitDto>
}

export interface RunDependencyDto {
  readonly from: string
  readonly to: string
}

export interface PayloadMetadataDto {
  readonly ref: string
  readonly runId: string
  readonly unitId?: string
  readonly attemptId?: string
  readonly name: string
  readonly category?: string
  readonly status: string
  readonly sizeBytes?: number
  readonly checksum?: string
  readonly createdAt?: string
  readonly expiresAt?: string
  readonly ageMillis?: number
  readonly summary?: string
}

export interface TimelineEventDto {
  readonly eventId: string
  readonly type: string
  readonly sequence: number
  readonly occurredAt: string
  readonly unitId?: string
  readonly attemptId?: string
  readonly artifactRef?: string
  readonly logRef?: string
  readonly message: string
}

export interface RunSourceContextDto {
  readonly projectId: string
  readonly planId: string
  readonly workspacePath?: string
  readonly retriedFromRunId?: string
  readonly triggers: ReadonlyArray<TriggerDto>
  readonly metadata: ReadonlyArray<{ readonly key: string; readonly value: string }>
  readonly diagnostics: ReadonlyArray<PlanningDiagnosticDto>
}

export interface RunDetailDto {
  readonly run: RunSummaryDto
  readonly source: RunSourceContextDto
  readonly stages: ReadonlyArray<RunStageDto>
  readonly dependencies: ReadonlyArray<RunDependencyDto>
  readonly inputs?: ReadonlyArray<ResolvedValueDto>
  readonly outputs?: ReadonlyArray<OutputValueDto>
  readonly reports?: ReadonlyArray<ReportDto>
  readonly units: ReadonlyArray<RunUnitDto>
  readonly artifacts: ReadonlyArray<PayloadMetadataDto>
  readonly logs: ReadonlyArray<PayloadMetadataDto>
  readonly events: ReadonlyArray<TimelineEventDto>
}
