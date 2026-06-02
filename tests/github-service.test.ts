import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { GitHubTriggerResponse } from "../src/domain/github.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { EngineServiceConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"
import { SecretStore } from "../src/secrets/store.ts"
import { startServiceServer } from "../src/service/server.ts"

describe("GitHub service routes", () => {
  it.live("acknowledges signed webhooks quickly through acceptWebhook", () =>
    Effect.gen(function* () {
      const port = 40100 + Math.floor(Math.random() * 500)
      const baseUrl = `http://127.0.0.1:${port}`
      let acceptedBody: string | undefined

      const server = yield* startServiceServer.pipe(
        Effect.provide(
          Layer.mergeAll(
            makeInMemoryServiceEngineLayer(),
            Layer.succeed(EngineServiceConfig, { baseUrl, port }),
            Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
            Layer.succeed(GitHubIntegration, {
              addBinding: () => Effect.die("unused"),
              listBindings: () => Effect.succeed([]),
              listProjects: () => Effect.succeed([]),
              acceptWebhook: (request) =>
                Effect.sync(() => {
                  acceptedBody = request.rawBody
                  return new GitHubTriggerResponse({
                    event: request.event ?? "unknown",
                    matchedBindings: 0,
                    triggeredRuns: [],
                    ignoredReason: "Webhook accepted for asynchronous processing",
                  })
                }),
              handleWebhook: () => Effect.die("unused"),
              triggerPush: () => Effect.die("unused"),
            }),
            SecretStore.memoryLayer,
          ),
        ),
      )

      const triggerPayload = JSON.stringify({ ref: "refs/heads/main", after: "abc123" })
      const triggerResponse = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/github/webhooks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-github-delivery": "delivery-1",
            "x-hub-signature-256": "sha256=test",
          },
          body: triggerPayload,
        }),
      )
      const trigger = yield* Effect.promise(() => triggerResponse.json() as Promise<{ readonly ignoredReason?: string }>)

      expect(triggerResponse.status).toBe(202)
      expect(trigger.ignoredReason).toBe("Webhook accepted for asynchronous processing")
      expect(acceptedBody).toBe(triggerPayload)

      yield* Effect.promise(() => Promise.resolve(server.stop(true)).then(() => undefined))
    }),
  )
})
