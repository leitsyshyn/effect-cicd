import { Effect } from "effect"
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
>()("@effect-cicd/engine/stores/EventLog") {}
