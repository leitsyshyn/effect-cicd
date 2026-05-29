import { Effect } from "effect"
import * as Context from "effect/Context"

import { RunNotFound, StoreUnavailable, UnitNotFound } from "../../domain/errors.ts"
import { RunId, UnitId } from "../../domain/ids.ts"
import { ExecutionAttemptState, ExecutionUnitState, WorkflowRunState } from "../../domain/runtime-state.ts"

export class StateStore extends Context.Service<
  StateStore,
  {
    readonly createRun: (state: WorkflowRunState) => Effect.Effect<void, StoreUnavailable>
    readonly updateRun: (state: WorkflowRunState) => Effect.Effect<void, RunNotFound | StoreUnavailable>
    readonly getRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly updateUnit: (state: ExecutionUnitState) => Effect.Effect<void, UnitNotFound | StoreUnavailable>
    readonly updateAttempt: (state: ExecutionAttemptState) => Effect.Effect<void, UnitNotFound | StoreUnavailable>
    readonly listIncompleteRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
    readonly getUnit: (runId: RunId, unitId: UnitId) => Effect.Effect<ExecutionUnitState, UnitNotFound | StoreUnavailable>
  }
>()("@effect-cicd/engine/stores/StateStore") {}
