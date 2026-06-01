import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { generateKeyPairSync } from "node:crypto"

import { GitHubAppAuth } from "../src/github/app-auth.ts"
import { GitHubAppConfig } from "../src/runtime/config.ts"

describe("GitHub App auth", () => {
  it.effect("signs an app JWT with the configured app id", () =>
    Effect.gen(function* () {
      const auth = yield* GitHubAppAuth
      const jwt = yield* auth.createAppJwt()
      const [header, payload] = jwt.split(".")

      expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf-8"))).toMatchObject({ alg: "RS256", typ: "JWT" })
      expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf-8"))).toMatchObject({ iss: "123" })
    }).pipe(Effect.provide(authLayer())),
  )

  it.effect("exchanges and caches an installation token", () =>
    Effect.gen(function* () {
      const calls = new Array<string>()

      yield* withMockedFetch(
        ((input) => {
          calls.push(String(input))
          return Promise.resolve(
            Response.json({
              token: "installation-token",
              expires_at: "2099-01-01T00:00:00Z",
            }),
          )
        }) as typeof fetch,
        Effect.gen(function* () {
          const auth = yield* GitHubAppAuth
          const first = yield* auth.getInstallationToken(1001)
          const second = yield* auth.getInstallationToken(1001)

          expect(first.token).toBe("installation-token")
          expect(second.token).toBe("installation-token")
          expect(calls).toHaveLength(1)
        }).pipe(Effect.provide(authLayer())),
      )
    }),
  )
})

const authLayer = () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()

  return GitHubAppAuth.layer.pipe(
    Layer.provide(
      Layer.succeed(GitHubAppConfig, {
        appId: "123",
        privateKey: Redacted.make(privateKeyPem),
        webhookSecret: Redacted.make("top-secret"),
        clientId: undefined,
        clientSecret: undefined,
        publicBaseUrl: undefined,
        apiBaseUrl: "https://api.github.test",
      }),
    ),
  )
}

const withMockedFetch = <A, E, R>(
  mock: typeof fetch,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = globalThis.fetch
      globalThis.fetch = mock
      return original
    }),
    () => effect,
    (original) =>
      Effect.sync(() => {
        globalThis.fetch = original
      }),
  )
