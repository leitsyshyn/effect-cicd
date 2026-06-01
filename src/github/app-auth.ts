import { createSign } from "node:crypto"

import { Effect, Layer, Redacted } from "effect"
import * as Context from "effect/Context"

import { GitHubAuthFailed, GitHubConfigMissing } from "../domain/errors.ts"
import { GitHubAppConfig } from "../runtime/config.ts"

export interface GitHubInstallationAccessToken {
  readonly token: string
  readonly expiresAt: Date
}

export class GitHubAppAuth extends Context.Service<
  GitHubAppAuth,
  {
    readonly createAppJwt: () => Effect.Effect<string, GitHubConfigMissing | GitHubAuthFailed>
    readonly getInstallationToken: (
      installationId: number,
    ) => Effect.Effect<GitHubInstallationAccessToken, GitHubConfigMissing | GitHubAuthFailed>
  }
>()("@effect-cicd/github/GitHubAppAuth") {
  static readonly layer = Layer.effect(
    GitHubAppAuth,
    Effect.gen(function* () {
      const config = yield* GitHubAppConfig
      const tokenCache = new Map<number, GitHubInstallationAccessToken>()

      const createAppJwt = Effect.fn("GitHubAppAuth.createAppJwt")(function* () {
        const appId = yield* requireConfig(config.appId, "GITHUB_APP_ID")
        const privateKey = normalizePrivateKey(yield* requireRedactedConfig(config.privateKey, "GITHUB_APP_PRIVATE_KEY"))

        return yield* Effect.try({
          try: () => signAppJwt(appId, privateKey),
          catch: (error) =>
            new GitHubAuthFailed({
              operation: "create-app-jwt",
              message: error instanceof Error ? error.message : String(error),
            }),
        })
      })

      const getInstallationToken = Effect.fn("GitHubAppAuth.getInstallationToken")(function* (installationId: number) {
        const cached = tokenCache.get(installationId)
        if (cached !== undefined && cached.expiresAt.getTime() - Date.now() > 60_000) {
          return cached
        }

        const jwt = yield* createAppJwt()
        const url = buildApiUrl(config.apiBaseUrl, `/app/installations/${installationId}/access_tokens`)

        const payload = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(url, {
              method: "POST",
              headers: gitHubHeaders(jwt),
            })

            if (!response.ok) {
              throw new Error(await toResponseError(response))
            }

            return (await response.json()) as { readonly token: string; readonly expires_at: string }
          },
          catch: (error) =>
            new GitHubAuthFailed({
              operation: "create-installation-token",
              installationId,
              message: error instanceof Error ? error.message : String(error),
            }),
        })

        const token = {
          token: payload.token,
          expiresAt: new Date(payload.expires_at),
        } satisfies GitHubInstallationAccessToken

        tokenCache.set(installationId, token)
        return token
      })

      return { createAppJwt, getInstallationToken }
    }),
  )
}

const requireConfig = <A>(value: A | undefined, setting: string) =>
  value === undefined
    ? Effect.fail(
        new GitHubConfigMissing({
          setting,
          message: `${setting} must be configured for GitHub App integration`,
        }),
      )
    : Effect.succeed(value)

const requireRedactedConfig = (value: Redacted.Redacted | undefined, setting: string) =>
  value === undefined ? requireConfig(undefined, setting) : Effect.succeed(Redacted.value(value))

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, "\n")

const signAppJwt = (appId: string, privateKey: string) => {
  const issuedAt = Math.floor(Date.now() / 1000) - 60
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" })
  const payload = base64UrlJson({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: appId })
  const unsigned = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsigned)
  signer.end()
  const signature = signer.sign(privateKey).toString("base64url")

  return `${unsigned}.${signature}`
}

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

const buildApiUrl = (baseUrl: string, path: string) => new URL(path, ensureTrailingSlash(baseUrl)).toString()

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)

const gitHubHeaders = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "effect-cicd",
  "x-github-api-version": "2022-11-28",
})

const toResponseError = async (response: Response) => {
  const body = await response.text()
  return body.trim().length === 0 ? `GitHub auth request failed with HTTP ${response.status}` : body
}
