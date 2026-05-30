import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { StoreUnavailable } from "../../domain/errors.ts"
import { RunId } from "../../domain/ids.ts"
import { WorkflowEvent } from "../../domain/events.ts"

export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: (event: WorkflowEvent) => Effect.Effect<void, StoreUnavailable>
    readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, StoreUnavailable>
  }
>()("@effect-cicd/engine/stores/EventLog") {
  static readonly memoryLayer = Layer.sync(EventLog, () => {
    const events = new Array<WorkflowEvent>()

    const append = (event: WorkflowEvent) =>
      Effect.sync(() => {
        events.push(event)
      })

    const readRunEvents = (runId: RunId) =>
      Effect.sync(() =>
        events
          .filter((event) => event.runId === runId)
          .sort((left, right) => left.sequence - right.sequence),
      )

    return { append, readRunEvents }
  })
}
