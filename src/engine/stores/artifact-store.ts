import { Effect } from "effect"
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
>()("@effect-cicd/engine/stores/ArtifactStore") {}
