import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../src/domain/artifacts.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "../src/domain/ids.ts"
import { ArtifactGc } from "../src/engine/stores/artifact-gc.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { Executor } from "../src/engine/executor.ts"
import { RunUpdates } from "../src/engine/run-updates.ts"
import { SecretStore } from "../src/secrets/store.ts"
import { ArtifactLifecycleConfig, EngineServiceConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import { StorageTransactor } from "../src/runtime/storage.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { startServiceServer } from "../src/service/server.ts"

describe("artifact GC", () => {
  it.effect("artifact expires after its retention period", () =>
    Effect.gen(function* () {
      const artifactStore = yield* ArtifactStore
      const artifactGc = yield* ArtifactGc

      yield* artifactStore.registerArtifact(expiredArtifact("artifact:expired", new Date(0)))
      const stats = yield* artifactGc.runOnce(new Date(2 * 24 * 60 * 60 * 1000))
      const missingMetadata = yield* artifactStore.readArtifact(ArtifactRef.make("artifact:expired")).pipe(Effect.exit)
      const missingPayload = yield* artifactStore.readArtifactPayload(ArtifactRef.make("artifact:expired")).pipe(Effect.exit)

      expect(stats.deletedCount).toBe(1)
      expect(missingMetadata._tag).toBe("Failure")
      expect(missingPayload._tag).toBe("Failure")
    }).pipe(Effect.provide(memoryGcLayer())),
  )

  it.effect("GC skips non-expired artifacts", () =>
    Effect.gen(function* () {
      const artifactStore = yield* ArtifactStore
      const artifactGc = yield* ArtifactGc

      yield* artifactStore.registerArtifact(expiredArtifact("artifact:fresh", new Date(10 * 24 * 60 * 60 * 1000)))
      const stats = yield* artifactGc.runOnce(new Date(2 * 24 * 60 * 60 * 1000))
      const metadata = yield* artifactStore.readArtifact(ArtifactRef.make("artifact:fresh"))

      expect(stats.deletedCount).toBe(0)
      expect(metadata.artifactRef).toBe("artifact:fresh")
    }).pipe(Effect.provide(memoryGcLayer())),
  )

  it.live("manual deletion via API removes persisted payloads", () =>
    Effect.gen(function* () {
      const port = 40600 + Math.floor(Math.random() * 200)
      const baseUrl = `http://127.0.0.1:${port}`
      const serviceLayer = Layer.mergeAll(
        makeInMemoryServiceEngineLayer(),
        Layer.succeed(EngineServiceConfig, { baseUrl, port }),
        Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
        Layer.succeed(GitHubIntegration, {
          addBinding: () => Effect.die("unused"),
          listBindings: () => Effect.succeed([]),
          listProjects: () => Effect.succeed([]),
          acceptWebhook: () => Effect.die("unused"),
          handleWebhook: () => Effect.die("unused"),
          triggerPush: () => Effect.die("unused"),
        }),
        SecretStore.memoryLayer,
      )

      const server = yield* startServiceServer.pipe(Effect.provide(serviceLayer))
      const artifactStore = yield* ArtifactStore.pipe(Effect.provide(serviceLayer))
      const artifactRef = ArtifactRef.make("artifact:api-delete")
      yield* artifactStore.registerArtifact(expiredArtifact(artifactRef, new Date(10 * 24 * 60 * 60 * 1000))).pipe(Effect.provide(serviceLayer))

      const response = yield* Effect.promise(() => fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactRef)}`, { method: "DELETE" }))
      const deletedPayload = yield* Effect.promise(() => fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactRef)}`))

      expect(response.status).toBe(204)
      expect(deletedPayload.status).toBe(503)

      yield* Effect.tryPromise({ try: () => server.stop(true), catch: () => undefined })
    }),
  )

  it.effect("GC deletes both payload content and metadata", () =>
    Effect.gen(function* () {
      const artifactStore = yield* ArtifactStore
      const artifactGc = yield* ArtifactGc

      yield* artifactStore.registerArtifact(expiredArtifact("artifact:gc", new Date(0)))
      yield* artifactStore.registerLog(expiredLog("log:gc", new Date(0)))

      const stats = yield* artifactGc.runOnce(new Date(2 * 24 * 60 * 60 * 1000))
      const artifactState = yield* artifactStore.readArtifact(ArtifactRef.make("artifact:gc")).pipe(Effect.exit)
      const logState = yield* artifactStore.readLog(LogRef.make("log:gc")).pipe(Effect.exit)

      expect(stats.deletedCount).toBe(2)
      expect(artifactState._tag).toBe("Failure")
      expect(logState._tag).toBe("Failure")
    }).pipe(Effect.provide(memoryGcLayer())),
  )
})

const memoryGcLayer = () =>
  Layer.mergeAll(
    StorageTransactor.memoryLayer,
    StateStore.memoryLayer,
    EventLog.memoryLayer,
    ArtifactStore.memoryLayer,
    SecretStore.memoryLayer,
    Executor.testLayer(),
    RunUpdates.noopLayer,
    Layer.succeed(ArtifactLifecycleConfig, { retentionDays: 1, maxSizeMb: 1024, gcIntervalMinutes: 60 }),
    ArtifactGc.layer.pipe(
      Layer.provideMerge(ArtifactStore.memoryLayer),
      Layer.provideMerge(EventLog.memoryLayer),
      Layer.provideMerge(Layer.succeed(ArtifactLifecycleConfig, { retentionDays: 1, maxSizeMb: 1024, gcIntervalMinutes: 60 })),
    ),
  )

const expiredArtifact = (artifactRef: string | ArtifactRef, expiresAt: Date) =>
  new RegisteredArtifact({
    metadata: new ArtifactMetadata({
      artifactRef: ArtifactRef.make(artifactRef),
      runId: RunId.make("run:artifact-gc"),
      unitId: UnitId.make("unit:build"),
      attemptId: AttemptId.make("attempt:artifact-gc"),
      name: "dist",
      category: "build-output",
      status: "available",
      createdAt: new Date(0),
      expiresAt,
      retentionDays: 1,
      sizeBytes: 4,
      summary: "artifact",
    }),
    payloadBase64: Buffer.from("ok\n").toString("base64"),
    contentType: "text/plain",
  })

const expiredLog = (logRef: string, expiresAt: Date) =>
  new RegisteredLog({
    metadata: new LogMetadata({
      logRef: LogRef.make(logRef),
      runId: RunId.make("run:artifact-gc"),
      unitId: UnitId.make("unit:build"),
      attemptId: AttemptId.make("attempt:artifact-gc"),
      name: "stdout",
      status: "available",
      createdAt: new Date(0),
      expiresAt,
      retentionDays: 1,
      sizeBytes: 4,
      summary: "log",
    }),
    content: "ok\n",
  })
