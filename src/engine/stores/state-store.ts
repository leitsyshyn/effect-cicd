import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { RunNotFound, StoreUnavailable, UnitNotFound } from "../../domain/errors.ts"
import { RunId, UnitId } from "../../domain/ids.ts"
import { ExecutionAttemptState, ExecutionUnitState, WorkflowRunState } from "../../domain/runtime-state.ts"
import { decodeWorkflowRunState, encodeWorkflowRunState } from "../../runtime/storage-codecs.ts"

export class StateStore extends Context.Service<
  StateStore,
  {
    readonly createRun: (state: WorkflowRunState) => Effect.Effect<void, StoreUnavailable>
    readonly updateRun: (state: WorkflowRunState) => Effect.Effect<void, RunNotFound | StoreUnavailable>
    readonly renameProject: (projectId: string, nextProjectId: string) => Effect.Effect<void, StoreUnavailable>
    readonly deleteProject: (projectId: string) => Effect.Effect<void, StoreUnavailable>
    readonly getRun: (runId: RunId) => Effect.Effect<WorkflowRunState, RunNotFound | StoreUnavailable>
    readonly updateUnit: (state: ExecutionUnitState) => Effect.Effect<void, UnitNotFound | StoreUnavailable>
    readonly updateAttempt: (state: ExecutionAttemptState) => Effect.Effect<void, UnitNotFound | StoreUnavailable>
    readonly listRuns: (projectId?: string) => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
    readonly listQueuedRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
    readonly listActiveRuns: () => Effect.Effect<ReadonlyArray<WorkflowRunState>, StoreUnavailable>
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

    const renameProject = Effect.fn("StateStore.renameProject")(function* (projectId: string, nextProjectId: string) {
      yield* Effect.sync(() => {
        for (const [runId, run] of runs.entries()) {
          if (run.projectId !== projectId) {
            continue
          }

          runs.set(runId, renameRunStateProjectId(run, projectId, nextProjectId))
        }
      })
    })

    const deleteProject = Effect.fn("StateStore.deleteProject")((projectId: string) =>
      Effect.sync(() => {
        for (const [runId, run] of runs.entries()) {
          if (run.projectId === projectId) {
            runs.delete(runId)
          }
        }
      }),
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

    const listQueuedRuns = () =>
      Effect.sync(() =>
        [...runs.values()].filter((run) => run.status === "queued").sort(compareQueuedRuns),
      )

    const listActiveRuns = () =>
      Effect.sync(() =>
        [...runs.values()].filter((run) => activeRunStatuses.has(run.status)).sort(compareRuns),
      )

    const listIncompleteRuns = () =>
      Effect.sync(() =>
        [...runs.values()].filter((run) => !terminalRunStatuses.has(run.status)),
      )

    const listRuns = (projectId?: string) =>
      Effect.sync(() =>
        [...runs.values()]
          .filter((run) => projectId === undefined || run.projectId === projectId)
          .sort((left, right) => compareRuns(right, left)),
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
      renameProject,
      deleteProject,
      getRun,
      updateUnit,
      updateAttempt,
      listRuns,
      listQueuedRuns,
      listActiveRuns,
      listIncompleteRuns,
      getUnit,
    }
  })

  static readonly postgresLayer = Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const upsertableFields = (state: WorkflowRunState) => ({
        projectId: state.projectId,
        workflowId: state.workflowId,
        planId: state.planId,
        status: state.status,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        startedAt: state.startedAt ?? null,
        finishedAt: state.finishedAt ?? null,
        stateJson: JSON.stringify(encodeWorkflowRunState(state)),
      })

      const createRun = Effect.fn("StateStore.createRun")(function* (state: WorkflowRunState) {
        const fields = upsertableFields(state)

        yield* catchSql("create workflow run", sql`
          INSERT INTO workflow_runs (
            run_id,
            project_id,
            workflow_id,
            plan_id,
            status,
            created_at,
            updated_at,
            started_at,
            finished_at,
            state_json
          ) VALUES (
            ${state.runId},
            ${fields.projectId},
            ${fields.workflowId},
            ${fields.planId},
            ${fields.status},
            ${fields.createdAt},
            ${fields.updatedAt},
            ${fields.startedAt},
            ${fields.finishedAt},
            ${fields.stateJson}::jsonb
          )
        `)
      })

      const updateRun = Effect.fn("StateStore.updateRun")(function* (state: WorkflowRunState) {
        const fields = upsertableFields(state)
        const rows = yield* catchSql("update workflow run", sql<{ readonly run_id: string }>`
          UPDATE workflow_runs
          SET project_id = ${fields.projectId},
              workflow_id = ${fields.workflowId},
              plan_id = ${fields.planId},
              status = ${fields.status},
              created_at = ${fields.createdAt},
              updated_at = ${fields.updatedAt},
              started_at = ${fields.startedAt},
              finished_at = ${fields.finishedAt},
              state_json = ${fields.stateJson}::jsonb
          WHERE run_id = ${state.runId}
          RETURNING run_id
        `)

        if (rows.length === 0) {
          return yield* new RunNotFound({ runId: state.runId })
        }
      })

      const getRun = Effect.fn("StateStore.getRun")(function* (runId: RunId) {
        const rows = yield* catchSql("read workflow run", sql<{ readonly state_json: unknown }>`
          SELECT state_json
          FROM workflow_runs
          WHERE run_id = ${runId}
        `)

        const row = rows[0]
        if (row === undefined) {
          return yield* new RunNotFound({ runId })
        }

        return decodeWorkflowRunState(row.state_json)
      })

      const renameProject = Effect.fn("StateStore.renameProject")(function* (projectId: string, nextProjectId: string) {
        const runs = yield* listRuns(projectId)

        for (const run of runs) {
          yield* updateRun(renameRunStateProjectId(run, projectId, nextProjectId)).pipe(
            Effect.catchTags({
              RunNotFound: () => Effect.succeed(undefined),
            }),
          )
        }
      })

      const deleteProject = Effect.fn("StateStore.deleteProject")(function* (projectId: string) {
        yield* catchSql("delete workflow runs for project", sql`DELETE FROM workflow_runs WHERE project_id = ${projectId}`)
      })

      const listRuns = Effect.fn("StateStore.listRuns")(function* (projectId?: string) {
        const rows = yield* catchSql(
          "list workflow runs",
          projectId === undefined
            ? sql<{ readonly state_json: unknown }>`
                SELECT state_json
                FROM workflow_runs
                ORDER BY updated_at DESC, run_id ASC
              `
            : sql<{ readonly state_json: unknown }>`
                SELECT state_json
                FROM workflow_runs
                WHERE project_id = ${projectId}
                ORDER BY updated_at DESC, run_id ASC
              `,
        )

        return rows.map((row: { readonly state_json: unknown }) => decodeWorkflowRunState(row.state_json))
      })

      const listQueuedRuns = Effect.fn("StateStore.listQueuedRuns")(function* () {
        const rows = yield* catchSql("list queued workflow runs", sql<{ readonly state_json: unknown }>`
          SELECT state_json
          FROM workflow_runs
          WHERE status = 'queued'
          ORDER BY created_at ASC, run_id ASC
        `)

        return rows.map((row: { readonly state_json: unknown }) => decodeWorkflowRunState(row.state_json))
      })

      const listActiveRuns = Effect.fn("StateStore.listActiveRuns")(function* () {
        const rows = yield* catchSql("list active workflow runs", sql<{ readonly state_json: unknown }>`
          SELECT state_json
          FROM workflow_runs
          WHERE status IN ('running', 'canceling')
          ORDER BY created_at ASC, run_id ASC
        `)

        return rows.map((row: { readonly state_json: unknown }) => decodeWorkflowRunState(row.state_json))
      })

      const listIncompleteRuns = Effect.fn("StateStore.listIncompleteRuns")(function* () {
        const rows = yield* catchSql("list incomplete workflow runs", sql<{ readonly state_json: unknown }>`
          SELECT state_json
          FROM workflow_runs
          WHERE status NOT IN ('succeeded', 'failed', 'timed_out', 'canceled', 'interrupted')
          ORDER BY updated_at DESC, run_id ASC
        `)

        return rows.map((row: { readonly state_json: unknown }) => decodeWorkflowRunState(row.state_json))
      })

      const updateUnit = Effect.fn("StateStore.updateUnit")(function* (state: ExecutionUnitState) {
        const run = yield* getRun(state.runId).pipe(
          Effect.catchTags({
            RunNotFound: () => Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId })),
          }),
        )

        const index = run.units.findIndex((unit) => unit.unitId === state.unitId)
        if (index === -1) {
          return yield* new UnitNotFound({ runId: state.runId, unitId: state.unitId })
        }

        const units = [...run.units]
        units[index] = state

        yield* updateRun(
          new WorkflowRunState({
            ...run,
            units,
          }),
        ).pipe(
          Effect.catchTags({
            RunNotFound: () => Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId })),
          }),
        )
      })

      const updateAttempt = Effect.fn("StateStore.updateAttempt")(function* (state: ExecutionAttemptState) {
        const run = yield* getRun(state.runId).pipe(
          Effect.catchTags({
            RunNotFound: () => Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId })),
          }),
        )

        const unitIndex = run.units.findIndex((unit) => unit.unitId === state.unitId)
        if (unitIndex === -1) {
          return yield* new UnitNotFound({ runId: state.runId, unitId: state.unitId })
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

        yield* updateRun(
          new WorkflowRunState({
            ...run,
            units,
          }),
        ).pipe(
          Effect.catchTags({
            RunNotFound: () => Effect.fail(new UnitNotFound({ runId: state.runId, unitId: state.unitId })),
          }),
        )
      })

      const getUnit = Effect.fn("StateStore.getUnit")(function* (runId: RunId, unitId: UnitId) {
        const run = yield* getRun(runId).pipe(
          Effect.catchTags({
            RunNotFound: () => Effect.fail(new UnitNotFound({ runId, unitId })),
          }),
        )
        const unit = run.units.find((candidate) => candidate.unitId === unitId)

        if (unit === undefined) {
          return yield* new UnitNotFound({ runId, unitId })
        }

        return unit
      })

      return {
        createRun,
        updateRun,
        renameProject,
        deleteProject,
        getRun,
        updateUnit,
        updateAttempt,
        listRuns,
        listQueuedRuns,
        listActiveRuns,
        listIncompleteRuns,
        getUnit,
      }
    }),
  )
}

const terminalRunStatuses = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"])

const activeRunStatuses = new Set(["running", "canceling"])

const compareRuns = (left: WorkflowRunState, right: WorkflowRunState) => {
  const timeDelta = left.updatedAt.getTime() - right.updatedAt.getTime()
  return timeDelta === 0 ? compareStrings(left.runId, right.runId) : timeDelta
}

const compareQueuedRuns = (left: WorkflowRunState, right: WorkflowRunState) => {
  const timeDelta = left.createdAt.getTime() - right.createdAt.getTime()
  return timeDelta === 0 ? compareStrings(left.runId, right.runId) : timeDelta
}

const renameRunStateProjectId = (run: WorkflowRunState, projectId: string, nextProjectId: string) =>
  new WorkflowRunState({
    ...run,
    projectId: nextProjectId as WorkflowRunState["projectId"],
    execution: {
      ...run.execution,
      plan: {
        ...run.execution.plan,
        metadata: renamePlanMetadataProjectId(run.execution.plan.metadata, projectId, nextProjectId),
      },
    },
  })

const renamePlanMetadataProjectId = (
  metadata: Record<string, unknown>,
  projectId: string,
  nextProjectId: string,
): Record<string, unknown> => {
  const nextMetadata: Record<string, unknown> = { ...metadata }

  if (nextMetadata.projectId === projectId) {
    nextMetadata.projectId = nextProjectId
  }

  const project = asRecord(nextMetadata.project)
  if (project?.projectId === projectId) {
    nextMetadata.project = { ...project, projectId: nextProjectId }
  }

  const trigger = asRecord(nextMetadata.trigger)
  if (trigger?.projectId === projectId) {
    nextMetadata.trigger = { ...trigger, projectId: nextProjectId }
  }

  return nextMetadata
}

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "StateStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
