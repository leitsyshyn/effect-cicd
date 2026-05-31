import { Effect, Layer, PubSub, Schema, Stream } from "effect"
import * as Context from "effect/Context"

import { RunId } from "../domain/ids.ts"
import { WorkflowRunStatus } from "../domain/runtime-state.ts"

export class RunUpdate extends Schema.Class<RunUpdate>("RunUpdate")({
  runId: RunId,
  status: WorkflowRunStatus,
  updatedAt: Schema.Date,
  terminal: Schema.Boolean,
  eventType: Schema.optional(Schema.String),
}) {}

export class RunUpdates extends Context.Service<
  RunUpdates,
  {
    readonly publish: (update: RunUpdate) => Effect.Effect<void>
    readonly stream: (runId?: RunId) => Stream.Stream<RunUpdate>
  }
>()("@effect-cicd/engine/RunUpdates") {
  static readonly layer = Layer.effect(
    RunUpdates,
    Effect.acquireRelease(PubSub.unbounded<RunUpdate>(), (pubsub) => PubSub.shutdown(pubsub)).pipe(
      Effect.map((pubsub) => ({
        publish: (update: RunUpdate) => PubSub.publish(pubsub, update),
        stream: (runId?: RunId) =>
          Stream.fromPubSub(pubsub).pipe(Stream.filter((update) => runId === undefined || update.runId === runId)),
      })),
    ),
  )

  static readonly noopLayer = Layer.succeed(RunUpdates, {
    publish: () => Effect.void,
    stream: () => Stream.empty,
  })
}
