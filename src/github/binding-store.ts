import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { GitHubBinding } from "../domain/github.ts"
import { StoreUnavailable } from "../domain/errors.ts"
import { ProjectSummary } from "../domain/project.ts"
import { decodeGitHubBinding, encodeGitHubBinding } from "../runtime/storage-codecs.ts"

export class GitHubBindingStore extends Context.Service<
  GitHubBindingStore,
  {
    readonly create: (binding: GitHubBinding) => Effect.Effect<void, StoreUnavailable>
    readonly list: () => Effect.Effect<ReadonlyArray<GitHubBinding>, StoreUnavailable>
    readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectSummary>, StoreUnavailable>
    readonly listEnabledForPush: (
      installationId: number,
      repositoryId: number,
      repositoryOwner: string,
      repositoryName: string,
    ) => Effect.Effect<ReadonlyArray<GitHubBinding>, StoreUnavailable>
  }
>()("@effect-cicd/github/GitHubBindingStore") {
  static readonly memoryLayer = Layer.sync(GitHubBindingStore, () => {
    const bindings = new Map<string, GitHubBinding>()

    const create = (binding: GitHubBinding) =>
      Effect.sync(() => {
        bindings.set(binding.bindingId, binding)
      })

    const list = () => Effect.sync(() => [...bindings.values()].sort(compareBindings))

    const listProjects = () =>
      Effect.sync(() => summarizeProjects([...bindings.values()], []))

    const listEnabledForPush = (installationId: number, repositoryId: number, repositoryOwner: string, repositoryName: string) =>
      Effect.sync(() =>
        [...bindings.values()]
          .filter(
            (binding) =>
              binding.enabled &&
              ((binding.installationId !== undefined &&
                binding.repositoryId !== undefined &&
                binding.installationId === installationId &&
                binding.repositoryId === repositoryId) ||
                (binding.installationId === undefined &&
                  binding.repositoryOwner === repositoryOwner &&
                  binding.repositoryName === repositoryName)),
          )
          .sort(compareBindings),
      )

    return { create, list, listProjects, listEnabledForPush }
  })

  static readonly postgresLayer = Layer.effect(
    GitHubBindingStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const create = Effect.fn("GitHubBindingStore.create")(function* (binding: GitHubBinding) {
        const bindingJson = JSON.stringify(encodeGitHubBinding(binding))

        yield* catchSql("create GitHub binding", sql`
          INSERT INTO github_bindings (
            binding_id,
            project_id,
            provider,
            repo_owner,
            repo_name,
            installation_id,
            repository_id,
            clone_url,
            source_kind,
            branch,
            workflow_module_path,
            workspace_subdir,
            enabled,
            created_at,
            updated_at,
            binding_json
          ) VALUES (
            ${binding.bindingId},
            ${binding.projectId},
            ${binding.provider},
            ${binding.repositoryOwner},
            ${binding.repositoryName},
            ${binding.installationId ?? null},
            ${binding.repositoryId ?? null},
            ${binding.cloneUrl},
            ${binding.sourceKind},
            ${binding.branch ?? null},
            ${binding.workflowModulePath},
            ${binding.workspaceSubdir ?? null},
            ${binding.enabled},
            ${binding.createdAt},
            ${binding.updatedAt},
            ${bindingJson}::jsonb
          )
        `)
      })

      const list = Effect.fn("GitHubBindingStore.list")(function* () {
        const rows = yield* catchSql("list GitHub bindings", sql<{ readonly binding_json: unknown }>`
          SELECT binding_json
          FROM github_bindings
          ORDER BY updated_at DESC, binding_id ASC
        `)

        return rows.map((row) => decodeGitHubBinding(row.binding_json))
      })

      const listProjects = Effect.fn("GitHubBindingStore.listProjects")(function* () {
        const bindings = yield* list()
        const runRows = yield* catchSql(
          "list project run counts",
          sql<{ readonly project_id: string; readonly run_count: number; readonly latest_run_at: Date | null }>`
            SELECT project_id, COUNT(*)::int AS run_count, MAX(updated_at) AS latest_run_at
            FROM workflow_runs
            GROUP BY project_id
          `,
        )

        return summarizeProjects(bindings, runRows)
      })

      const listEnabledForPush = Effect.fn("GitHubBindingStore.listEnabledForPush")(
        function* (installationId: number, repositoryId: number, repositoryOwner: string, repositoryName: string) {
          const rows = yield* catchSql("list matching GitHub bindings", sql<{ readonly binding_json: unknown }>`
            SELECT binding_json
            FROM github_bindings
            WHERE enabled = true
              AND (
                (installation_id = ${installationId} AND repository_id = ${repositoryId})
                OR (
                  installation_id IS NULL
                  AND repo_owner = ${repositoryOwner}
                  AND repo_name = ${repositoryName}
                )
              )
            ORDER BY updated_at DESC, binding_id ASC
          `)

          return rows.map((row) => decodeGitHubBinding(row.binding_json))
        },
      )

      return { create, list, listProjects, listEnabledForPush }
    }),
  )
}

const summarizeProjects = (
  bindings: ReadonlyArray<GitHubBinding>,
  runRows: ReadonlyArray<{ readonly project_id: string; readonly run_count: number; readonly latest_run_at: Date | null }>,
) => {
  const runsByProject = new Map(runRows.map((row) => [row.project_id, row]))
  const grouped = new Map<string, Array<GitHubBinding>>()

  for (const binding of bindings) {
    const items = grouped.get(binding.projectId) ?? []
    items.push(binding)
    grouped.set(binding.projectId, items)
  }

  return [...grouped.entries()]
    .sort((left, right) => compareStrings(left[0], right[0]))
    .map(([projectId, projectBindings]) => {
      const first = projectBindings[0]!
      const runRow = runsByProject.get(projectId)

      return new ProjectSummary({
        projectId: first.projectId,
        provider: first.provider,
        repositoryOwner: first.repositoryOwner,
        repositoryName: first.repositoryName,
        repositoryId: first.repositoryId,
        bindingCount: projectBindings.length,
        runCount: runRow?.run_count ?? 0,
        latestRunAt: runRow?.latest_run_at ?? undefined,
      })
    })
}

const compareBindings = (left: GitHubBinding, right: GitHubBinding) => {
  const timeDelta = right.updatedAt.getTime() - left.updatedAt.getTime()
  return timeDelta === 0 ? compareStrings(left.bindingId, right.bindingId) : timeDelta
}

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "GitHubBindingStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
