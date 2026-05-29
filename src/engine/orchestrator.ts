import { Effect } from "effect"
import * as Context from "effect/Context"

import { PlanningFailed, RunNotFound, StoreUnavailable } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"

export class Orchestrator extends Context.Service<
  Orchestrator,
  {
    readonly startRun: (plan: ExecutionPlan) => Effect.Effect<WorkflowRunState, PlanningFailed | StoreUnavailable>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly advanceRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly resumeIncompleteRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
  }
>()("@effect-cicd/engine/Orchestrator") {}
