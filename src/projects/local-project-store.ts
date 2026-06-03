import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { ProjectId } from "../domain/ids.ts"
import { StoreUnavailable } from "../domain/errors.ts"
import { LocalProject, ProjectSummary, projectIdForRunSummary } from "../domain/project.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { StateStore } from "../engine/stores/state-store.ts"

export class LocalProjectStore extends Context.Service<
  LocalProjectStore,
  {
    readonly create: (project: LocalProject) => Effect.Effect<void, StoreUnavailable>
    readonly get: (projectId: string) => Effect.Effect<LocalProject | undefined, StoreUnavailable>
    readonly list: () => Effect.Effect<ReadonlyArray<LocalProject>, StoreUnavailable>
    readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectSummary>, StoreUnavailable>
    readonly updateProjectName: (projectId: string, name: string | undefined) => Effect.Effect<void, StoreUnavailable>
    readonly deleteProject: (projectId: string) => Effect.Effect<void, StoreUnavailable>
  }
>()("@effect-cicd/projects/LocalProjectStore") {
  static readonly memoryLayer = Layer.effect(
    LocalProjectStore,
    Effect.gen(function* () {
      const stateStore = yield* StateStore
      const projects = new Map<string, LocalProject>()

      const create = Effect.fn("LocalProjectStore.create")((project: LocalProject) =>
        Effect.sync(() => {
          projects.set(project.projectId, project)
        }),
      )

      const get = Effect.fn("LocalProjectStore.get")((projectId: string) => Effect.sync(() => projects.get(projectId)))

      const list = Effect.fn("LocalProjectStore.list")(() =>
        Effect.sync(() => [...projects.values()].sort((left, right) => compareStrings(left.projectId, right.projectId))),
      )

      const listProjects = Effect.fn("LocalProjectStore.listProjects")(function* () {
        const [items, runs] = yield* Effect.all([list(), stateStore.listRuns()])
        const runsByProject = summarizeRuns(runs)

        return items.map((project) => toProjectSummary(project, runsByProject.get(project.projectId)))
      })

      const updateProjectName = Effect.fn("LocalProjectStore.updateProjectName")((projectId: string, name: string | undefined) =>
        Effect.sync(() => {
          const project = projects.get(projectId)
          if (project === undefined) {
            return
          }

          projects.set(
            projectId,
            new LocalProject({
              ...project,
              name,
              updatedAt: new Date(),
            }),
          )
        }),
      )

      const deleteProject = Effect.fn("LocalProjectStore.deleteProject")((projectId: string) =>
        Effect.sync(() => {
          projects.delete(projectId)
        }),
      )

      return { create, get, list, listProjects, updateProjectName, deleteProject }
    }),
  )

  static readonly postgresLayer = Layer.effect(
    LocalProjectStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const stateStore = yield* StateStore

      const create = Effect.fn("LocalProjectStore.create")(function* (project: LocalProject) {
        yield* catchSql(
          "create local project",
          sql`
            INSERT INTO local_projects (
              project_id,
              provider,
              name,
              workflow_module_path,
              workspace_path,
              created_at,
              updated_at
            ) VALUES (
              ${project.projectId},
              ${project.provider},
              ${project.name ?? null},
              ${project.workflowModulePath},
              ${project.workspacePath},
              ${project.createdAt},
              ${project.updatedAt}
            )
          `,
        )
      })

      const get = Effect.fn("LocalProjectStore.get")(function* (projectId: string) {
        const rows = yield* catchSql(
          "get local project",
          sql<{
            readonly project_id: string
            readonly name: string | null
            readonly workflow_module_path: string
            readonly workspace_path: string
            readonly created_at: Date
            readonly updated_at: Date
          }>`
            SELECT project_id, name, workflow_module_path, workspace_path, created_at, updated_at
            FROM local_projects
            WHERE project_id = ${projectId}
          `,
        )

        const row = rows[0]
        if (row === undefined) {
          return undefined
        }

        return new LocalProject({
          projectId: ProjectId.make(row.project_id),
          ...(row.name === null ? {} : { name: row.name }),
          provider: "local",
          workflowModulePath: row.workflow_module_path,
          workspacePath: row.workspace_path,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
      })

      const list = Effect.fn("LocalProjectStore.list")(function* () {
        const rows = yield* catchSql(
          "list local projects",
          sql<{
            readonly project_id: string
            readonly name: string | null
            readonly workflow_module_path: string
            readonly workspace_path: string
            readonly created_at: Date
            readonly updated_at: Date
          }>`
            SELECT project_id, name, workflow_module_path, workspace_path, created_at, updated_at
            FROM local_projects
            ORDER BY project_id ASC
          `,
        )

        return rows.map(
          (row) =>
            new LocalProject({
              projectId: ProjectId.make(row.project_id),
              ...(row.name === null ? {} : { name: row.name }),
              provider: "local",
              workflowModulePath: row.workflow_module_path,
              workspacePath: row.workspace_path,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }),
        )
      })

      const listProjects = Effect.fn("LocalProjectStore.listProjects")(function* () {
        const [items, runs] = yield* Effect.all([list(), stateStore.listRuns()])
        const runsByProject = summarizeRuns(runs)

        return items.map((project) => toProjectSummary(project, runsByProject.get(project.projectId)))
      })

      const updateProjectName = Effect.fn("LocalProjectStore.updateProjectName")(function* (projectId: string, name: string | undefined) {
        yield* catchSql(
          "update local project name",
          sql`
            UPDATE local_projects
            SET name = ${name ?? null}, updated_at = NOW()
            WHERE project_id = ${projectId}
          `,
        )
      })

      const deleteProject = Effect.fn("LocalProjectStore.deleteProject")(function* (projectId: string) {
        yield* catchSql("delete local project", sql`DELETE FROM local_projects WHERE project_id = ${projectId}`)
      })

      return { create, get, list, listProjects, updateProjectName, deleteProject }
    }),
  )
}

interface ProjectRunSummary {
  readonly runCount: number
  readonly latestRunAt: Date | undefined
  readonly latestRunStatus: WorkflowRunState["status"] | undefined
}

const summarizeRuns = (runs: ReadonlyArray<WorkflowRunState>) => {
  const rows = new Map<string, ProjectRunSummary>()

  for (const run of runs) {
    const projectId = projectIdForRunSummary(run)
    const existing = rows.get(projectId)

    if (existing === undefined) {
      rows.set(projectId, { runCount: 1, latestRunAt: run.updatedAt, latestRunStatus: run.status })
      continue
    }

    const isNewer = existing.latestRunAt === undefined || existing.latestRunAt.getTime() < run.updatedAt.getTime()
    rows.set(projectId, {
      runCount: existing.runCount + 1,
      latestRunAt: isNewer ? run.updatedAt : existing.latestRunAt,
      latestRunStatus: isNewer ? run.status : existing.latestRunStatus,
    })
  }

  return rows
}

const toProjectSummary = (project: LocalProject, runSummary: ProjectRunSummary | undefined) =>
  new ProjectSummary({
    projectId: project.projectId,
    ...(project.name === undefined ? {} : { name: project.name }),
    provider: project.provider,
    bindingCount: 0,
    runCount: runSummary?.runCount ?? 0,
    latestRunAt: runSummary?.latestRunAt,
    latestRunStatus: runSummary?.latestRunStatus,
  })

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "LocalProjectStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
