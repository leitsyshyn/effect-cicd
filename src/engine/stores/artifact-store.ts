import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../../domain/artifacts.ts"
import { StoreUnavailable } from "../../domain/errors.ts"
import { ArtifactRef, LogRef } from "../../domain/ids.ts"
import { ArtifactLifecycleConfig } from "../../runtime/config.ts"
import { decodeArtifactMetadata, decodeLogMetadata, encodeArtifactMetadata, encodeLogMetadata } from "../../runtime/storage-codecs.ts"
import { ObjectStorageClient } from "../../runtime/storage.ts"

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    readonly registerArtifact: (artifact: RegisteredArtifact) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly registerLog: (log: RegisteredLog) => Effect.Effect<LogMetadata, StoreUnavailable>
    readonly readArtifact: (ref: ArtifactRef) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly readArtifactPayload: (ref: ArtifactRef) => Effect.Effect<string, StoreUnavailable>
    readonly readLog: (ref: LogRef) => Effect.Effect<LogMetadata, StoreUnavailable>
    readonly readLogPayload: (ref: LogRef) => Effect.Effect<string, StoreUnavailable>
    readonly deleteArtifact: (ref: ArtifactRef) => Effect.Effect<void, StoreUnavailable>
    readonly deleteLog: (ref: LogRef) => Effect.Effect<void, StoreUnavailable>
    readonly gcRunArtifacts: (runId: string) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, StoreUnavailable>
    readonly runGc: (now?: Date) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, StoreUnavailable>
  }
>()("@effect-cicd/engine/stores/ArtifactStore") {
  static readonly memoryLayer = Layer.sync(ArtifactStore, () => {
    const artifacts = new Map<ArtifactRef, ArtifactMetadata>()
    const artifactPayloads = new Map<ArtifactRef, string>()
    const logs = new Map<LogRef, LogMetadata>()
    const logPayloads = new Map<LogRef, string>()

    const registerArtifact = ({ metadata, payloadBase64 }: RegisteredArtifact) =>
      Effect.sync(() => {
        artifacts.set(metadata.artifactRef, metadata)
        if (payloadBase64 !== undefined) {
          artifactPayloads.set(metadata.artifactRef, Buffer.from(payloadBase64, "base64").toString("utf-8"))
        }
        return metadata
      })

    const registerLog = ({ metadata, content }: RegisteredLog) =>
      Effect.sync(() => {
        logs.set(metadata.logRef, metadata)
        logPayloads.set(metadata.logRef, content)
        return metadata
      })

    const readArtifact = (ref: ArtifactRef) =>
      Effect.sync(() => artifacts.get(ref)).pipe(
        Effect.flatMap((metadata) =>
          metadata === undefined
            ? Effect.fail(
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Artifact metadata not found for ref ${ref}`,
                }),
              )
            : Effect.succeed(metadata),
        ),
      )

    const readArtifactPayload = (ref: ArtifactRef) =>
      Effect.sync(() => artifactPayloads.get(ref)).pipe(
        Effect.flatMap((payload) =>
          payload === undefined
            ? Effect.fail(
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Artifact payload not found for ref ${ref}`,
                }),
              )
            : Effect.succeed(payload),
        ),
      )

    const readLog = (ref: LogRef) =>
      Effect.sync(() => logs.get(ref)).pipe(
        Effect.flatMap((metadata) =>
          metadata === undefined
            ? Effect.fail(
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Log metadata not found for ref ${ref}`,
                }),
              )
            : Effect.succeed(metadata),
        ),
      )

    const readLogPayload = (ref: LogRef) =>
      Effect.sync(() => logPayloads.get(ref)).pipe(
        Effect.flatMap((payload) =>
          payload === undefined
            ? Effect.fail(
                new StoreUnavailable({
                  store: "ArtifactStore",
                  message: `Log payload not found for ref ${ref}`,
                }),
              )
            : Effect.succeed(payload),
        ),
      )

    const deleteArtifact = (ref: ArtifactRef) =>
      Effect.sync(() => {
        artifacts.delete(ref)
        artifactPayloads.delete(ref)
      })

    const deleteLog = (ref: LogRef) =>
      Effect.sync(() => {
        logs.delete(ref)
        logPayloads.delete(ref)
      })

    const gcRunArtifacts = (runId: string) =>
      Effect.sync(() => {
        let deletedCount = 0
        let bytesFreed = 0

        for (const [ref, metadata] of artifacts.entries()) {
          if (metadata.runId === runId) {
            deletedCount += 1
            bytesFreed += metadata.sizeBytes ?? 0
            artifacts.delete(ref)
            artifactPayloads.delete(ref)
          }
        }

        for (const [ref, metadata] of logs.entries()) {
          if (metadata.runId === runId) {
            deletedCount += 1
            bytesFreed += metadata.sizeBytes ?? 0
            logs.delete(ref)
            logPayloads.delete(ref)
          }
        }

        return { deletedCount, bytesFreed }
      })

    const runGc = (now = new Date()) =>
      Effect.sync(() => {
        let deletedCount = 0
        let bytesFreed = 0

        for (const [ref, metadata] of artifacts.entries()) {
          if (metadata.expiresAt !== undefined && metadata.expiresAt.getTime() <= now.getTime()) {
            deletedCount += 1
            bytesFreed += metadata.sizeBytes ?? 0
            artifacts.delete(ref)
            artifactPayloads.delete(ref)
          }
        }

        for (const [ref, metadata] of logs.entries()) {
          if (metadata.expiresAt !== undefined && metadata.expiresAt.getTime() <= now.getTime()) {
            deletedCount += 1
            bytesFreed += metadata.sizeBytes ?? 0
            logs.delete(ref)
            logPayloads.delete(ref)
          }
        }

        return { deletedCount, bytesFreed }
      })

    return { registerArtifact, registerLog, readArtifact, readArtifactPayload, readLog, readLogPayload, deleteArtifact, deleteLog, gcRunArtifacts, runGc }
  })

  static readonly s3Layer = Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const objectStorage = yield* ObjectStorageClient
      const lifecycleConfig = yield* ArtifactLifecycleConfig

      const withRetention = <A extends ArtifactMetadata | LogMetadata>(metadata: A): A => {
        const createdAt = metadata.createdAt ?? new Date()
        const retentionDays = metadata.retentionDays ?? lifecycleConfig.retentionDays
        const expiresAt = metadata.expiresAt ?? new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000)

        return new (metadata.constructor as new (args: A) => A)({
          ...metadata,
          createdAt,
          retentionDays,
          expiresAt,
        })
      }

      const registerArtifact = Effect.fn("ArtifactStore.registerArtifact")(function* ({ metadata, payloadBase64, contentType }: RegisteredArtifact) {
        const persistedMetadata = withRetention(metadata)
        const objectKey = objectStorage.qualifyKey(`artifacts/${metadata.artifactRef}`)

        if (payloadBase64 !== undefined) {
          const payload = Uint8Array.from(Buffer.from(payloadBase64, "base64"))
          yield* objectStorage.writeObject(objectKey, payload, contentType === undefined ? undefined : { contentType })
        }

        const metadataJson = JSON.stringify(encodeArtifactMetadata(persistedMetadata))

        yield* catchSql("register artifact metadata", sql`
          INSERT INTO artifact_metadata (
            artifact_ref,
            run_id,
            unit_id,
            attempt_id,
            name,
            category,
            status,
            bucket,
            object_key,
            expires_at,
            retention_days,
            metadata_json
          ) VALUES (
            ${persistedMetadata.artifactRef},
            ${persistedMetadata.runId},
            ${persistedMetadata.unitId ?? null},
            ${persistedMetadata.attemptId ?? null},
            ${persistedMetadata.name},
            ${persistedMetadata.category},
            ${persistedMetadata.status},
            ${objectStorage.bucket},
            ${objectKey},
            ${persistedMetadata.expiresAt ?? null},
            ${persistedMetadata.retentionDays ?? null},
            ${metadataJson}::jsonb
          )
          ON CONFLICT (artifact_ref) DO UPDATE SET
            run_id = EXCLUDED.run_id,
            unit_id = EXCLUDED.unit_id,
            attempt_id = EXCLUDED.attempt_id,
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            status = EXCLUDED.status,
            bucket = EXCLUDED.bucket,
            object_key = EXCLUDED.object_key,
            expires_at = EXCLUDED.expires_at,
            retention_days = EXCLUDED.retention_days,
            metadata_json = EXCLUDED.metadata_json
        `)

        return persistedMetadata
      })

      const registerLog = Effect.fn("ArtifactStore.registerLog")(function* ({ metadata, content }: RegisteredLog) {
        const persistedMetadata = withRetention(metadata)
        const objectKey = objectStorage.qualifyKey(`logs/${metadata.logRef}.log`)
        yield* objectStorage.writeObject(objectKey, content, { contentType: "text/plain; charset=utf-8" })

        const metadataJson = JSON.stringify(encodeLogMetadata(persistedMetadata))

        yield* catchSql("register log metadata", sql`
          INSERT INTO log_metadata (
            log_ref,
            run_id,
            unit_id,
            attempt_id,
            name,
            status,
            bucket,
            object_key,
            expires_at,
            retention_days,
            metadata_json
          ) VALUES (
            ${persistedMetadata.logRef},
            ${persistedMetadata.runId},
            ${persistedMetadata.unitId ?? null},
            ${persistedMetadata.attemptId ?? null},
            ${persistedMetadata.name},
            ${persistedMetadata.status},
            ${objectStorage.bucket},
            ${objectKey},
            ${persistedMetadata.expiresAt ?? null},
            ${persistedMetadata.retentionDays ?? null},
            ${metadataJson}::jsonb
          )
          ON CONFLICT (log_ref) DO UPDATE SET
            run_id = EXCLUDED.run_id,
            unit_id = EXCLUDED.unit_id,
            attempt_id = EXCLUDED.attempt_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            bucket = EXCLUDED.bucket,
            object_key = EXCLUDED.object_key,
            expires_at = EXCLUDED.expires_at,
            retention_days = EXCLUDED.retention_days,
            metadata_json = EXCLUDED.metadata_json
        `)

        return persistedMetadata
      })

      const readArtifact = Effect.fn("ArtifactStore.readArtifact")(function* (ref: ArtifactRef) {
        const rows = yield* catchSql("read artifact metadata", sql<{ readonly metadata_json: unknown }>`
          SELECT metadata_json
          FROM artifact_metadata
          WHERE artifact_ref = ${ref}
        `)

        const row = rows[0]
        if (row === undefined) {
          return yield* new StoreUnavailable({
            store: "ArtifactStore",
            message: `Artifact metadata not found for ref ${ref}`,
          })
        }

        return decodeArtifactMetadata(row.metadata_json)
      })

      const readArtifactRow = (ref: ArtifactRef) =>
        catchSql("read artifact metadata", sql<{ readonly metadata_json: unknown; readonly object_key: string }>`
          SELECT metadata_json, object_key
          FROM artifact_metadata
          WHERE artifact_ref = ${ref}
        `)

      const readArtifactPayload = Effect.fn("ArtifactStore.readArtifactPayload")(function* (ref: ArtifactRef) {
        const rows = yield* readArtifactRow(ref)
        const row = rows[0]

        if (row === undefined) {
          return yield* new StoreUnavailable({
            store: "ArtifactStore",
            message: `Artifact metadata not found for ref ${ref}`,
          })
        }

        return yield* objectStorage.readText(row.object_key)
      })

      const readLogRow = (ref: LogRef) =>
        catchSql("read log metadata", sql<{ readonly metadata_json: unknown; readonly object_key: string }>`
          SELECT metadata_json, object_key
          FROM log_metadata
          WHERE log_ref = ${ref}
        `)

      const readLog = Effect.fn("ArtifactStore.readLog")(function* (ref: LogRef) {
        const rows = yield* readLogRow(ref)
        const row = rows[0]

        if (row === undefined) {
          return yield* new StoreUnavailable({
            store: "ArtifactStore",
            message: `Log metadata not found for ref ${ref}`,
          })
        }

        return decodeLogMetadata(row.metadata_json)
      })

      const readLogPayload = Effect.fn("ArtifactStore.readLogPayload")(function* (ref: LogRef) {
        const rows = yield* readLogRow(ref)
        const row = rows[0]

        if (row === undefined) {
          return yield* new StoreUnavailable({
            store: "ArtifactStore",
            message: `Log metadata not found for ref ${ref}`,
          })
        }

        return yield* objectStorage.readText(row.object_key)
      })

      const deleteArtifact = Effect.fn("ArtifactStore.deleteArtifact")(function* (ref: ArtifactRef) {
        const rows = yield* catchSql("read artifact metadata", sql<{ readonly object_key: string }>`
          SELECT object_key
          FROM artifact_metadata
          WHERE artifact_ref = ${ref}
        `)

        const row = rows[0]
        if (row !== undefined) {
          yield* objectStorage.deleteObject(row.object_key)
        }

        yield* catchSql("delete artifact metadata", sql`DELETE FROM artifact_metadata WHERE artifact_ref = ${ref}`)
      })

      const deleteLog = Effect.fn("ArtifactStore.deleteLog")(function* (ref: LogRef) {
        const rows = yield* catchSql("read log metadata", sql<{ readonly object_key: string }>`
          SELECT object_key
          FROM log_metadata
          WHERE log_ref = ${ref}
        `)

        const row = rows[0]
        if (row !== undefined) {
          yield* objectStorage.deleteObject(row.object_key)
        }

        yield* catchSql("delete log metadata", sql`DELETE FROM log_metadata WHERE log_ref = ${ref}`)
      })

      const gcRunArtifacts = Effect.fn("ArtifactStore.gcRunArtifacts")(function* (runId: string) {
        const artifactRows = yield* catchSql("read run artifacts", sql<{ readonly artifact_ref: string; readonly object_key: string; readonly metadata_json: unknown }>`
          SELECT artifact_ref, object_key, metadata_json FROM artifact_metadata WHERE run_id = ${runId}
        `)
        const logRows = yield* catchSql("read run logs", sql<{ readonly log_ref: string; readonly object_key: string; readonly metadata_json: unknown }>`
          SELECT log_ref, object_key, metadata_json FROM log_metadata WHERE run_id = ${runId}
        `)

        let deletedCount = 0
        let bytesFreed = 0

        for (const row of artifactRows) {
          const metadata = decodeArtifactMetadata(row.metadata_json)
          yield* objectStorage.deleteObject(row.object_key)
          bytesFreed += metadata.sizeBytes ?? 0
          deletedCount += 1
        }
        for (const row of logRows) {
          const metadata = decodeLogMetadata(row.metadata_json)
          yield* objectStorage.deleteObject(row.object_key)
          bytesFreed += metadata.sizeBytes ?? 0
          deletedCount += 1
        }

        yield* catchSql("delete run artifact metadata", sql`DELETE FROM artifact_metadata WHERE run_id = ${runId}`)
        yield* catchSql("delete run log metadata", sql`DELETE FROM log_metadata WHERE run_id = ${runId}`)

        return { deletedCount, bytesFreed }
      })

      const runGc = Effect.fn("ArtifactStore.runGc")(function* (now = new Date()) {
        const artifactRows = yield* catchSql("read expired artifacts", sql<{ readonly artifact_ref: string; readonly object_key: string; readonly metadata_json: unknown }>`
          SELECT artifact_ref, object_key, metadata_json
          FROM artifact_metadata
          WHERE expires_at IS NOT NULL AND expires_at < ${now}
        `)
        const logRows = yield* catchSql("read expired logs", sql<{ readonly log_ref: string; readonly object_key: string; readonly metadata_json: unknown }>`
          SELECT log_ref, object_key, metadata_json
          FROM log_metadata
          WHERE expires_at IS NOT NULL AND expires_at < ${now}
        `)

        let deletedCount = 0
        let bytesFreed = 0

        for (const row of artifactRows) {
          const metadata = decodeArtifactMetadata(row.metadata_json)
          yield* objectStorage.deleteObject(row.object_key)
          bytesFreed += metadata.sizeBytes ?? 0
          deletedCount += 1
        }
        for (const row of logRows) {
          const metadata = decodeLogMetadata(row.metadata_json)
          yield* objectStorage.deleteObject(row.object_key)
          bytesFreed += metadata.sizeBytes ?? 0
          deletedCount += 1
        }

        if (artifactRows.length > 0) {
          yield* catchSql("delete expired artifact metadata", sql`DELETE FROM artifact_metadata WHERE expires_at IS NOT NULL AND expires_at < ${now}`)
        }
        if (logRows.length > 0) {
          yield* catchSql("delete expired log metadata", sql`DELETE FROM log_metadata WHERE expires_at IS NOT NULL AND expires_at < ${now}`)
        }

        return { deletedCount, bytesFreed }
      })

      return { registerArtifact, registerLog, readArtifact, readArtifactPayload, readLog, readLogPayload, deleteArtifact, deleteLog, gcRunArtifacts, runGc }
    }),
  )
}

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "ArtifactStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
