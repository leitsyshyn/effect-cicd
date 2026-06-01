import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"

import { StoreUnavailable } from "../domain/errors.ts"
import { GitHubTriggerDelivery } from "../domain/github.ts"
import { decodeGitHubTriggerDelivery, encodeGitHubTriggerDelivery } from "../runtime/storage-codecs.ts"

export class GitHubTriggerDeliveryStore extends Context.Service<
  GitHubTriggerDeliveryStore,
  {
    readonly create: (delivery: GitHubTriggerDelivery) => Effect.Effect<void, StoreUnavailable>
    readonly get: (idempotencyKey: string) => Effect.Effect<GitHubTriggerDelivery | undefined, StoreUnavailable>
  }
>()("@effect-cicd/github/GitHubTriggerDeliveryStore") {
  static readonly memoryLayer = Layer.sync(GitHubTriggerDeliveryStore, () => {
    const deliveries = new Map<string, GitHubTriggerDelivery>()

    const create = (delivery: GitHubTriggerDelivery) =>
      Effect.sync(() => {
        deliveries.set(delivery.idempotencyKey, delivery)
      })

    const get = (idempotencyKey: string) => Effect.sync(() => deliveries.get(idempotencyKey))

    return { create, get }
  })

  static readonly postgresLayer = Layer.effect(
    GitHubTriggerDeliveryStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const create = Effect.fn("GitHubTriggerDeliveryStore.create")(function* (delivery: GitHubTriggerDelivery) {
        const deliveryJson = JSON.stringify(encodeGitHubTriggerDelivery(delivery))

        yield* catchSql("create GitHub trigger delivery", sql`
          INSERT INTO github_trigger_deliveries (
            idempotency_key,
            binding_id,
            project_id,
            provider,
            event,
            repository_id,
            repo_owner,
            repo_name,
            git_ref,
            commit_sha,
            delivery_id,
            run_id,
            created_at,
            updated_at,
            delivery_json
          ) VALUES (
            ${delivery.idempotencyKey},
            ${delivery.bindingId},
            ${delivery.projectId},
            ${delivery.provider},
            ${delivery.event},
            ${delivery.repositoryId},
            ${delivery.repositoryOwner},
            ${delivery.repositoryName},
            ${delivery.ref},
            ${delivery.commitSha},
            ${delivery.deliveryId ?? null},
            ${delivery.runId},
            ${delivery.createdAt},
            ${delivery.updatedAt},
            ${deliveryJson}::jsonb
          )
          ON CONFLICT (idempotency_key) DO NOTHING
        `)
      })

      const get = Effect.fn("GitHubTriggerDeliveryStore.get")(function* (idempotencyKey: string) {
        const rows = yield* catchSql("read GitHub trigger delivery", sql<{ readonly delivery_json: unknown }>`
          SELECT delivery_json
          FROM github_trigger_deliveries
          WHERE idempotency_key = ${idempotencyKey}
        `)

        const row = rows[0]
        return row === undefined ? undefined : decodeGitHubTriggerDelivery(row.delivery_json)
      })

      return { create, get }
    }),
  )
}

const catchSql = <A>(operation: string, effect: Effect.Effect<A, unknown, never>) =>
  effect.pipe(
    Effect.catch((error: unknown) =>
      isSqlError(error)
        ? Effect.fail(
            new StoreUnavailable({
              store: "GitHubTriggerDeliveryStore",
              message: `Failed to ${operation}: ${error.message}`,
            }),
          )
        : Effect.fail(error),
    ),
  ) as Effect.Effect<A, StoreUnavailable, never>
