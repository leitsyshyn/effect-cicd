import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"

import { ArtifactMetadata, LogMetadata } from "../src/domain/artifacts.ts"
import { ArtifactRegistered, RunCreated } from "../src/domain/events.ts"
import { ArtifactRef, AttemptId, EventId, LogRef, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { ExecutionAttemptState, ExecutionUnitState, ProgressSummary, WorkflowRunState } from "../src/domain/runtime-state.ts"
import { ObjectStorageConfig, PostgresConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import {
  decodeWorkflowEvent,
  decodeWorkflowRunState,
  encodeWorkflowEvent,
  encodeWorkflowRunState,
} from "../src/runtime/storage-codecs.ts"

describe("storage config", () => {
  it.effect("parses postgres, object storage, and runtime flags", () =>
    Effect.gen(function* () {
      const postgres = yield* PostgresConfig
      const objectStorage = yield* ObjectStorageConfig
      const runtime = yield* StorageRuntimeConfig

      expect(Redacted.value(postgres.url!)).toBe("postgres://ci:secret@localhost:5432/effect_cicd")
      expect(postgres.maxConnections).toBe(12)
      expect(objectStorage.bucket).toBe("effect-cicd-artifacts")
      expect(objectStorage.pathStyle).toBe(true)
      expect(objectStorage.prefix).toBe("dev/artifacts")
      expect(Redacted.value(objectStorage.secretAccessKey)).toBe("minio-secret")
      expect(runtime.runRecoveryOnStartup).toBe(false)
      expect(runtime.runStorageTests).toBe(true)
    }).pipe(Effect.provide(configLayer)),
  )
})

describe("storage codecs", () => {
  it("round-trips workflow run state and events", () => {
    const runId = RunId.make("run:codec")
    const attemptId = AttemptId.make("attempt:codec:1")
    const artifact = new ArtifactMetadata({
      artifactRef: ArtifactRef.make("artifact:codec"),
      runId,
      unitId: UnitId.make("unit:build"),
      attemptId,
      name: "dist",
      category: "build-output",
      status: "available",
      summary: "codec artifact",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    const log = new LogMetadata({
      logRef: LogRef.make("log:codec"),
      runId,
      unitId: UnitId.make("unit:build"),
      attemptId,
      name: "stdout",
      status: "available",
      summary: "codec stdout",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    })
    const attempt = new ExecutionAttemptState({
      attemptId,
      runId,
      unitId: UnitId.make("unit:build"),
      attemptNumber: 1,
      status: "succeeded",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      artifacts: [artifact],
      logs: [log],
    })
    const unit = new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:build"),
      status: "succeeded",
      dependencies: [],
      latestAttemptId: attemptId,
      attempts: [attempt],
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      artifacts: [artifact],
      logs: [log],
    })
    const run = new WorkflowRunState({
      runId,
      workflowId: WorkflowId.make("workflow:codec"),
      planId: PlanId.make("plan:codec"),
      status: "succeeded",
      units: [unit],
      progress: new ProgressSummary({
        totalUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
        skippedUnits: 0,
      }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:01:00.000Z"),
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      artifacts: [artifact],
      logs: [log],
    })
    const event = new ArtifactRegistered({
      eventId: EventId.make("event:codec:1"),
      runId,
      occurredAt: new Date("2026-01-01T00:01:01.000Z"),
      sequence: 1,
      unitId: UnitId.make("unit:build"),
      attemptId,
      artifact,
    })

    expect(decodeWorkflowRunState(encodeWorkflowRunState(run))).toEqual(run)
    expect(decodeWorkflowEvent(encodeWorkflowEvent(event))).toEqual(event)
    expect(decodeWorkflowEvent(encodeWorkflowEvent(new RunCreated({
      eventId: EventId.make("event:codec:0"),
      runId,
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      sequence: 0,
    })))).toEqual(
      new RunCreated({
        eventId: EventId.make("event:codec:0"),
        runId,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        sequence: 0,
      }),
    )
  })
})

const configLayer = Layer.mergeAll(PostgresConfig.layer, ObjectStorageConfig.layer, StorageRuntimeConfig.layer).pipe(
  Layer.provideMerge(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        POSTGRES_URL: "postgres://ci:secret@localhost:5432/effect_cicd",
        POSTGRES_MAX_CONNECTIONS: "12",
        S3_BUCKET: "effect-cicd-artifacts",
        S3_ACCESS_KEY: "minio-access",
        S3_SECRET_KEY: "minio-secret",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_PATH_STYLE: "true",
        S3_PREFIX: "/dev/artifacts/",
        RUN_RECOVERY_ON_STARTUP: "false",
        RUN_STORAGE_TESTS: "true",
      }),
    ),
  ),
)
