import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../../domain/artifacts.ts"
import { StoreUnavailable } from "../../domain/errors.ts"
import { ArtifactRef, LogRef } from "../../domain/ids.ts"

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    readonly registerArtifact: (metadata: ArtifactMetadata) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly registerLog: (metadata: LogMetadata) => Effect.Effect<LogMetadata, StoreUnavailable>
    readonly readArtifact: (ref: ArtifactRef) => Effect.Effect<ArtifactMetadata, StoreUnavailable>
    readonly readLog: (ref: LogRef) => Effect.Effect<LogMetadata, StoreUnavailable>
  }
>()("@effect-cicd/engine/stores/ArtifactStore") {
  static readonly memoryLayer = Layer.sync(ArtifactStore, () => {
    const artifacts = new Map<ArtifactRef, ArtifactMetadata>()
    const logs = new Map<LogRef, LogMetadata>()

    const registerArtifact = (metadata: ArtifactMetadata) =>
      Effect.sync(() => {
        artifacts.set(metadata.artifactRef, metadata)
        return metadata
      })

    const registerLog = (metadata: LogMetadata) =>
      Effect.sync(() => {
        logs.set(metadata.logRef, metadata)
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

    return { registerArtifact, registerLog, readArtifact, readLog }
  })
}
