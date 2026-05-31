export interface RunSummaryDto {
  readonly runId: string
  readonly workflowId: string
  readonly workflowName?: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly failureMessage?: string
  readonly progress: {
    readonly totalUnits: number
    readonly completedUnits: number
    readonly failedUnits: number
    readonly skippedUnits: number
  }
}

export interface RunUnitAttemptDto {
  readonly attemptId: string
  readonly attemptNumber: number
  readonly status: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly failureMessage?: string
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
  readonly latestAttemptId?: string
  readonly attempts: ReadonlyArray<RunUnitAttemptDto>
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

export interface RunDetailDto {
  readonly run: RunSummaryDto
  readonly stages: ReadonlyArray<RunStageDto>
  readonly dependencies: ReadonlyArray<RunDependencyDto>
  readonly units: ReadonlyArray<RunUnitDto>
  readonly artifacts: ReadonlyArray<PayloadMetadataDto>
  readonly logs: ReadonlyArray<PayloadMetadataDto>
  readonly events: ReadonlyArray<TimelineEventDto>
}
