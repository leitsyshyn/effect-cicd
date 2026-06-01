import { Clock, Duration, Effect, Layer, Option, Random, Schedule } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../domain/artifacts.ts"
import {
  ExecutorFailed,
  RunNotFound,
  StoreUnavailable,
  WorkflowInputsInvalid,
} from "../domain/errors.ts"
import {
  ArtifactRegistered,
  AttemptCanceled,
  AttemptFailed,
  AttemptStarted,
  AttemptSucceeded,
  AttemptTimedOut,
  LogRegistered,
  ReportRegistered,
  RetryScheduled,
  RunCanceled,
  RunCancellationRequested,
  RunCreated,
  RunFailed,
  RunResumed,
  RunStarted,
  RunSucceeded,
  RunTimedOut,
  UnitCanceled,
  UnitDispatched,
  UnitFailed,
  UnitReady,
  UnitSkipped,
  UnitSucceeded,
  UnitTimedOut,
  type WorkflowEvent,
} from "../domain/events.ts"
import { ExecutionPlan, PlanRetryPolicy, PlanTimeoutPolicy, PlanUnit } from "../domain/execution-plan.ts"
import { AttemptId, EventId, ProjectId, RunId, UnitId } from "../domain/ids.ts"
import { ProducedReport, ReportSummary } from "../domain/reports.ts"
import { isSecretRef } from "../domain/secrets.ts"
import {
  ExecutionAttemptState,
  ExecutionUnitState,
  FailureSummary,
  OutputValueSummary,
  ProgressSummary,
  ResolvedInputValue,
  RunExecutionContext,
  RunExecutionOptions,
  WorkflowRunState,
} from "../domain/runtime-state.ts"
import { StorageTransactor } from "../runtime/storage.ts"
import { logInfo } from "../runtime/logger.ts"
import { Metrics } from "../runtime/metrics.ts"
import { SecretStore } from "../secrets/store.ts"
import { DispatchInput, DispatchRequest, DispatchWorkspace, Executor, ExecutorFailureSummary, ExecutorResult } from "./executor.ts"
import { RunUpdate, RunUpdates } from "./run-updates.ts"
import { ArtifactStore } from "./stores/artifact-store.ts"
import { EventLog } from "./stores/event-log.ts"
import { StateStore } from "./stores/state-store.ts"

export interface RunStartOptions {
  readonly workspacePath?: string
  readonly inputValues?: Readonly<Record<string, unknown>>
}

export const containerWorkspaceMountPath = "/workspace"

export class Orchestrator extends Context.Service<
  Orchestrator,
  {
    readonly startRun: (
      plan: ExecutionPlan,
      options?: RunStartOptions,
    ) => Effect.Effect<WorkflowRunState, StoreUnavailable | WorkflowInputsInvalid>
    readonly createRun: (
      plan: ExecutionPlan,
      options?: RunStartOptions,
      retriedFromRunId?: RunId,
    ) => Effect.Effect<WorkflowRunState, StoreUnavailable | WorkflowInputsInvalid>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly advanceRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly cancelRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly finalizeCancellation: (
      runId: RunId,
      reason?: string,
    ) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly recoverIncompleteRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
    readonly resumeIncompleteRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
  }
>()("@effect-cicd/engine/Orchestrator") {
  static readonly layer = Layer.effect(
    Orchestrator,
    Effect.gen(function* () {
      const stateStore = yield* StateStore
      const eventLog = yield* EventLog
      const artifactStore = yield* ArtifactStore
      const executor = yield* Executor
      const secretStore = yield* SecretStore
      const storageTransactor = yield* StorageTransactor
      const runUpdates = yield* Effect.serviceOption(RunUpdates)
      const metrics = yield* Effect.serviceOption(Metrics)

      const metric = {
        incrementCounter: (name: string, labels?: Readonly<Record<string, string>>, value?: number) =>
          Option.match(metrics, { onNone: () => undefined, onSome: (service) => service.incrementCounter(name, labels, value) }),
        setGauge: (name: string, labels: Readonly<Record<string, string>> | undefined, value: number) =>
          Option.match(metrics, { onNone: () => undefined, onSome: (service) => service.setGauge(name, labels, value) }),
      }

      const eventSequences = new Map<RunId, number>()

      const appendEvent = (
        runId: RunId,
        makeEvent: (base: {
          readonly eventId: EventId
          readonly runId: RunId
          readonly occurredAt: Date
          readonly sequence: number
        }) => WorkflowEvent,
      ) =>
        Effect.gen(function* () {
          const sequence = (yield* nextEventSequence(runId)) + 1
          eventSequences.set(runId, sequence)

          const occurredAt = yield* nowDate
          const event = makeEvent({
            eventId: EventId.make(`event:${runId}:${sequence}`),
            runId,
            occurredAt,
            sequence,
          })

          yield* eventLog.append(event)
        })

      const nextEventSequence = (runId: RunId) =>
        Effect.gen(function* () {
          const knownSequence = eventSequences.get(runId)
          if (knownSequence !== undefined) {
            return knownSequence
          }

          const persistedEvents = yield* eventLog.readRunEvents(runId)
          const nextSequence = persistedEvents.at(-1)?.sequence ?? 0
          eventSequences.set(runId, nextSequence)
          return nextSequence
        })

      const publishRunUpdate = (run: WorkflowRunState, eventType?: string) =>
        Option.match(runUpdates, {
          onNone: () => Effect.void,
          onSome: (service) =>
            service.publish(
              new RunUpdate({
                runId: run.runId,
                status: run.status,
                updatedAt: run.updatedAt,
                terminal: isTerminalRun(run),
                eventType,
              }),
            ),
        })

      const persistRun = (run: WorkflowRunState) =>
        stateStore.updateRun(run).pipe(
          Effect.catchTag(
            "RunNotFound",
            () =>
              Effect.fail(
                new StoreUnavailable({
                  store: "StateStore",
                  message: `Run ${run.runId} disappeared during orchestration`,
                }),
              ),
          ),
        )

      const activateScheduledRetry: (
        runId: RunId,
        unitId: UnitId,
        scheduledAt: Date,
      ) => Effect.Effect<void, StoreUnavailable, never> = Effect.fn("Orchestrator.activateScheduledRetry")(function* (
        runId: RunId,
        unitId: UnitId,
        scheduledAt: Date,
      ) {
        const currentRun = yield* stateStore.getRun(runId).pipe(Effect.catchTag("RunNotFound", () => Effect.succeed(undefined)))
        if (currentRun === undefined || isTerminalRun(currentRun) || currentRun.status === "canceling") {
          return
        }

        const currentUnit = currentRun.units.find((candidate) => candidate.unitId === unitId)
        if (currentUnit === undefined || currentUnit.nextRetryAt?.getTime() !== scheduledAt.getTime()) {
          return
        }

        const updatedAt = yield* nowDate
        const nextRun = replaceUnit(
          currentRun,
          new ExecutionUnitState({
            ...currentUnit,
            status: "pending",
            finishedAt: undefined,
            failure: undefined,
            nextRetryAt: undefined,
          }),
          updatedAt,
        )
        
        yield* persistRun(nextRun)
        yield* publishRunUpdate(nextRun, "RetryReady")
        yield* advanceRun(runId).pipe(Effect.catchTag("RunNotFound", () => Effect.succeed(nextRun)), Effect.asVoid)
      })

      const createRun = Effect.fn("Orchestrator.createRun")(function* (
        plan: ExecutionPlan,
        options?: RunStartOptions,
        retriedFromRunId?: RunId,
      ) {
        const createdAt = yield* nowDate
        const runInputs = yield* resolveWorkflowInputs(plan, options)
        const run = createInitialRun(
          plan,
          RunId.make(`run:${plan.planId}:${crypto.randomUUID()}`),
          createdAt,
          runInputs,
          options,
          retriedFromRunId,
        )

        eventSequences.set(run.runId, 0)

        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* stateStore.createRun(run)
            yield* appendEvent(run.runId, (base) => new RunCreated(base))
          }),
        )
        yield* publishRunUpdate(run, "RunCreated")

        return run
      })

      const advanceWithRun: (initialRun: WorkflowRunState) => Effect.Effect<WorkflowRunState, StoreUnavailable, never> = Effect.fn("Orchestrator.advanceWithRun")(function* (initialRun: WorkflowRunState) {
        let run = initialRun
        const plan = run.execution.plan

        while (!isTerminalRun(run)) {
          if (run.status === "canceling") {
            return yield* finalizeCancellationState(run, "Cancellation requested")
          }

          const readyUnitIds = getReadyUnitIds(run)
          if (readyUnitIds.length === 0) {
            return run
          }

          for (const unitId of readyUnitIds) {
            run = yield* executeReadyUnit(plan, run, unitId)
            if (isTerminalRun(run)) {
              return run
            }
          }
        }

        return run
      })

      const executeReadyUnit: (
        plan: ExecutionPlan,
        initialRun: WorkflowRunState,
        unitId: UnitId,
      ) => Effect.Effect<WorkflowRunState, StoreUnavailable, never> = Effect.fn("Orchestrator.executeReadyUnit")(function* (
        plan: ExecutionPlan,
        initialRun: WorkflowRunState,
        unitId: UnitId,
      ) {
        const planUnit = yield* getPlanUnit(plan, unitId)
        const currentUnit = yield* getRunUnit(initialRun, unitId)
        const readyAt = yield* nowDate

        const readyUnit = new ExecutionUnitState({
          ...currentUnit,
          status: "ready",
          finishedAt: undefined,
          failure: undefined,
        })

        let run = replaceUnit(initialRun, readyUnit, readyAt)
        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* persistRun(run)
            yield* appendEvent(run.runId, (base) => new UnitReady({ ...base, unitId }))
          }),
        )
        yield* publishRunUpdate(run, "UnitReady")

        const attemptNumber = getNextAttemptNumber(currentUnit)
        const attemptId = AttemptId.make(`attempt:${run.runId}:${unitId}:${attemptNumber}`)
        const startedAt = yield* nowDate
        const runningAttempt = new ExecutionAttemptState({
          attemptId,
          runId: run.runId,
          unitId,
          attemptNumber,
          status: "running",
          startedAt,
          resolvedInputs: [],
          outputs: [],
          reports: [],
          artifacts: [],
          logs: [],
        })
        const runningUnit = replaceAttempt(
          new ExecutionUnitState({
            ...readyUnit,
            status: "running",
            latestAttemptId: attemptId,
            startedAt: readyUnit.startedAt ?? startedAt,
          }),
          runningAttempt,
        )

        run = replaceUnit(run, runningUnit, startedAt)
        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* persistRun(run)
            yield* appendEvent(run.runId, (base) => new UnitDispatched({ ...base, unitId, attemptId }))
            yield* appendEvent(
              run.runId,
              (base) =>
                new AttemptStarted({
                  ...base,
                  unitId,
                  attemptId,
                  attemptNumber,
                }),
            )
          }),
        )
        yield* publishRunUpdate(run, "AttemptStarted")

        const request = yield* buildDispatchRequest(secretStore, run, planUnit, attemptId, attemptNumber).pipe(
          Effect.catchTags({
            SecretBackendUnavailable: (error) =>
              Effect.succeed(secretResolutionFailureResult(run, unitId, attemptId, attemptNumber, error.message)),
            SecretNameInvalid: (error) =>
              Effect.succeed(secretResolutionFailureResult(run, unitId, attemptId, attemptNumber, error.message)),
            SecretNotFound: (error) =>
              Effect.succeed(secretResolutionFailureResult(run, unitId, attemptId, attemptNumber, `Secret ${error.key} not found`)),
          }),
        )

        const result =
          request instanceof DispatchRequest
            ? yield* Effect.onInterrupt(
                executeDispatch(executor, planUnit, request).pipe(
                  Effect.catchTag("ExecutorFailed", (error) => Effect.succeed(executorFailureResult(request, error))),
                ),
                () => finalizeCancellationState(run, `Cancellation requested while executing ${unitId}`).pipe(Effect.asVoid),
              )
            : request

        const attemptStartedAt = result.startedAt ?? runningAttempt.startedAt
        const finishedAt = result.finishedAt ?? (yield* nowDate)
        const logs = yield* registerLogs(run.runId, unitId, attemptId, result.logs, requestRedactionValues(request))
        const reports = yield* registerReports(run.runId, unitId, attemptId, result.reports)
        const artifacts = yield* registerArtifacts(run.runId, unitId, attemptId, result.artifacts)
        const resolvedInputs = request instanceof DispatchRequest ? toResolvedInputValues(planUnit, request) : []
        const outputValues = toOutputValueSummaries(planUnit, result.outputs)

        if (result.outcome === "succeeded") {
          const succeededAttempt = new ExecutionAttemptState({
            ...runningAttempt,
            status: "succeeded",
            startedAt: attemptStartedAt,
            finishedAt,
            resolvedInputs,
            outputs: outputValues,
            reports,
            logs,
            artifacts,
          })
          const succeededUnit = replaceAttempt(
            new ExecutionUnitState({
              ...runningUnit,
              status: "succeeded",
              finishedAt,
              resolvedInputs,
              outputs: outputValues,
              reports,
              logs: [...runningUnit.logs, ...logs],
              artifacts: [...runningUnit.artifacts, ...artifacts],
            }),
            succeededAttempt,
          )

          run = replaceUnit(appendRunPayloads(run, logs, artifacts, reports, finishedAt), succeededUnit, finishedAt)

          if (run.units.every((unit) => unit.status === "succeeded")) {
            run = finalizeRun(run, "succeeded", finishedAt)
          }

          yield* storageTransactor.run(
            Effect.gen(function* () {
              yield* persistRun(run)
              yield* appendEvent(run.runId, (base) => new AttemptSucceeded({ ...base, unitId, attemptId }))
              yield* appendEvent(run.runId, (base) => new UnitSucceeded({ ...base, unitId }))

              if (run.status === "succeeded") {
                yield* appendEvent(run.runId, (base) => new RunSucceeded(base))
              }
            }),
          )
          yield* publishRunUpdate(run, run.status === "succeeded" ? "RunSucceeded" : "UnitSucceeded")

          return run
        }

        if (result.outcome === "timed_out") {
          const failure = toFailureSummary(result)
          const timedOutAttempt = new ExecutionAttemptState({
            ...runningAttempt,
            status: "timed_out",
            startedAt: attemptStartedAt,
            finishedAt,
            failure,
            resolvedInputs,
            outputs: outputValues,
            reports,
            logs,
            artifacts,
          })
          const timedOutUnit = replaceAttempt(
            new ExecutionUnitState({
              ...runningUnit,
              status: "timed_out",
              finishedAt,
              failure,
              resolvedInputs,
              outputs: outputValues,
              reports,
              logs: [...runningUnit.logs, ...logs],
              artifacts: [...runningUnit.artifacts, ...artifacts],
            }),
            timedOutAttempt,
          )

          const skippedUnitIds = getBlockedDescendantUnitIds(plan, unitId)
          run = replaceUnit(appendRunPayloads(run, logs, artifacts, reports, finishedAt), timedOutUnit, finishedAt)
          run = applySkippedUnits(run, skippedUnitIds, finishedAt)
          run = finalizeRun(run, "timed_out", finishedAt, failure)

          yield* storageTransactor.run(
            Effect.gen(function* () {
              yield* persistRun(run)
              yield* appendEvent(run.runId, (base) => new AttemptTimedOut({ ...base, unitId, attemptId, failure }))
              yield* appendEvent(run.runId, (base) => new UnitTimedOut({ ...base, unitId, failure }))

              for (const skippedUnitId of skippedUnitIds) {
                const skippedUnit = run.units.find((unit) => unit.unitId === skippedUnitId)
                if (skippedUnit?.status === "skipped") {
                  yield* appendEvent(
                    run.runId,
                    (base) => new UnitSkipped({ ...base, unitId: skippedUnitId, reason: `Blocked by ${unitId}` }),
                  )
                }
              }

              yield* appendEvent(run.runId, (base) => new RunTimedOut({ ...base, failure }))
            }),
          )
          yield* publishRunUpdate(run, "RunTimedOut")

          return run
        }

        const failure = toFailureSummary(result)
        const failedAttempt = new ExecutionAttemptState({
          ...runningAttempt,
          status: "failed",
          startedAt: attemptStartedAt,
          finishedAt,
          failure,
          resolvedInputs,
          outputs: outputValues,
          reports,
          logs,
          artifacts,
        })
        const attemptFailedUnit = replaceAttempt(
            new ExecutionUnitState({
              ...runningUnit,
              latestAttemptId: attemptId,
              finishedAt: undefined,
              resolvedInputs,
              outputs: outputValues,
              reports,
              logs: [...runningUnit.logs, ...logs],
              artifacts: [...runningUnit.artifacts, ...artifacts],
            }),
            failedAttempt,
        )

        const retryPolicy = getRetryPolicy(planUnit)
        if (retryPolicy !== undefined && attemptNumber < retryPolicy.maxAttempts) {
          const delayMillis = yield* computeRetryDelayMillis(retryPolicy, attemptNumber)
          const scheduledAt = new Date(finishedAt.getTime() + delayMillis)
          run = replaceUnit(
            appendRunPayloads(run, logs, artifacts, reports, finishedAt),
            new ExecutionUnitState({
              ...attemptFailedUnit,
              status: "failed",
              finishedAt,
              failure,
              nextRetryAt: scheduledAt,
            }),
            finishedAt,
          )

          yield* storageTransactor.run(
            Effect.gen(function* () {
              yield* persistRun(run)
              yield* appendEvent(run.runId, (base) => new AttemptFailed({ ...base, unitId, attemptId, failure }))
              yield* appendEvent(
                run.runId,
                (base) =>
                  new RetryScheduled({
                    ...base,
                    unitId,
                    attemptId,
                    nextAttemptNumber: attemptNumber + 1,
                    reason: failure.message,
                    delayMillis,
                    scheduledAt,
                  }),
              )
            }),
          )
          yield* publishRunUpdate(run, "RetryScheduled")
          yield* Effect.sleep(Duration.millis(delayMillis)).pipe(
            Effect.andThen(activateScheduledRetry(run.runId, unitId, scheduledAt)),
            Effect.tap(() => logInfo("scheduled retry fired", { module: "orchestrator", runId: run.runId, unitId })),
            Effect.catch(() => Effect.succeed(undefined)),
            Effect.forkDetach({ startImmediately: true }),
            Effect.asVoid,
          )

          return run
        }

        const failedUnit = new ExecutionUnitState({
          ...attemptFailedUnit,
          status: "failed",
          finishedAt,
          failure,
        })

        const skippedUnitIds = getBlockedDescendantUnitIds(plan, unitId)
        run = replaceUnit(appendRunPayloads(run, logs, artifacts, reports, finishedAt), failedUnit, finishedAt)
        run = applySkippedUnits(run, skippedUnitIds, finishedAt)
        run = finalizeRun(run, "failed", finishedAt, failure)
        yield* Effect.sync(() => {
          metric.incrementCounter("units_total", { status: "failed" })
          metric.incrementCounter("runs_total", { status: "failed" })
          metric.setGauge("runs_active", undefined, 0)
        })

        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* persistRun(run)
            yield* appendEvent(run.runId, (base) => new AttemptFailed({ ...base, unitId, attemptId, failure }))
            yield* appendEvent(run.runId, (base) => new UnitFailed({ ...base, unitId, failure }))

            for (const skippedUnitId of skippedUnitIds) {
              const skippedUnit = run.units.find((unit) => unit.unitId === skippedUnitId)
              if (skippedUnit?.status === "skipped") {
                yield* appendEvent(
                  run.runId,
                  (base) => new UnitSkipped({ ...base, unitId: skippedUnitId, reason: `Blocked by ${unitId}` }),
                )
              }
            }

            yield* appendEvent(run.runId, (base) => new RunFailed({ ...base, failure }))
          }),
        )
        yield* publishRunUpdate(run, "RunFailed")

        return run
      })

      const finalizeCancellationState = Effect.fn("Orchestrator.finalizeCancellationState")(function* (
        initialRun: WorkflowRunState,
        reason: string,
      ) {
        if (isTerminalRun(initialRun)) {
          return initialRun
        }

        const run = yield* stateStore.getRun(initialRun.runId).pipe(
          Effect.catchTag("RunNotFound", () => Effect.succeed(initialRun)),
        )
        if (isTerminalRun(run)) {
          return run
        }

        const canceledAt = yield* nowDate
        const nextRun = cancelRunState(run, canceledAt, reason)
        const canceledUnitIds = nextRun.units
          .filter((unit, index) => run.units[index]?.status !== unit.status && unit.status === "canceled")
          .map((unit) => unit.unitId)

        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* persistRun(nextRun)

            for (const unit of nextRun.units) {
              const latestAttempt = unit.attempts.at(-1)
              const previousLatestAttempt = run.units.find((candidate) => candidate.unitId === unit.unitId)?.attempts.at(-1)
              if (
                latestAttempt !== undefined &&
                latestAttempt.status === "canceled" &&
                previousLatestAttempt?.status === "running"
              ) {
                yield* appendEvent(
                  nextRun.runId,
                  (base) => new AttemptCanceled({ ...base, unitId: unit.unitId, attemptId: latestAttempt.attemptId, reason }),
                )
              }
            }

            for (const canceledUnitId of canceledUnitIds) {
              yield* appendEvent(nextRun.runId, (base) => new UnitCanceled({ ...base, unitId: canceledUnitId, reason }))
            }

            yield* appendEvent(nextRun.runId, (base) => new RunCanceled({ ...base, reason }))
          }),
        )
        yield* Effect.sync(() => {
          metric.incrementCounter("runs_total", { status: "canceled" })
          metric.setGauge("runs_active", undefined, 0)
        })
        yield* publishRunUpdate(nextRun, "RunCanceled")

        return nextRun
      })

      const registerLogs = (
        runId: RunId,
        unitId: UnitId,
        attemptId: AttemptId,
        logs: ReadonlyArray<RegisteredLog>,
        redactionValues: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const registered = new Array<LogMetadata>()

          for (const log of logs) {
            const persisted = yield* artifactStore.registerLog(redactRegisteredLog(log, redactionValues))
            registered.push(persisted)
            yield* appendEvent(runId, (base) => new LogRegistered({ ...base, unitId, attemptId, log: persisted }))
          }

          return registered
        })

      const registerArtifacts = (
        runId: RunId,
        unitId: UnitId,
        attemptId: AttemptId,
        artifacts: ReadonlyArray<RegisteredArtifact>,
      ) =>
        Effect.gen(function* () {
          const registered = new Array<ArtifactMetadata>()

          for (const artifact of artifacts) {
            const persisted = yield* artifactStore.registerArtifact(artifact)
            registered.push(persisted)
            yield* appendEvent(
              runId,
              (base) => new ArtifactRegistered({ ...base, unitId, attemptId, artifact: persisted }),
            )
          }

          return registered
        })

      const registerReports = (
        runId: RunId,
        unitId: UnitId,
        attemptId: AttemptId,
        reports: ReadonlyArray<ProducedReport>,
      ) =>
        Effect.gen(function* () {
          const registered = new Array<ReportSummary>()

          for (const report of reports) {
            const persistedArtifact = yield* artifactStore.registerArtifact(report.artifact)
            const persistedReport = new ReportSummary({
              name: report.name,
              unitId,
              attemptId,
              format: report.format,
              contentType: report.contentType,
              artifact: persistedArtifact,
            })
            registered.push(persistedReport)
            yield* appendEvent(runId, (base) => new ArtifactRegistered({ ...base, unitId, attemptId, artifact: persistedArtifact }))
            yield* appendEvent(runId, (base) => new ReportRegistered({ ...base, unitId, attemptId, report: persistedReport }))
          }

          return registered
        })

      const startRun = Effect.fn("Orchestrator.startRun")(function* (plan: ExecutionPlan, options?: RunStartOptions) {
        const run = yield* createRun(plan, options)
        yield* Effect.sync(() => metric.setGauge("runs_active", undefined, 1))
        return yield* activateRun(run).pipe(Effect.flatMap(advanceWithRun))
      })

      const inspectRun = Effect.fn("Orchestrator.inspectRun")((runId: RunId) => stateStore.getRun(runId))

      const advanceRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable, never> = Effect.fn("Orchestrator.advanceRun")(function* (runId: RunId) {
        const currentRun = yield* stateStore.getRun(runId)
        const run = currentRun.status === "queued" ? yield* activateRun(currentRun) : currentRun
        if (isTerminalRun(run)) {
          return run
        }

        return yield* advanceWithRun(run)
      })

      const cancelRun = Effect.fn("Orchestrator.cancelRun")(function* (runId: RunId, reason = "Cancellation requested") {
        const run = yield* stateStore.getRun(runId)
        if (isTerminalRun(run)) {
          return run
        }

        const updatedAt = yield* nowDate
        const nextRun = new WorkflowRunState({
          ...run,
          status: "canceling",
          updatedAt,
        })

        yield* storageTransactor.run(
          Effect.gen(function* () {
            yield* persistRun(nextRun)
            yield* appendEvent(nextRun.runId, (base) => new RunCancellationRequested({ ...base, reason }))
          }),
        )
        yield* publishRunUpdate(nextRun, "RunCancellationRequested")

        return nextRun
      })

      const finalizeCancellation = Effect.fn("Orchestrator.finalizeCancellation")(function* (
        runId: RunId,
        reason = "Cancellation requested",
      ) {
        const run = yield* stateStore.getRun(runId)
        return yield* finalizeCancellationState(run, reason)
      })

      const recoverIncompleteRuns = Effect.fn("Orchestrator.recoverIncompleteRuns")(function* () {
        const runs = yield* stateStore.listIncompleteRuns()
        const recovered = new Array<WorkflowRunState>()

        for (const run of runs) {
          if (run.status === "queued") {
            recovered.push(run)
            continue
          }

          if (run.status === "canceling") {
            recovered.push(yield* finalizeCancellationState(run, "Cancellation requested before restart completed"))
            continue
          }

          const recoveredAt = yield* nowDate
          const nextRun = recoverRun(run, recoveredAt)

          yield* storageTransactor.run(
            Effect.gen(function* () {
              yield* persistRun(nextRun)
              yield* appendEvent(
                nextRun.runId,
                (base) => new RunResumed({ ...base, reason: "Resumed from persisted runtime state after restart" }),
              )
            }),
          )
          yield* publishRunUpdate(nextRun, "RunResumed")
          recovered.push(nextRun)
        }

        return recovered
      })

      const resumeIncompleteRuns = Effect.fn("Orchestrator.resumeIncompleteRuns")(function* () {
        const runs = yield* recoverIncompleteRuns()
        const resumed = new Array<WorkflowRunState>()

        for (const run of runs) {
          resumed.push(isTerminalRun(run) ? run : yield* (run.status === "queued" ? activateRun(run) : Effect.succeed(run)).pipe(Effect.flatMap(advanceWithRun)))
        }

        return resumed
      })

      return {
        startRun,
        createRun,
        inspectRun,
        advanceRun,
        cancelRun,
        finalizeCancellation,
        recoverIncompleteRuns,
        resumeIncompleteRuns,
      }

      function activateRun(queuedRun: WorkflowRunState) {
        return Effect.gen(function* () {
          if (queuedRun.status !== "queued") {
            return queuedRun
          }

          const startedAt = yield* nowDate
          const runningRun = new WorkflowRunState({
            ...queuedRun,
            status: "running",
            updatedAt: startedAt,
            startedAt,
          })

          yield* storageTransactor.run(
            Effect.gen(function* () {
              yield* persistRun(runningRun)
              yield* appendEvent(runningRun.runId, (base) => new RunStarted(base))
            }),
          )
          yield* publishRunUpdate(runningRun, "RunStarted")

          return runningRun
        })
      }
    }),
  )
}

const nowDate = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

const createInitialRun = (
  plan: ExecutionPlan,
  runId: RunId,
  createdAt: Date,
  inputs: ReadonlyArray<ResolvedInputValue>,
  options?: RunStartOptions,
  retriedFromRunId?: RunId,
) => {
  const units = plan.units.map(
    (unit) =>
      new ExecutionUnitState({
        runId,
        unitId: unit.unitId,
        status: "pending",
        dependencies: unit.dependencies,
        attempts: [],
        resolvedInputs: [],
        outputs: [],
        reports: [],
        artifacts: [],
        logs: [],
      }),
  )

  return new WorkflowRunState({
    runId,
    projectId: projectIdForPlan(plan),
    workflowId: plan.workflowId,
    planId: plan.planId,
    execution: new RunExecutionContext({
      plan,
      options: new RunExecutionOptions({ workspacePath: options?.workspacePath, inputValues: options?.inputValues }),
      submittedAt: createdAt,
      retriedFromRunId,
    }),
    status: "queued",
    units,
    progress: summarizeProgress(units),
    createdAt,
    updatedAt: createdAt,
    inputs: [...inputs],
    outputs: resolveWorkflowOutputs(plan, inputs, units),
    reports: [],
    artifacts: [],
    logs: [],
  })
}

const executorFailureResult = (request: DispatchRequest, error: ExecutorFailed) =>
  new ExecutorResult({
    runId: request.runId,
    unitId: request.unitId,
    attemptId: request.attemptId,
    attemptNumber: request.attemptNumber,
    outcome: "failed",
    exitCode: 1,
    failure: new ExecutorFailureSummary({ message: error.message }),
    outputs: {},
    reports: [],
    artifacts: [],
    logs: [],
    diagnostics: [],
  })

const executeDispatch = (executor: typeof Executor.Service, planUnit: PlanUnit, request: DispatchRequest) => {
  const timeoutSeconds = getTimeoutSeconds(planUnit)

  if (timeoutSeconds === undefined) {
    return executor.execute(request)
  }

  return executor.execute(request).pipe(
    Effect.timeout(`${timeoutSeconds} seconds`),
    Effect.catchTag(
      "TimeoutError",
      () =>
        Effect.succeed(
          new ExecutorResult({
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            attemptNumber: request.attemptNumber,
            outcome: "timed_out",
            exitCode: undefined,
            failure: new ExecutorFailureSummary({
              message: `Execution exceeded the ${timeoutSeconds} second timeout`,
              code: "timeout",
            }),
            outputs: {},
            reports: [],
            artifacts: [],
            logs: [],
            diagnostics: [`timed out after ${timeoutSeconds} seconds`],
          }),
        ),
    ),
  )
}

const buildDispatchRequest = (
  secretStore: typeof SecretStore.Service,
  run: WorkflowRunState,
  planUnit: PlanUnit,
  attemptId: AttemptId,
  attemptNumber: number,
) =>
  Effect.gen(function* () {
    const projectId = projectIdForRun(run)
    const resolvedEnv = new Map<string, string>()
    const secretEnvNames = new Array<string>()

    for (const [name, value] of Object.entries(planUnit.payloadDescriptor.env)) {
      if (isSecretRef(value)) {
        resolvedEnv.set(name, yield* secretStore.resolveSecret(projectId, value.key))
        secretEnvNames.push(name)
      } else {
        resolvedEnv.set(name, value)
      }
    }

    const resolvedInputs = resolveUnitInputs(run, planUnit)
    if (typeof resolvedInputs === "string") {
      return inputResolutionFailureResult(run, planUnit.unitId, attemptId, attemptNumber, resolvedInputs)
    }

    return new DispatchRequest({
      runId: run.runId,
      unitId: planUnit.unitId,
      attemptId,
      attemptNumber,
      payloadDescriptor: planUnit.payloadDescriptor,
      env: Object.fromEntries(resolvedEnv),
      secretEnvNames,
      workspace:
        run.execution.options.workspacePath === undefined
          ? undefined
          : new DispatchWorkspace({
              hostPath: run.execution.options.workspacePath,
              mountPath: containerWorkspaceMountPath,
            }),
      inputs: resolvedInputs,
      outputs: planUnit.outputs ?? [],
      reports: planUnit.reports ?? [],
      artifacts: planUnit.artifactExpectations,
      logNames: planUnit.logExpectations.map((log) => log.name),
      policies: planUnit.policies,
      correlation: {
        workflowId: run.workflowId.toString(),
        planId: run.planId.toString(),
        runId: run.runId.toString(),
        unitId: planUnit.unitId.toString(),
        attemptId: attemptId.toString(),
      },
    })
  })

const secretResolutionFailureResult = (
  run: WorkflowRunState,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: number,
  message: string,
) =>
  new ExecutorResult({
    runId: run.runId,
    unitId,
    attemptId,
    attemptNumber,
    outcome: "failed",
    exitCode: 1,
    failure: new ExecutorFailureSummary({ message }),
    outputs: {},
    reports: [],
    artifacts: [],
    logs: [],
    diagnostics: [],
  })

const inputResolutionFailureResult = (
  run: WorkflowRunState,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: number,
  message: string,
) =>
  new ExecutorResult({
    runId: run.runId,
    unitId,
    attemptId,
    attemptNumber,
    outcome: "failed",
    exitCode: 1,
    failure: new ExecutorFailureSummary({ message }),
    outputs: {},
    reports: [],
    artifacts: [],
    logs: [],
    diagnostics: [],
  })

const requestRedactionValues = (request: DispatchRequest | ExecutorResult) =>
  request instanceof DispatchRequest
    ? request.secretEnvNames
        .map((name) => request.env[name])
        .filter((value): value is string => value !== undefined && value.length > 0)
    : []

const redactRegisteredLog = (log: RegisteredLog, redactionValues: ReadonlyArray<string>) => {
  const content = redactText(log.content, redactionValues)

  return new RegisteredLog({
    metadata: new LogMetadata({
      ...log.metadata,
      summary: log.metadata.summary === undefined ? undefined : redactText(log.metadata.summary, redactionValues),
    }),
    content,
  })
}

const redactText = (text: string, redactionValues: ReadonlyArray<string>) => {
  let redacted = text

  for (const value of [...new Set(redactionValues)].sort((left, right) => right.length - left.length)) {
    if (value.length === 0) {
      continue
    }

    redacted = redacted.split(value).join("[REDACTED]")
  }

  return redacted
}

const projectIdForRun = (run: WorkflowRunState) => run.projectId

const projectIdForPlan = (plan: ExecutionPlan) => {
  const candidate = plan.metadata.projectId
  return ProjectId.make(typeof candidate === "string" && candidate.trim().length > 0 ? candidate : plan.workflowId.toString())
}

const resolveWorkflowInputs = (plan: ExecutionPlan, options?: RunStartOptions) =>
  Effect.gen(function* () {
    const providedValues = { ...(options?.inputValues ?? {}) }
    const declaredNames = new Set((plan.inputs ?? []).map((input) => input.name))

    for (const providedName of Object.keys(providedValues)) {
      if (!declaredNames.has(providedName)) {
        return yield* new WorkflowInputsInvalid({
          workflowId: plan.workflowId,
          message: `Unknown workflow input ${providedName}`,
        })
      }
    }

    const resolved = new Array<ResolvedInputValue>()

    for (const input of plan.inputs ?? []) {
      if (!(input.name in providedValues)) {
        return yield* new WorkflowInputsInvalid({
          workflowId: plan.workflowId,
          message: `Missing workflow input ${input.name}`,
        })
      }

      resolved.push(
        new ResolvedInputValue({
          name: input.name,
          value: providedValues[input.name],
          source: `workflow input ${input.name}`,
        }),
      )
    }

    return resolved
  })

const resolveUnitInputs = (run: WorkflowRunState, planUnit: PlanUnit): Array<DispatchInput> | string => {
  const resolved = new Array<DispatchInput>()

  for (const input of planUnit.inputs ?? []) {
    if (input.from._tag === "WorkflowInputSourceDeclaration") {
      const workflowSource = input.from as Extract<typeof input.from, { readonly _tag: "WorkflowInputSourceDeclaration" }>
      const workflowInput = (run.inputs ?? []).find((candidate) => candidate.name === workflowSource.inputName)
      if (workflowInput === undefined) {
        return `Unit ${planUnit.unitId} input ${input.name} could not resolve workflow input ${workflowSource.inputName}`
      }

      resolved.push(new DispatchInput({ name: input.name, value: workflowInput.value }))
      continue
    }

    const outputSource = input.from as Extract<typeof input.from, { readonly _tag: "UnitOutputSourceDeclaration" }>
    const producer = run.units.find((candidate) => candidate.unitId === outputSource.unitId)
    if (producer === undefined || producer.status !== "succeeded") {
      return `Unit ${planUnit.unitId} input ${input.name} could not resolve output ${outputSource.outputName} from ${outputSource.unitId}`
    }

    const producedOutput = (producer.outputs ?? []).find((output) => output.name === outputSource.outputName)
    if (producedOutput === undefined) {
      return `Unit ${planUnit.unitId} input ${input.name} could not resolve output ${outputSource.outputName} from ${outputSource.unitId}`
    }

    resolved.push(new DispatchInput({ name: input.name, value: producedOutput.value }))
  }

  return resolved
}

const toResolvedInputValues = (planUnit: PlanUnit, request: DispatchRequest) =>
  request.inputs.map((input) => {
    const declaration = (planUnit.inputs ?? []).find((candidate) => candidate.name === input.name)
    const source =
      declaration?.from._tag === "WorkflowInputSourceDeclaration"
        ? `workflow input ${declaration.from.inputName}`
        : declaration?.from._tag === "UnitOutputSourceDeclaration"
          ? `${declaration.from.unitId}.${declaration.from.outputName}`
          : (request.correlation.unitId ?? request.unitId.toString())

    return new ResolvedInputValue({
      name: input.name,
      value: input.value,
      source,
    })
  })

const getTimeoutSeconds = (planUnit: PlanUnit) =>
  planUnit.policies.reduce<number | undefined>(
    (seconds, policy) =>
      policy instanceof PlanTimeoutPolicy
        ? seconds === undefined
          ? policy.seconds
          : Math.min(seconds, policy.seconds)
        : seconds,
    undefined,
  )

const toOutputValueSummaries = (planUnit: PlanUnit, outputs: Readonly<Record<string, unknown>>) =>
  (planUnit.outputs ?? [])
    .filter((output) => output.name in outputs)
    .map(
      (output) =>
        new OutputValueSummary({
          name: output.name,
          value: outputs[output.name],
          format: output.format,
          unitId: planUnit.unitId,
          path: output.path,
        }),
    )

const withResolvedWorkflowOutputs = (run: WorkflowRunState) =>
  new WorkflowRunState({
    ...run,
    outputs: resolveWorkflowOutputs(run.execution.plan, run.inputs ?? [], run.units),
  })

const resolveWorkflowOutputs = (
  plan: ExecutionPlan,
  inputs: ReadonlyArray<ResolvedInputValue>,
  units: ReadonlyArray<ExecutionUnitState>,
) =>
  (plan.outputs ?? []).flatMap((output) => {
    if (output.from._tag === "WorkflowInputSourceDeclaration") {
      const workflowSource = output.from as Extract<typeof output.from, { readonly _tag: "WorkflowInputSourceDeclaration" }>
      const value = inputs.find((input) => input.name === workflowSource.inputName)
      return value === undefined
        ? []
        : [
            new OutputValueSummary({
              name: output.name,
              value: value.value,
              format: inferValueFormat(value.value),
            }),
          ]
    }

    const outputSource = output.from as Extract<typeof output.from, { readonly _tag: "UnitOutputSourceDeclaration" }>
    const unit = units.find((candidate) => candidate.unitId === outputSource.unitId)
    const value = (unit?.outputs ?? []).find((candidate) => candidate.name === outputSource.outputName)
    return value === undefined
      ? []
      : [
          new OutputValueSummary({
            name: output.name,
            value: value.value,
            format: value.format,
            unitId: outputSource.unitId,
            path: value.path,
          }),
        ]
  })

const inferValueFormat = (value: unknown) => (typeof value === "string" ? "text" : "json")

const summarizeProgress = (units: ReadonlyArray<ExecutionUnitState>) =>
  new ProgressSummary({
    totalUnits: units.length,
    completedUnits: units.filter((unit) => unit.status === "succeeded").length,
    failedUnits: units.filter((unit) => unit.status === "failed" || unit.status === "timed_out").length,
    skippedUnits: units.filter((unit) => unit.status === "skipped").length,
  })

const replaceUnit = (run: WorkflowRunState, nextUnit: ExecutionUnitState, updatedAt: Date) => {
  const units = run.units.map((unit) => (unit.unitId === nextUnit.unitId ? nextUnit : unit))

  return withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      units,
      progress: summarizeProgress(units),
      updatedAt,
    }),
  )
}

const replaceAttempt = (unit: ExecutionUnitState, nextAttempt: ExecutionAttemptState) => {
  const attempts = [...unit.attempts]
  const index = attempts.findIndex((attempt) => attempt.attemptId === nextAttempt.attemptId)

  if (index === -1) {
    attempts.push(nextAttempt)
  } else {
    attempts[index] = nextAttempt
  }

  return new ExecutionUnitState({
    ...unit,
    latestAttemptId: nextAttempt.attemptId,
    attempts,
  })
}

const appendRunPayloads = (
  run: WorkflowRunState,
  logs: ReadonlyArray<LogMetadata>,
  artifacts: ReadonlyArray<ArtifactMetadata>,
  reports: ReadonlyArray<ReportSummary>,
  updatedAt: Date,
) =>
  withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      logs: [...run.logs, ...logs],
      artifacts: [...run.artifacts, ...artifacts],
      reports: [...(run.reports ?? []), ...reports],
      updatedAt,
    }),
  )

const finalizeRun = (
  run: WorkflowRunState,
  status: "succeeded" | "failed" | "timed_out",
  finishedAt: Date,
  failure?: FailureSummary,
) =>
  withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      status,
      updatedAt: finishedAt,
      finishedAt,
      failure,
      progress: summarizeProgress(run.units),
    }),
  )

const applySkippedUnits = (run: WorkflowRunState, skippedUnitIds: ReadonlyArray<UnitId>, finishedAt: Date) => {
  const skippedIds = new Set(skippedUnitIds)
  const units = run.units.map((unit) => {
    if (!skippedIds.has(unit.unitId) || (unit.status !== "pending" && unit.status !== "ready")) {
      return unit
    }

    return new ExecutionUnitState({
      ...unit,
      status: "skipped",
      finishedAt,
    })
  })

  return withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      units,
      progress: summarizeProgress(units),
      updatedAt: finishedAt,
    }),
  )
}

const recoverRun = (run: WorkflowRunState, recoveredAt: Date) => {
  const units = run.units.map((unit) => {
    const attempts = unit.attempts.map((attempt) => {
      if (attempt.status !== "running") {
        return attempt
      }

      return new ExecutionAttemptState({
        ...attempt,
        status: "interrupted",
        finishedAt: recoveredAt,
      })
    })

    if (unit.status === "succeeded" || unit.status === "failed" || unit.status === "skipped" || unit.status === "canceled") {
      return new ExecutionUnitState({
        ...unit,
        attempts,
      })
    }

    return new ExecutionUnitState({
      ...unit,
      status: "pending",
      finishedAt: undefined,
      failure: undefined,
      cancellationReason: undefined,
      resolvedInputs: [],
      outputs: [],
      reports: [],
      attempts,
    })
  })

  return withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      status: "running",
      units,
      updatedAt: recoveredAt,
      finishedAt: undefined,
      failure: undefined,
      cancellationReason: undefined,
      progress: summarizeProgress(units),
    }),
  )
}

const cancelRunState = (run: WorkflowRunState, canceledAt: Date, reason: string) => {
  const units = run.units.map((unit) => {
    const attempts = unit.attempts.map((attempt) => {
      if (attempt.status !== "running") {
        return attempt
      }

      return new ExecutionAttemptState({
        ...attempt,
        status: "canceled",
        finishedAt: canceledAt,
        cancellationReason: reason,
      })
    })

    if (terminalUnitStatuses.has(unit.status)) {
      return new ExecutionUnitState({
        ...unit,
        attempts,
      })
    }

    return new ExecutionUnitState({
      ...unit,
      status: "canceled",
      finishedAt: canceledAt,
      failure: undefined,
      cancellationReason: reason,
      attempts,
    })
  })

  return withResolvedWorkflowOutputs(
    new WorkflowRunState({
      ...run,
      status: "canceled",
      units,
      updatedAt: canceledAt,
      finishedAt: canceledAt,
      failure: undefined,
      cancellationReason: reason,
      progress: summarizeProgress(units),
    }),
  )
}

const toFailureSummary = (result: ExecutorResult) =>
  new FailureSummary({
    message: result.failure?.message ?? `Execution ${result.outcome} for ${result.unitId}`,
    code: result.failure?.code,
  })

const isTerminalRun = (run: WorkflowRunState) => terminalRunStatuses.has(run.status)

const getReadyUnitIds = (run: WorkflowRunState) =>
  run.units
    .filter(
      (unit) =>
        unit.status === "pending" &&
        unit.dependencies.every((dependency) => run.units.find((candidate) => candidate.unitId === dependency)?.status === "succeeded"),
    )
    .map((unit) => unit.unitId)
    .sort(compareUnitIds)

const getPlanUnit = (plan: ExecutionPlan, unitId: UnitId) => {
  const unit = plan.units.find((candidate) => candidate.unitId === unitId)

  return unit === undefined
    ? Effect.fail(
        new StoreUnavailable({
          store: "Orchestrator",
          message: `Execution plan missing unit ${unitId}`,
        }),
      )
    : Effect.succeed(unit)
}

const getRunUnit = (run: WorkflowRunState, unitId: UnitId) => {
  const unit = run.units.find((candidate) => candidate.unitId === unitId)

  return unit === undefined
    ? Effect.fail(
        new StoreUnavailable({
          store: "Orchestrator",
          message: `Workflow run ${run.runId} missing state for unit ${unitId}`,
        }),
      )
    : Effect.succeed(unit)
}

const getBlockedDescendantUnitIds = (plan: ExecutionPlan, failedUnitId: UnitId) => {
  const descendants = new Set<UnitId>()
  const queue = [failedUnitId]

  while (queue.length > 0) {
    const current = queue.shift()!

    for (const dependency of plan.dependencies) {
      if (dependency.from !== current || descendants.has(dependency.to)) {
        continue
      }

      descendants.add(dependency.to)
      queue.push(dependency.to)
    }
  }

  return [...descendants].sort(compareUnitIds)
}

const getNextAttemptNumber = (unit: ExecutionUnitState) =>
  unit.attempts.reduce((maxAttemptNumber, attempt) => Math.max(maxAttemptNumber, attempt.attemptNumber), 0) + 1

const getRetryPolicy = (planUnit: PlanUnit) =>
  planUnit.policies.reduce<PlanRetryPolicy | undefined>(
    (selected, policy) =>
      policy instanceof PlanRetryPolicy && (selected === undefined || policy.maxAttempts > selected.maxAttempts) ? policy : selected,
    undefined,
  )

const createRetrySchedule = (policy: PlanRetryPolicy) => {
  const base = Schedule.exponential(Duration.millis(policy.baseDelayMillis), policy.exponent)
  const withJitter =
    policy.jitter === "none"
      ? base
      : policy.jitter === "full"
        ? Schedule.jittered(base)
      : Schedule.modifyDelay(base, (_, delay) =>
          Random.next.pipe(
            Effect.map((random) => {
              const millis = Duration.toMillis(delay)
              const factor = 0.5 + random * 0.5
              return Duration.millis(millis * factor)
            }),
          ),
        )

  return Schedule.modifyDelay(withJitter, (_, delay) =>
    Effect.succeed(Duration.millis(Math.min(Duration.toMillis(delay), policy.maxDelayMillis))),
  )
}

const computeRetryDelayMillis = (policy: PlanRetryPolicy, attemptNumber: number) => {
  void createRetrySchedule(policy)
  const baseDelay = Math.min(policy.baseDelayMillis * Math.pow(policy.exponent, attemptNumber - 1), policy.maxDelayMillis)

  return policy.jitter === "none"
    ? Effect.succeed(baseDelay)
    : Random.next.pipe(
        Effect.map((random) => {
          const factor = policy.jitter === "full" ? random : 0.5 + random * 0.5
          return Math.round(Math.min(baseDelay * factor, policy.maxDelayMillis))
        }),
      )
}

const compareUnitIds = (left: UnitId, right: UnitId) => (left < right ? -1 : left > right ? 1 : 0)

const terminalRunStatuses = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"])

const terminalUnitStatuses = new Set(["succeeded", "failed", "timed_out", "skipped", "canceled"])
