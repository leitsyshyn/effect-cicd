import { Effect, Fiber, Layer } from "effect"
import * as Context from "effect/Context"

import { RunControlRejected, RunNotFound, StoreUnavailable, WorkflowInputsInvalid } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { SchedulerConfig } from "../runtime/config.ts"
import { Orchestrator, type RunStartOptions } from "./orchestrator.ts"
import { StateStore } from "./stores/state-store.ts"

export class RunController extends Context.Service<
  RunController,
  {
    readonly submitRun: (
      plan: ExecutionPlan,
      options?: RunStartOptions,
    ) => Effect.Effect<WorkflowRunState, StoreUnavailable | WorkflowInputsInvalid>
    readonly cancelRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly retryRun: (
      runId: RunId,
      reason?: string,
    ) => Effect.Effect<WorkflowRunState, RunNotFound | RunControlRejected | StoreUnavailable | WorkflowInputsInvalid>
    readonly recoverOnStartup: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
  }
>()("@effect-cicd/engine/RunController") {
  static readonly layer = Layer.effect(
    RunController,
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const stateStore = yield* StateStore
      const schedulerConfig = yield* SchedulerConfig
      const activeRuns = new Map<RunId, Fiber.Fiber<WorkflowRunState, RunNotFound | StoreUnavailable>>()
      let scheduling = false
      let scheduleRequested = false

      const ensureRunActive: (runId: RunId) => Effect.Effect<void, StoreUnavailable, never> = Effect.fn(
        "RunController.ensureRunActive",
      )(function* (runId: RunId) {
        const existing = activeRuns.get(runId)
        if (existing !== undefined && existing.pollUnsafe() === undefined) {
          return
        }

        const fiber = yield* orchestrator
          .advanceRun(runId)
          .pipe(
            Effect.ensuring(scheduleQueuedRuns().pipe(Effect.catch(() => Effect.succeed<void>(undefined)))),
            Effect.catchTag(
              "RunNotFound",
              () =>
                Effect.fail(
                  new StoreUnavailable({
                    store: "RunController",
                    message: `Run ${runId} disappeared before background execution could start`,
                  }),
                ),
            ),
            Effect.forkDetach({ startImmediately: true }),
          )
        activeRuns.set(runId, fiber)
        fiber.addObserver(() => {
          activeRuns.delete(runId)
        })
      })

      const scheduleQueuedRuns: () => Effect.Effect<void, StoreUnavailable, never> = Effect.fn("RunController.scheduleQueuedRuns")(() =>
        Effect.gen(function* () {
          if (scheduling) {
            scheduleRequested = true
            return
          }

          scheduling = true

          try {
            do {
              scheduleRequested = false
              yield* scheduleOnce()
            } while (scheduleRequested)
          } finally {
            scheduling = false
          }
        }),
      )

      const scheduleOnce: () => Effect.Effect<void, StoreUnavailable, never> = Effect.fn("RunController.scheduleOnce")(() =>
        Effect.gen(function* () {
          const [queuedRuns, activeRunsSnapshot] = yield* Effect.all([stateStore.listQueuedRuns(), stateStore.listActiveRuns()])

          let availableGlobalSlots = Math.max(schedulerConfig.maxConcurrentRuns - activeRunsSnapshot.length, 0)
          if (availableGlobalSlots === 0) {
            return
          }

          const runningByProject = new Map<string, number>()
          for (const run of activeRunsSnapshot) {
            runningByProject.set(run.projectId, (runningByProject.get(run.projectId) ?? 0) + 1)
          }

          for (const run of queuedRuns) {
            if (availableGlobalSlots === 0) {
              return
            }

            const activeForProject = runningByProject.get(run.projectId) ?? 0
            if (activeForProject >= schedulerConfig.maxConcurrentRunsPerProject) {
              continue
            }

            yield* ensureRunActive(run.runId)
            runningByProject.set(run.projectId, activeForProject + 1)
            availableGlobalSlots -= 1
          }
        }),
      )

      const submitRun: (
        plan: ExecutionPlan,
        options?: RunStartOptions,
      ) => Effect.Effect<WorkflowRunState, StoreUnavailable | WorkflowInputsInvalid, never> = Effect.fn(
        "RunController.submitRun",
      )(function* (plan: ExecutionPlan, options?: RunStartOptions) {
        const run = yield* orchestrator.createRun(plan, options)
        yield* scheduleQueuedRuns()
        return run
      })

      const cancelRun: (runId: RunId, reason?: string) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable, never> =
        Effect.fn("RunController.cancelRun")(function* (runId: RunId, reason = "Cancellation requested") {
        yield* orchestrator.cancelRun(runId, reason)
        const active = activeRuns.get(runId)

        if (active === undefined || active.pollUnsafe() !== undefined) {
          return yield* orchestrator.finalizeCancellation(runId, reason)
        }

        yield* Fiber.interrupt(active)
        return yield* orchestrator.inspectRun(runId)
        })

      const retryRun: (
        runId: RunId,
        reason?: string,
      ) => Effect.Effect<WorkflowRunState, RunNotFound | RunControlRejected | StoreUnavailable | WorkflowInputsInvalid, never> =
        Effect.fn("RunController.retryRun")(function* (runId: RunId, _reason = "Manual retry requested") {
        const run = yield* orchestrator.inspectRun(runId)

        if (run.status === "running" || run.status === "canceling") {
          return yield* new RunControlRejected({
            runId,
            operation: "retry",
            message: `Run ${runId} is still active and cannot be retried`,
          })
        }

        const nextRun = yield* orchestrator.createRun(
          run.execution.plan,
          run.execution.options.workspacePath === undefined && run.execution.options.inputValues === undefined
            ? undefined
            : {
                ...(run.execution.options.workspacePath !== undefined ? { workspacePath: run.execution.options.workspacePath } : {}),
                ...(run.execution.options.inputValues !== undefined ? { inputValues: run.execution.options.inputValues } : {}),
              },
          run.runId,
        )
        yield* scheduleQueuedRuns()
        return nextRun
        })

      const recoverOnStartup: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable, never> = Effect.fn(
        "RunController.recoverOnStartup",
      )(function* () {
        const recovered = yield* orchestrator.recoverIncompleteRuns()

        for (const run of recovered) {
          if (run.status === "running") {
            yield* ensureRunActive(run.runId)
          }
        }

        yield* scheduleQueuedRuns()

        return recovered
      })

      return {
        submitRun,
        cancelRun,
        retryRun,
        recoverOnStartup,
      }
    }),
  )
}
