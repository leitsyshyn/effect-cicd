import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../../domain/artifacts.ts"
import { StoreUnavailable } from "../../domain/errors.ts"
import { ArtifactRef, LogRef } from "../../domain/ids.ts"
import { decodeArtifactMetadata, decodeLogMetadata, encodeArtifactMetadata, encodeLogMetadata } from "../../runtime/storage-codecs.ts"
import { ObjectStorageClient } from "../../runtime/storage.ts"

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    readonly registerArtifact: (artifact: RegisteredArtifact) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly registerLog: (log: RegisteredLog) => Effect.Effect<LogMetadata, StoreUnavailable>
    readonly readArtifact: (ref: ArtifactRef) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly readLog: (ref: LogRef) => Effect.Effect<LogMetadata, StoreUnavailable>
    readonly readLogPayload: (ref: LogRef) => Effect.Effect<string, StoreUnavailable>
  }
>()("@effect-cicd/engine/stores/ArtifactStore") {
  static readonly memoryLayer = Layer.sync(ArtifactStore, () => {
    const artifacts = new Map<ArtifactRef, ArtifactMetadata>()
    const logs = new Map<LogRef, LogMetadata>()
    const logPayloads = new Map<LogRef, string>()

    const registerArtifact = ({ metadata }: RegisteredArtifact) =>
      Effect.sync(() => {
        artifacts.set(metadata.artifactRef, metadata)
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

    return { registerArtifact, registerLog, readArtifact, readLog, readLogPayload }
  })

  static readonly s3Layer = Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const objectStorage = yield* ObjectStorageClient

      const registerArtifact = Effect.fn("ArtifactStore.registerArtifact")(function* ({ metadata, payloadBase64, contentType }: RegisteredArtifact) {
        const objectKey = objectStorage.qualifyKey(`artifacts/${metadata.artifactRef}`)

        if (payloadBase64 !== undefined) {
          const payload = Uint8Array.from(Buffer.from(payloadBase64, "base64"))
          yield* objectStorage.writeObject(objectKey, payload, contentType === undefined ? undefined : { contentType })
        }

        const metadataJson = JSON.stringify(encodeArtifactMetadata(metadata))

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
            metadata_json
          ) VALUES (
            ${metadata.artifactRef},
            ${metadata.runId},
            ${metadata.unitId ?? null},
            ${metadata.attemptId ?? null},
            ${metadata.name},
            ${metadata.category},
            ${metadata.status},
            ${objectStorage.bucket},
            ${objectKey},
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
            metadata_json = EXCLUDED.metadata_json
        `)

        return metadata
      })

      const registerLog = Effect.fn("ArtifactStore.registerLog")(function* ({ metadata, content }: RegisteredLog) {
        const objectKey = objectStorage.qualifyKey(`logs/${metadata.logRef}.log`)
        yield* objectStorage.writeObject(objectKey, content, { contentType: "text/plain; charset=utf-8" })

        const metadataJson = JSON.stringify(encodeLogMetadata(metadata))

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
            metadata_json
          ) VALUES (
            ${metadata.logRef},
            ${metadata.runId},
            ${metadata.unitId ?? null},
            ${metadata.attemptId ?? null},
            ${metadata.name},
            ${metadata.status},
            ${objectStorage.bucket},
            ${objectKey},
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
            metadata_json = EXCLUDED.metadata_json
        `)

        return metadata
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

      return { registerArtifact, registerLog, readArtifact, readLog, readLogPayload }
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
