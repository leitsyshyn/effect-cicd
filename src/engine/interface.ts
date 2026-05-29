import { Effect } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { RunId } from "../domain/ids.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"

export class Engine extends Context.Service<
  Engine,
  {
    readonly validate: (definition: NormalizedWorkflowDefinition) => Effect.Effect<void, DomainError>
    readonly plan: (definition: NormalizedWorkflowDefinition) => Effect.Effect<ExecutionPlan, DomainError>
    readonly startRun: (plan: ExecutionPlan) => Effect.Effect<WorkflowRunState, DomainError>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, DomainError>
    readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, DomainError>
    readonly readArtifacts: (runId: RunId) => Effect.Effect<ReadonlyArray<ArtifactMetadata>, DomainError>
    readonly readLogs: (runId: RunId) => Effect.Effect<ReadonlyArray<LogMetadata>, DomainError>
  }
>()("@effect-cicd/engine/Engine") {}
