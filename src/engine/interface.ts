import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"
import { Orchestrator, type RunStartOptions } from "./orchestrator.ts"
import { ArtifactStore } from "./stores/artifact-store.ts"
import { Planner } from "./planner.ts"
import { EventLog } from "./stores/event-log.ts"
import { StateStore } from "./stores/state-store.ts"

export class Engine extends Context.Service<
  Engine,
  {
    readonly validate: (definition: NormalizedWorkflowDefinition) => Effect.Effect<void, DomainError>
    readonly plan: (definition: NormalizedWorkflowDefinition) => Effect.Effect<ExecutionPlan, DomainError>
    readonly startRun: (plan: ExecutionPlan, options?: RunStartOptions) => Effect.Effect<WorkflowRunState, DomainError>
    readonly listRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, DomainError>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, DomainError>
    readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, DomainError>
    readonly readArtifacts: (runId: RunId) => Effect.Effect<ReadonlyArray<ArtifactMetadata>, DomainError>
    readonly readArtifactPayload: (artifactRef: ArtifactRef) => Effect.Effect<string, DomainError>
    readonly readLogs: (runId: RunId) => Effect.Effect<ReadonlyArray<LogMetadata>, DomainError>
    readonly readLogPayload: (logRef: LogRef) => Effect.Effect<string, DomainError>
  }
>()("@effect-cicd/engine/Engine") {
  static readonly layer = Layer.effect(
    Engine,
    Effect.gen(function* () {
      const planner = yield* Planner
      const orchestrator = yield* Orchestrator
      const stateStore = yield* StateStore
      const eventLog = yield* EventLog
      const artifactStore = yield* ArtifactStore

      const validate = Effect.fn("Engine.validate")((definition: NormalizedWorkflowDefinition) => planner.validate(definition))

      const plan = Effect.fn("Engine.plan")((definition: NormalizedWorkflowDefinition) => planner.plan(definition))

      const startRun = Effect.fn("Engine.startRun")((executionPlan: ExecutionPlan, options?: RunStartOptions) =>
        orchestrator.startRun(executionPlan, options),
      )

      const listRuns = Effect.fn("Engine.listRuns")(() => stateStore.listRuns())

      const inspectRun = Effect.fn("Engine.inspectRun")((runId: RunId) => orchestrator.inspectRun(runId))

      const readRunEvents = Effect.fn("Engine.readRunEvents")((runId: RunId) => eventLog.readRunEvents(runId))

      const readArtifacts = Effect.fn("Engine.readArtifacts")((runId: RunId) =>
        inspectRun(runId).pipe(Effect.map((run) => run.artifacts)),
      )

      const readArtifactPayload = Effect.fn("Engine.readArtifactPayload")((artifactRef: ArtifactRef) =>
        artifactStore.readArtifactPayload(artifactRef),
      )

      const readLogs = Effect.fn("Engine.readLogs")((runId: RunId) =>
        inspectRun(runId).pipe(Effect.map((run) => run.logs)),
      )

      const readLogPayload = Effect.fn("Engine.readLogPayload")((logRef: LogRef) => artifactStore.readLogPayload(logRef))

      return {
        validate,
        plan,
        startRun,
        listRuns,
        inspectRun,
        readRunEvents,
        readArtifacts,
        readArtifactPayload,
        readLogs,
        readLogPayload,
      }
    }),
  )
}
