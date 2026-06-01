import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { GitHubBinding } from "../domain/github.ts"
import { StoreUnavailable } from "../domain/errors.ts"
import { decodeGitHubBinding, encodeGitHubBinding } from "../runtime/storage-codecs.ts"

export class GitHubBindingStore extends Context.Service<
  GitHubBindingStore,
  {
    readonly create: (binding: GitHubBinding) => Effect.Effect<void, StoreUnavailable>
    readonly list: () => Effect.Effect<ReadonlyArray<GitHubBinding>, StoreUnavailable>
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

    return { create, list, listEnabledForPush }
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
            null,
            null,
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

      return { create, list, listEnabledForPush }
    }),
  )
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
