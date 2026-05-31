import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { StoreUnavailable } from "../../domain/errors.ts"
import { RunId } from "../../domain/ids.ts"
import { WorkflowEvent } from "../../domain/events.ts"
import { decodeWorkflowEvent, encodeWorkflowEvent } from "../../runtime/storage-codecs.ts"

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

  static readonly postgresLayer = Layer.effect(
    EventLog,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const append = Effect.fn("EventLog.append")(function* (event: WorkflowEvent) {
        const eventJson = JSON.stringify(encodeWorkflowEvent(event))

        yield* catchSql("append workflow event", sql`
          INSERT INTO workflow_events (
            run_id,
            sequence,
            event_id,
            event_type,
            occurred_at,
            event_json
          ) VALUES (
            ${event.runId},
            ${event.sequence},
            ${event.eventId},
            ${event._tag},
            ${event.occurredAt},
            ${eventJson}::jsonb
          )
        `)
      })

      const readRunEvents = Effect.fn("EventLog.readRunEvents")(function* (runId: RunId) {
        const rows = yield* catchSql("read workflow events", sql<{ readonly event_json: unknown }>`
          SELECT event_json
          FROM workflow_events
          WHERE run_id = ${runId}
          ORDER BY sequence ASC
        `)

        return rows.map((row: { readonly event_json: unknown }) => decodeWorkflowEvent(row.event_json))
      })

      return { append, readRunEvents }
    }),
  )
}

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "EventLog",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
