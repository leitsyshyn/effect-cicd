import { Effect, Layer } from "effect"
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
>()("@effect-cicd/engine/stores/StateStore") {
  static readonly memoryLayer = Layer.sync(StateStore, () => {
    const runs = new Map<RunId, WorkflowRunState>()

    const createRun = (state: WorkflowRunState) =>
      Effect.sync(() => {
        runs.set(state.runId, state)
      })

    const updateRun = (state: WorkflowRunState) =>
      Effect.sync(() => runs.has(state.runId)).pipe(
        Effect.flatMap((exists) =>
          exists
            ? Effect.sync(() => {
                runs.set(state.runId, state)
              })
            : Effect.fail(new RunNotFound({ runId: state.runId })),
        ),
      )

    const getRun = (runId: RunId) =>
      Effect.sync(() => runs.get(runId)).pipe(
        Effect.flatMap((state) =>
          state === undefined
            ? Effect.fail(new RunNotFound({ runId }))
            : Effect.succeed(state),
        ),
      )

    const updateUnit = (state: ExecutionUnitState) =>
      Effect.sync(() => runs.get(state.runId)).pipe(
        Effect.flatMap((run) => {
          if (run === undefined) {
            return Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId }))
          }

          const index = run.units.findIndex((unit) => unit.unitId === state.unitId)
          if (index === -1) {
            return Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId }))
          }

          const units = [...run.units]
          units[index] = state

          return Effect.sync(() => {
            runs.set(
              state.runId,
              new WorkflowRunState({
                ...run,
                units,
                updatedAt: run.updatedAt,
              }),
            )
          })
        }),
      )

    const updateAttempt = (state: ExecutionAttemptState) =>
      Effect.sync(() => runs.get(state.runId)).pipe(
        Effect.flatMap((run) => {
          if (run === undefined) {
            return Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId }))
          }

          const unitIndex = run.units.findIndex((unit) => unit.unitId === state.unitId)
          if (unitIndex === -1) {
            return Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId }))
          }

          const currentUnit = run.units[unitIndex]!
          const attempts = [...currentUnit.attempts]
          const attemptIndex = attempts.findIndex((attempt) => attempt.attemptId === state.attemptId)

          if (attemptIndex === -1) {
            attempts.push(state)
          } else {
            attempts[attemptIndex] = state
          }

          const units = [...run.units]
          units[unitIndex] = new ExecutionUnitState({
            ...currentUnit,
            latestAttemptId: state.attemptId,
            attempts,
          })

          return Effect.sync(() => {
            runs.set(
              state.runId,
              new WorkflowRunState({
                ...run,
                units,
                updatedAt: run.updatedAt,
              }),
            )
          })
        }),
      )

    const listIncompleteRuns = () =>
      Effect.sync(() =>
        [...runs.values()].filter((run) => !terminalRunStatuses.has(run.status)),
      )

    const getUnit = (runId: RunId, unitId: UnitId) =>
      Effect.sync(() => runs.get(runId)).pipe(
        Effect.flatMap((run) => {
          if (run === undefined) {
            return Effect.fail(new UnitNotFound({ runId, unitId }))
          }

          const unit = run.units.find((candidate) => candidate.unitId === unitId)
          return unit === undefined
            ? Effect.fail(new UnitNotFound({ runId, unitId }))
            : Effect.succeed(unit)
        }),
      )

    return {
      createRun,
      updateRun,
      getRun,
      updateUnit,
      updateAttempt,
      listIncompleteRuns,
      getUnit,
    }
  })
}

const terminalRunStatuses = new Set(["succeeded", "failed", "canceled", "interrupted"])
