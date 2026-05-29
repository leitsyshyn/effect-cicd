import { Effect } from "effect"
import * as Context from "effect/Context"

import { PlanningFailed, WorkflowDefinitionInvalid } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"

export class Planner extends Context.Service<
  Planner,
  {
    readonly validate: (definition: NormalizedWorkflowDefinition) => Effect.Effect<void, WorkflowDefinitionInvalid>
    readonly plan: (
      definition: NormalizedWorkflowDefinition,
    ) => Effect.Effect<ExecutionPlan, WorkflowDefinitionInvalid | PlanningFailed>
  }
>()("@effect-cicd/engine/Planner") {}
