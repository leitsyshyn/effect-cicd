import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { StoreUnavailable } from "../domain/errors.ts"
import { GitHubRunLink } from "../domain/github.ts"
import { RunId } from "../domain/ids.ts"
import { decodeGitHubRunLink, encodeGitHubRunLink } from "../runtime/storage-codecs.ts"

export class GitHubRunLinkStore extends Context.Service<
  GitHubRunLinkStore,
  {
    readonly create: (link: GitHubRunLink) => Effect.Effect<void, StoreUnavailable>
    readonly get: (runId: RunId) => Effect.Effect<GitHubRunLink | undefined, StoreUnavailable>
    readonly update: (link: GitHubRunLink) => Effect.Effect<void, StoreUnavailable>
  }
>()("@effect-cicd/github/GitHubRunLinkStore") {
  static readonly memoryLayer = Layer.sync(GitHubRunLinkStore, () => {
    const links = new Map<string, GitHubRunLink>()

    const create = (link: GitHubRunLink) =>
      Effect.sync(() => {
        links.set(link.runId, link)
      })

    const get = (runId: RunId) => Effect.sync(() => links.get(runId))

    const update = (link: GitHubRunLink) =>
      Effect.sync(() => {
        links.set(link.runId, link)
      })

    return { create, get, update }
  })

  static readonly postgresLayer = Layer.effect(
    GitHubRunLinkStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const create = Effect.fn("GitHubRunLinkStore.create")(function* (link: GitHubRunLink) {
        const linkJson = JSON.stringify(encodeGitHubRunLink(link))

        yield* catchSql("create GitHub run link", sql`
          INSERT INTO github_run_links (
            run_id,
            binding_id,
            installation_id,
            repository_id,
            repo_owner,
            repo_name,
            workflow_module_path,
            git_ref,
            branch,
            commit_sha,
            delivery_id,
            check_run_id,
            created_at,
            updated_at,
            link_json
          ) VALUES (
            ${link.runId},
            ${link.bindingId},
            ${link.installationId},
            ${link.repositoryId},
            ${link.repositoryOwner},
            ${link.repositoryName},
            ${link.workflowModulePath},
            ${link.ref},
            ${link.branch ?? null},
            ${link.commitSha},
            ${link.deliveryId ?? null},
            ${link.checkRunId ?? null},
            ${link.createdAt},
            ${link.updatedAt},
            ${linkJson}::jsonb
          )
          ON CONFLICT (run_id) DO UPDATE SET
            binding_id = EXCLUDED.binding_id,
            installation_id = EXCLUDED.installation_id,
            repository_id = EXCLUDED.repository_id,
            repo_owner = EXCLUDED.repo_owner,
            repo_name = EXCLUDED.repo_name,
            workflow_module_path = EXCLUDED.workflow_module_path,
            git_ref = EXCLUDED.git_ref,
            branch = EXCLUDED.branch,
            commit_sha = EXCLUDED.commit_sha,
            delivery_id = EXCLUDED.delivery_id,
            check_run_id = EXCLUDED.check_run_id,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            link_json = EXCLUDED.link_json
        `)
      })

      const get = Effect.fn("GitHubRunLinkStore.get")(function* (runId: RunId) {
        const rows = yield* catchSql("read GitHub run link", sql<{ readonly link_json: unknown }>`
          SELECT link_json
          FROM github_run_links
          WHERE run_id = ${runId}
        `)

        const row = rows[0]
        return row === undefined ? undefined : decodeGitHubRunLink(row.link_json)
      })

      const update = Effect.fn("GitHubRunLinkStore.update")(function* (link: GitHubRunLink) {
        yield* create(link)
      })

      return { create, get, update }
    }),
  )
}

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "GitHubRunLinkStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
