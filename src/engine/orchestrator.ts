import { Clock, Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { ExecutorFailed, PlanningFailed, RunNotFound, StoreUnavailable } from "../domain/errors.ts"
import {
  ArtifactRegistered,
  AttemptFailed,
  AttemptStarted,
  AttemptSucceeded,
  LogRegistered,
  RunCreated,
  RunFailed,
  RunInterrupted,
  RunStarted,
  RunSucceeded,
  UnitDispatched,
  UnitFailed,
  UnitReady,
  UnitSkipped,
  UnitSucceeded,
  type WorkflowEvent,
} from "../domain/events.ts"
import { ExecutionPlan, PlanUnit } from "../domain/execution-plan.ts"
import { AttemptId, EventId, RunId, UnitId } from "../domain/ids.ts"
import { DispatchRequest, Executor, ExecutorFailureSummary, ExecutorResult } from "./executor.ts"
import {
  ExecutionAttemptState,
  ExecutionUnitState,
  FailureSummary,
  ProgressSummary,
  WorkflowRunState,
} from "../domain/runtime-state.ts"
import { ArtifactStore } from "./stores/artifact-store.ts"
import { EventLog } from "./stores/event-log.ts"
import { StateStore } from "./stores/state-store.ts"

export class Orchestrator extends Context.Service<
  Orchestrator,
  {
    readonly startRun: (plan: ExecutionPlan) => Effect.Effect<WorkflowRunState, PlanningFailed | StoreUnavailable>
    readonly inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly advanceRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
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

      const plans = new Map<RunId, ExecutionPlan>()
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
          const sequence = (eventSequences.get(runId) ?? 0) + 1
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

      const advanceWithPlan = Effect.fn("Orchestrator.advanceWithPlan")(function* (
        plan: ExecutionPlan,
        initialRun: WorkflowRunState,
      ) {
        let run = initialRun

        while (!isTerminalRun(run)) {
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

      const executeReadyUnit = Effect.fn("Orchestrator.executeReadyUnit")(function* (
        plan: ExecutionPlan,
        initialRun: WorkflowRunState,
        unitId: UnitId,
      ) {
        const planUnit = yield* getPlanUnit(plan, unitId)
        const readyAt = yield* nowDate

        const readyUnit = new ExecutionUnitState({
          ...(yield* getRunUnit(initialRun, unitId)),
          status: "ready",
        })

        let run = replaceUnit(initialRun, readyUnit, readyAt)
        yield* persistRun(run)
        yield* appendEvent(run.runId, (base) => new UnitReady({ ...base, unitId }))

        const attemptId = AttemptId.make(`attempt:${run.runId}:${unitId}:1`)
        const startedAt = yield* nowDate
        const runningAttempt = new ExecutionAttemptState({
          attemptId,
          runId: run.runId,
          unitId,
          attemptNumber: 1,
          status: "running",
          startedAt,
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
        yield* persistRun(run)
        yield* appendEvent(run.runId, (base) => new UnitDispatched({ ...base, unitId, attemptId }))
        yield* appendEvent(
          run.runId,
          (base) =>
            new AttemptStarted({
              ...base,
              unitId,
              attemptId,
              attemptNumber: 1,
            }),
        )

        const request = buildDispatchRequest(run, plan, planUnit, attemptId)
        const result = yield* executor.execute(request).pipe(
          Effect.catchTag("ExecutorFailed", (error) =>
            Effect.succeed(executorFailureResult(request, error)),
          ),
        )

        const attemptStartedAt = result.startedAt ?? runningAttempt.startedAt
        const finishedAt = result.finishedAt ?? (yield* nowDate)
        const logs = yield* registerLogs(run.runId, unitId, attemptId, result.logs)
        const artifacts = yield* registerArtifacts(run.runId, unitId, attemptId, result.artifacts)

        if (result.outcome === "succeeded") {
          const succeededAttempt = new ExecutionAttemptState({
            ...runningAttempt,
            status: "succeeded",
            startedAt: attemptStartedAt,
            finishedAt,
            logs,
            artifacts,
          })
          const succeededUnit = replaceAttempt(
            new ExecutionUnitState({
              ...runningUnit,
              status: "succeeded",
              finishedAt,
              logs: [...runningUnit.logs, ...logs],
              artifacts: [...runningUnit.artifacts, ...artifacts],
            }),
            succeededAttempt,
          )

          run = replaceUnit(appendRunPayloads(run, logs, artifacts, finishedAt), succeededUnit, finishedAt)

          if (run.units.every((unit) => unit.status === "succeeded")) {
            run = finalizeRun(run, "succeeded", finishedAt)
          }

          yield* persistRun(run)
          yield* appendEvent(run.runId, (base) => new AttemptSucceeded({ ...base, unitId, attemptId }))
          yield* appendEvent(run.runId, (base) => new UnitSucceeded({ ...base, unitId }))

          if (run.status === "succeeded") {
            yield* appendEvent(run.runId, (base) => new RunSucceeded(base))
          }

          return run
        }

        const failure = toFailureSummary(result)
        const failedAttempt = new ExecutionAttemptState({
          ...runningAttempt,
          status: "failed",
          startedAt: attemptStartedAt,
          finishedAt,
          failure,
          logs,
          artifacts,
        })
        const failedUnit = replaceAttempt(
          new ExecutionUnitState({
            ...runningUnit,
            status: "failed",
            finishedAt,
            failure,
            logs: [...runningUnit.logs, ...logs],
            artifacts: [...runningUnit.artifacts, ...artifacts],
          }),
          failedAttempt,
        )

        const skippedUnitIds = getBlockedDescendantUnitIds(plan, unitId)
        run = replaceUnit(appendRunPayloads(run, logs, artifacts, finishedAt), failedUnit, finishedAt)
        run = applySkippedUnits(run, skippedUnitIds, finishedAt)
        run = finalizeRun(run, "failed", finishedAt, failure)

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
        return run
      })

      const registerLogs = (
        runId: RunId,
        unitId: UnitId,
        attemptId: AttemptId,
        metadata: ReadonlyArray<LogMetadata>,
      ) =>
        Effect.gen(function* () {
          const registered = new Array<LogMetadata>()

          for (const log of metadata) {
            const persisted = yield* artifactStore.registerLog(log)
            registered.push(persisted)
            yield* appendEvent(runId, (base) => new LogRegistered({ ...base, unitId, attemptId, log: persisted }))
          }

          return registered
        })

      const registerArtifacts = (
        runId: RunId,
        unitId: UnitId,
        attemptId: AttemptId,
        metadata: ReadonlyArray<ArtifactMetadata>,
      ) =>
        Effect.gen(function* () {
          const registered = new Array<ArtifactMetadata>()

          for (const artifact of metadata) {
            const persisted = yield* artifactStore.registerArtifact(artifact)
            registered.push(persisted)
            yield* appendEvent(
              runId,
              (base) => new ArtifactRegistered({ ...base, unitId, attemptId, artifact: persisted }),
            )
          }

          return registered
        })

      const startRun = Effect.fn("Orchestrator.startRun")(function* (plan: ExecutionPlan) {
        const createdAt = yield* nowDate
        const run = createInitialRun(plan, createdAt)

        plans.set(run.runId, plan)
        eventSequences.set(run.runId, 0)

        yield* stateStore.createRun(run)
        yield* appendEvent(run.runId, (base) => new RunCreated(base))
        yield* appendEvent(run.runId, (base) => new RunStarted(base))

        return yield* advanceWithPlan(plan, run)
      })

      const inspectRun = Effect.fn("Orchestrator.inspectRun")((runId: RunId) => stateStore.getRun(runId))

      const advanceRun = Effect.fn("Orchestrator.advanceRun")(function* (runId: RunId) {
        const run = yield* stateStore.getRun(runId)
        if (isTerminalRun(run)) {
          return run
        }

        const plan = plans.get(runId)
        return plan === undefined ? run : yield* advanceWithPlan(plan, run)
      })

      const resumeIncompleteRuns = Effect.fn("Orchestrator.resumeIncompleteRuns")(function* () {
        const runs = yield* stateStore.listIncompleteRuns()
        const interrupted = new Array<WorkflowRunState>()

        for (const run of runs) {
          const interruptedAt = yield* nowDate
          const interruptedUnits = run.units.map((unit) => interruptUnit(unit, interruptedAt))
          const nextRun = new WorkflowRunState({
            ...run,
            status: "interrupted",
            updatedAt: interruptedAt,
            finishedAt: interruptedAt,
            units: interruptedUnits,
            progress: summarizeProgress(interruptedUnits),
          })

          yield* persistRun(nextRun)
          yield* appendEvent(
            nextRun.runId,
            (base) => new RunInterrupted({ ...base, reason: "Run interrupted during resume recovery" }),
          )
          interrupted.push(nextRun)
        }

        return interrupted
      })

      return {
        startRun,
        inspectRun,
        advanceRun,
        resumeIncompleteRuns,
      }
    }),
  )
}

const nowDate = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

const createInitialRun = (plan: ExecutionPlan, createdAt: Date) => {
  const runId = RunId.make(`run:${plan.planId}`)
  const units = plan.units.map(
    (unit) =>
      new ExecutionUnitState({
        runId,
        unitId: unit.unitId,
        status: "pending",
        dependencies: unit.dependencies,
        attempts: [],
        artifacts: [],
        logs: [],
      }),
  )

  return new WorkflowRunState({
    runId,
    workflowId: plan.workflowId,
    planId: plan.planId,
    status: "running",
    units,
    progress: summarizeProgress(units),
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
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
    artifacts: [],
    logs: [],
    diagnostics: [],
  })

const buildDispatchRequest = (run: WorkflowRunState, plan: ExecutionPlan, planUnit: PlanUnit, attemptId: AttemptId) =>
  new DispatchRequest({
    runId: run.runId,
    unitId: planUnit.unitId,
    attemptId,
    attemptNumber: 1,
    payloadDescriptor: planUnit.payloadDescriptor,
    inputs: [],
    artifactNames: planUnit.artifactExpectations.map((artifact) => artifact.name),
    logNames: planUnit.logExpectations.map((log) => log.name),
    policies: planUnit.policies,
    correlation: {
      workflowId: plan.workflowId.toString(),
      planId: plan.planId.toString(),
      runId: run.runId.toString(),
      unitId: planUnit.unitId.toString(),
      attemptId: attemptId.toString(),
    },
  })

const summarizeProgress = (units: ReadonlyArray<ExecutionUnitState>) =>
  new ProgressSummary({
    totalUnits: units.length,
    completedUnits: units.filter((unit) => unit.status === "succeeded").length,
    failedUnits: units.filter((unit) => unit.status === "failed").length,
    skippedUnits: units.filter((unit) => unit.status === "skipped").length,
  })

const replaceUnit = (run: WorkflowRunState, nextUnit: ExecutionUnitState, updatedAt: Date) => {
  const units = run.units.map((unit) => (unit.unitId === nextUnit.unitId ? nextUnit : unit))

  return new WorkflowRunState({
    ...run,
    units,
    progress: summarizeProgress(units),
    updatedAt,
  })
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
  updatedAt: Date,
) =>
  new WorkflowRunState({
    ...run,
    logs: [...run.logs, ...logs],
    artifacts: [...run.artifacts, ...artifacts],
    updatedAt,
  })

const finalizeRun = (
  run: WorkflowRunState,
  status: "succeeded" | "failed",
  finishedAt: Date,
  failure?: FailureSummary,
) =>
  new WorkflowRunState({
    ...run,
    status,
    updatedAt: finishedAt,
    finishedAt,
    failure,
    progress: summarizeProgress(run.units),
  })

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

  return new WorkflowRunState({
    ...run,
    units,
    progress: summarizeProgress(units),
    updatedAt: finishedAt,
  })
}

const interruptUnit = (unit: ExecutionUnitState, interruptedAt: Date) => {
  const attempts = unit.attempts.map((attempt) => {
    if (attempt.status !== "running") {
      return attempt
    }

    return new ExecutionAttemptState({
      ...attempt,
      status: "interrupted",
      finishedAt: interruptedAt,
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
    status: "interrupted",
    finishedAt: interruptedAt,
    attempts,
  })
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

const compareUnitIds = (left: UnitId, right: UnitId) => (left < right ? -1 : left > right ? 1 : 0)

const terminalRunStatuses = new Set(["succeeded", "failed", "canceled", "interrupted"])

const terminalUnitStatuses = new Set(["succeeded", "failed", "skipped", "canceled", "interrupted"])
