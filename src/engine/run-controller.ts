import { Effect, Fiber, Layer } from "effect"
import * as Context from "effect/Context"

import { RunControlRejected, RunNotFound, StoreUnavailable, WorkflowInputsInvalid } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { Orchestrator, type RunStartOptions } from "./orchestrator.ts"

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
      const activeRuns = new Map<RunId, Fiber.Fiber<WorkflowRunState, RunNotFound | StoreUnavailable>>()

      const ensureRunActive = Effect.fn("RunController.ensureRunActive")(function* (runId: RunId) {
        const existing = activeRuns.get(runId)
        if (existing !== undefined && existing.pollUnsafe() === undefined) {
          return
        }

        const fiber = yield* orchestrator
          .advanceRun(runId)
          .pipe(
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

      const submitRun = Effect.fn("RunController.submitRun")(function* (plan: ExecutionPlan, options?: RunStartOptions) {
        const run = yield* orchestrator.createRun(plan, options)
        yield* ensureRunActive(run.runId)
        return run
      })

      const cancelRun = Effect.fn("RunController.cancelRun")(function* (runId: RunId, reason = "Cancellation requested") {
        yield* orchestrator.cancelRun(runId, reason)
        const active = activeRuns.get(runId)

        if (active === undefined || active.pollUnsafe() !== undefined) {
          return yield* orchestrator.finalizeCancellation(runId, reason)
        }

        yield* Fiber.interrupt(active)
        return yield* orchestrator.inspectRun(runId)
      })

      const retryRun = Effect.fn("RunController.retryRun")(function* (runId: RunId, _reason = "Manual retry requested") {
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
          run.execution.options.workspacePath === undefined
            ? undefined
            : { workspacePath: run.execution.options.workspacePath },
          run.runId,
        )
        yield* ensureRunActive(nextRun.runId)
        return nextRun
      })

      const recoverOnStartup = Effect.fn("RunController.recoverOnStartup")(function* () {
        const recovered = yield* orchestrator.recoverIncompleteRuns()

        for (const run of recovered) {
          if (run.status === "running") {
            yield* ensureRunActive(run.runId)
          }
        }

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
