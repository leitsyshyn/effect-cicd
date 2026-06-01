import { Duration, Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { ArtifactGcCompleted } from "../../domain/events.ts"
import { EventId, RunId } from "../../domain/ids.ts"
import { ArtifactLifecycleConfig } from "../../runtime/config.ts"
import { logInfo } from "../../runtime/logger.ts"
import { ArtifactStore } from "./artifact-store.ts"
import { EventLog } from "./event-log.ts"

export class ArtifactGc extends Context.Service<
  ArtifactGc,
  {
    readonly runOnce: (now?: Date) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, never>
    readonly runForRun: (runId: RunId) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, never>
    readonly start: () => Effect.Effect<void, never>
  }
>()("@effect-cicd/engine/stores/ArtifactGc") {
  static readonly layer = Layer.effect(
    ArtifactGc,
    Effect.gen(function* () {
      const artifactStore = yield* ArtifactStore
      const eventLog = yield* EventLog
      const config = yield* ArtifactLifecycleConfig

      const appendEvent = (stats: { readonly deletedCount: number; readonly bytesFreed: number }) =>
        eventLog.append(
          new ArtifactGcCompleted({
            eventId: EventId.make(`event:artifact-gc:${crypto.randomUUID()}`),
            runId: RunId.make("run:artifact-gc"),
            occurredAt: new Date(),
            sequence: 0,
            deletedCount: stats.deletedCount,
            bytesFreed: stats.bytesFreed,
          }),
        ).pipe(Effect.catch(() => Effect.succeed(undefined)))

      const runOnce = (now = new Date()) =>
        artifactStore.runGc(now).pipe(
          Effect.tap((stats) => appendEvent(stats)),
          Effect.tap((stats) => logInfo("artifact gc completed", { module: "artifact-gc", deletedCount: stats.deletedCount, bytesFreed: stats.bytesFreed })),
          Effect.catch(() => Effect.succeed({ deletedCount: 0, bytesFreed: 0 })),
        )

      const runForRun = (runId: RunId) =>
        artifactStore.gcRunArtifacts(runId).pipe(
          Effect.tap((stats) => appendEvent(stats)),
          Effect.catch(() => Effect.succeed({ deletedCount: 0, bytesFreed: 0 })),
        )

      const start = () =>
        Effect.forever(Effect.sleep(Duration.minutes(config.gcIntervalMinutes)).pipe(Effect.andThen(runOnce()))).pipe(
          Effect.forkDetach({ startImmediately: true }),
          Effect.asVoid,
        )

      return { runOnce, runForRun, start }
    }),
  )
}
