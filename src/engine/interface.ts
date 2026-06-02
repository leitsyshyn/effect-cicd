import { Effect, Layer, Option, Stream } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { projectIdForRunSummary } from "../domain/project.ts"
import { appVersion } from "../runtime/version.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { ExecutionAttemptState, ExecutionUnitState, WorkflowRunState } from "../domain/runtime-state.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"
import { Orchestrator, type RunStartOptions } from "./orchestrator.ts"
import { RunController } from "./run-controller.ts"
import { RunUpdate, RunUpdates } from "./run-updates.ts"
import { ArtifactStore } from "./stores/artifact-store.ts"
import { ArtifactGc } from "./stores/artifact-gc.ts"
import { Planner } from "./planner.ts"
import { EventLog } from "./stores/event-log.ts"
import { StateStore } from "./stores/state-store.ts"

export class Engine extends Context.Service<
  Engine,
  {
    readonly validate: (definition: NormalizedWorkflowDefinition) => Effect.Effect<void, DomainError>
    readonly plan: (definition: NormalizedWorkflowDefinition) => Effect.Effect<ExecutionPlan, DomainError>
    readonly startDefinition: (definition: NormalizedWorkflowDefinition, options?: RunStartOptions) => Effect.Effect<WorkflowRunState, DomainError>
    readonly submitDefinition: (definition: NormalizedWorkflowDefinition, options?: RunStartOptions) => Effect.Effect<WorkflowRunState, DomainError>
    readonly startRun: (plan: ExecutionPlan, options?: RunStartOptions) => Effect.Effect<WorkflowRunState, DomainError>
    readonly submitRun: (plan: ExecutionPlan, options?: RunStartOptions) => Effect.Effect<WorkflowRunState, DomainError>
    readonly cancelRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, DomainError>
    readonly retryRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, DomainError>
    readonly listRuns: (projectId?: string) => Effect.Effect<ReadonlyArray<WorkflowRunState>, DomainError>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, DomainError>
    readonly streamRuns: () => Stream.Stream<RunUpdate, DomainError>
    readonly streamRun: (runId: RunId) => Stream.Stream<RunUpdate, DomainError>
    readonly readRunEvents: (runId: RunId) => Effect.Effect<ReadonlyArray<WorkflowEvent>, DomainError>
    readonly readArtifacts: (runId: RunId) => Effect.Effect<ReadonlyArray<ArtifactMetadata>, DomainError>
    readonly readArtifactPayload: (artifactRef: ArtifactRef) => Effect.Effect<string, DomainError>
    readonly deleteArtifact: (artifactRef: ArtifactRef) => Effect.Effect<void, DomainError>
    readonly readLogs: (runId: RunId) => Effect.Effect<ReadonlyArray<LogMetadata>, DomainError>
    readonly readLogPayload: (logRef: LogRef) => Effect.Effect<string, DomainError>
    readonly deleteLog: (logRef: LogRef) => Effect.Effect<void, DomainError>
    readonly gcRunArtifacts: (runId: RunId) => Effect.Effect<{ readonly deletedCount: number; readonly bytesFreed: number }, DomainError>
    readonly version: () => Effect.Effect<string, DomainError>
  }
>()("@effect-cicd/engine/Engine") {
  static readonly layer = Layer.effect(
    Engine,
    Effect.gen(function* () {
      const planner = yield* Planner
      const orchestrator = yield* Orchestrator
      const runController = yield* RunController
      const runUpdates = yield* Effect.serviceOption(RunUpdates)
      const stateStore = yield* StateStore
      const eventLog = yield* EventLog
      const artifactStore = yield* ArtifactStore
      const artifactGc = yield* Effect.serviceOption(ArtifactGc)

      const validate = Effect.fn("Engine.validate")((definition: NormalizedWorkflowDefinition) => planner.validate(definition))

      const plan = Effect.fn("Engine.plan")((definition: NormalizedWorkflowDefinition) => planner.plan(definition))

      const startDefinition = Effect.fn("Engine.startDefinition")((definition: NormalizedWorkflowDefinition, options?: RunStartOptions) =>
        plan(definition).pipe(Effect.flatMap((executionPlan) => orchestrator.startRun(executionPlan, options))),
      )

      const submitDefinition = Effect.fn("Engine.submitDefinition")((definition: NormalizedWorkflowDefinition, options?: RunStartOptions) =>
        plan(definition).pipe(Effect.flatMap((executionPlan) => runController.submitRun(executionPlan, options))),
      )

      const startRun = Effect.fn("Engine.startRun")((executionPlan: ExecutionPlan, options?: RunStartOptions) =>
        orchestrator.startRun(executionPlan, options),
      )

      const submitRun = Effect.fn("Engine.submitRun")((executionPlan: ExecutionPlan, options?: RunStartOptions) =>
        runController.submitRun(executionPlan, options),
      )

      const cancelRun = Effect.fn("Engine.cancelRun")((runId: RunId, reason?: string) => runController.cancelRun(runId, reason))

      const retryRun = Effect.fn("Engine.retryRun")((runId: RunId, reason?: string) => runController.retryRun(runId, reason))

      const listRuns = Effect.fn("Engine.listRuns")((projectId?: string) =>
        stateStore.listRuns().pipe(
          Effect.map((runs) =>
            projectId === undefined ? runs : runs.filter((run) => projectIdForRunSummary(run) === projectId),
          ),
        ),
      )

      const inspectRun = Effect.fn("Engine.inspectRun")((runId: RunId) => orchestrator.inspectRun(runId))

      const streamRuns = () => Option.match(runUpdates, { onNone: () => Stream.empty, onSome: (service) => service.stream() })

      const streamRun = (runId: RunId) =>
        Option.match(runUpdates, { onNone: () => Stream.empty, onSome: (service) => service.stream(runId) })

      const readRunEvents = Effect.fn("Engine.readRunEvents")((runId: RunId) => eventLog.readRunEvents(runId))

      const readArtifacts = Effect.fn("Engine.readArtifacts")((runId: RunId) =>
        inspectRun(runId).pipe(Effect.map((run) => run.artifacts)),
      )

      const readArtifactPayload = Effect.fn("Engine.readArtifactPayload")((artifactRef: ArtifactRef) =>
        artifactStore.readArtifactPayload(artifactRef),
      )

      const deleteArtifact = Effect.fn("Engine.deleteArtifact")((artifactRef: ArtifactRef) =>
        artifactStore.readArtifact(artifactRef).pipe(
          Effect.flatMap((metadata) =>
            artifactStore.deleteArtifact(artifactRef).pipe(
              Effect.andThen(markArtifactUnavailable(metadata.runId, artifactRef)),
            ),
          ),
          Effect.catchTag("StoreUnavailable", (error) =>
            error.message.includes("Artifact metadata not found") ? Effect.void : Effect.fail(error),
          ),
        ),
      )

      const readLogs = Effect.fn("Engine.readLogs")((runId: RunId) =>
        inspectRun(runId).pipe(Effect.map((run) => run.logs)),
      )

      const readLogPayload = Effect.fn("Engine.readLogPayload")((logRef: LogRef) => artifactStore.readLogPayload(logRef))

      const deleteLog = Effect.fn("Engine.deleteLog")((logRef: LogRef) =>
        artifactStore.readLog(logRef).pipe(
          Effect.flatMap((metadata) =>
            artifactStore.deleteLog(logRef).pipe(
              Effect.andThen(markLogUnavailable(metadata.runId, logRef)),
            ),
          ),
          Effect.catchTag("StoreUnavailable", (error) =>
            error.message.includes("Log metadata not found") ? Effect.void : Effect.fail(error),
          ),
        ),
      )

      const gcRunArtifacts = Effect.fn("Engine.gcRunArtifacts")((runId: RunId) =>
        Option.match(artifactGc, {
          onNone: () => Effect.succeed({ deletedCount: 0, bytesFreed: 0 }),
          onSome: (service) => service.runForRun(runId).pipe(Effect.tap(() => markRunPayloadsUnavailable(runId))),
        }),
      )

      const version = Effect.fn("Engine.version")(() => Effect.succeed(appVersion))

      return {
        validate,
        plan,
        startDefinition,
        submitDefinition,
        startRun,
        submitRun,
        cancelRun,
        retryRun,
        listRuns,
        inspectRun,
        streamRuns,
        streamRun,
        readRunEvents,
        readArtifacts,
        readArtifactPayload,
        deleteArtifact,
        readLogs,
        readLogPayload,
        deleteLog,
        gcRunArtifacts,
        version,
      }

      function markArtifactUnavailable(runId: RunId, artifactRef: ArtifactRef) {
        return stateStore.getRun(runId).pipe(
          Effect.flatMap((run) =>
            stateStore.updateRun(
              withRunPayloadUpdates(run, {
                artifacts: run.artifacts.map((artifact) =>
                  artifact.artifactRef === artifactRef ? new ArtifactMetadata({ ...artifact, status: "missing" }) : artifact,
                ),
              }),
            ),
          ),
          Effect.catchTag("RunNotFound", () => Effect.void),
          Effect.asVoid,
        )
      }

      function markLogUnavailable(runId: RunId, logRef: LogRef) {
        return stateStore.getRun(runId).pipe(
          Effect.flatMap((run) =>
            stateStore.updateRun(
              withRunPayloadUpdates(run, {
                logs: run.logs.map((log) => (log.logRef === logRef ? new LogMetadata({ ...log, status: "missing" }) : log)),
              }),
            ),
          ),
          Effect.catchTag("RunNotFound", () => Effect.void),
          Effect.asVoid,
        )
      }

      function markRunPayloadsUnavailable(runId: RunId) {
        return stateStore.getRun(runId).pipe(
          Effect.flatMap((run) =>
            stateStore.updateRun(
              withRunPayloadUpdates(run, {
                artifacts: run.artifacts.map((artifact) => new ArtifactMetadata({ ...artifact, status: "missing" })),
                logs: run.logs.map((log) => new LogMetadata({ ...log, status: "missing" })),
              }),
            ),
          ),
          Effect.catchTag("RunNotFound", () => Effect.void),
          Effect.asVoid,
        )
      }
    }),
  )
}

const withRunPayloadUpdates = (
  run: WorkflowRunState,
  updates: { readonly artifacts?: ReadonlyArray<ArtifactMetadata>; readonly logs?: ReadonlyArray<LogMetadata> },
) => {
  const artifacts = updates.artifacts ?? run.artifacts
  const logs = updates.logs ?? run.logs

  return new WorkflowRunState({
    ...run,
    units: run.units.map((unit) =>
      new ExecutionUnitState({
        ...unit,
        artifacts: mapArtifacts(unit.artifacts, artifacts),
        logs: mapLogs(unit.logs, logs),
        attempts: unit.attempts.map((attempt) =>
          new ExecutionAttemptState({
            ...attempt,
            artifacts: mapArtifacts(attempt.artifacts, artifacts),
            logs: mapLogs(attempt.logs, logs),
          }),
        ),
      }),
    ),
    artifacts,
    logs,
  })
}

const mapArtifacts = (current: ReadonlyArray<ArtifactMetadata>, next: ReadonlyArray<ArtifactMetadata>) => {
  const byRef = new Map(next.map((artifact) => [artifact.artifactRef, artifact] as const))
  return current.map((artifact) => byRef.get(artifact.artifactRef) ?? artifact)
}

const mapLogs = (current: ReadonlyArray<LogMetadata>, next: ReadonlyArray<LogMetadata>) => {
  const byRef = new Map(next.map((log) => [log.logRef, log] as const))
  return current.map((log) => byRef.get(log.logRef) ?? log)
}
