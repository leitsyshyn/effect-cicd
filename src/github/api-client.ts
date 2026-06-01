import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { GitHubApiFailed } from "../domain/errors.ts"
import { GitHubAppConfig } from "../runtime/config.ts"
import { GitHubAppAuth } from "./app-auth.ts"

export interface GitHubRepositoryRecord {
  readonly id: number
  readonly owner: string
  readonly name: string
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string | undefined
}

export interface GitHubCheckRunUpsert {
  readonly installationId: number
  readonly repositoryOwner: string
  readonly repositoryName: string
  readonly checkRunId?: number
  readonly name: string
  readonly headSha: string
  readonly externalId: string
  readonly detailsUrl?: string
  readonly status: "queued" | "in_progress" | "completed"
  readonly conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required"
  readonly summary: string
  readonly title: string
}

export class GitHubApiClient extends Context.Service<
  GitHubApiClient,
  {
    readonly getRepository: (
      installationId: number,
      repositoryOwner: string,
      repositoryName: string,
    ) => Effect.Effect<GitHubRepositoryRecord, GitHubApiFailed>
    readonly downloadRepositoryArchive: (
      installationId: number,
      repositoryOwner: string,
      repositoryName: string,
      commitSha: string,
    ) => Effect.Effect<Uint8Array, GitHubApiFailed>
    readonly upsertCheckRun: (request: GitHubCheckRunUpsert) => Effect.Effect<number, GitHubApiFailed>
  }
>()("@effect-cicd/github/GitHubApiClient") {
  static readonly layer = Layer.effect(
    GitHubApiClient,
    Effect.gen(function* () {
      const config = yield* GitHubAppConfig
      const auth = yield* GitHubAppAuth

      const getRepository = Effect.fn("GitHubApiClient.getRepository")(
        function* (installationId: number, repositoryOwner: string, repositoryName: string) {
          const response = yield* requestJson(
            auth,
            config.apiBaseUrl,
            installationId,
            "get-repository",
            `/repos/${encode(repositoryOwner)}/${encode(repositoryName)}`,
          )

          return {
            id: asInt(response.id, "repository.id"),
            owner: asString(response.owner?.login, "repository.owner.login"),
            name: asString(response.name, "repository.name"),
            fullName: asString(response.full_name, "repository.full_name"),
            cloneUrl: asString(response.clone_url, "repository.clone_url"),
            defaultBranch: asOptionalString(response.default_branch),
          } satisfies GitHubRepositoryRecord
        },
      )

      const downloadRepositoryArchive = Effect.fn("GitHubApiClient.downloadRepositoryArchive")(
        function* (installationId: number, repositoryOwner: string, repositoryName: string, commitSha: string) {
          return yield* requestBytes(
            auth,
            config.apiBaseUrl,
            installationId,
            "download-repository-archive",
            `/repos/${encode(repositoryOwner)}/${encode(repositoryName)}/tarball/${encode(commitSha)}`,
          )
        },
      )

      const upsertCheckRun = Effect.fn("GitHubApiClient.upsertCheckRun")(function* (request: GitHubCheckRunUpsert) {
        const payload = {
          name: request.name,
          head_sha: request.headSha,
          external_id: request.externalId,
          status: request.status,
          ...(request.detailsUrl === undefined ? {} : { details_url: request.detailsUrl }),
          ...(request.conclusion === undefined ? {} : { conclusion: request.conclusion }),
          output: {
            title: request.title,
            summary: request.summary,
          },
        }

        const response = yield* requestJson(
          auth,
          config.apiBaseUrl,
          request.installationId,
          request.checkRunId === undefined ? "create-check-run" : "update-check-run",
          request.checkRunId === undefined
            ? `/repos/${encode(request.repositoryOwner)}/${encode(request.repositoryName)}/check-runs`
            : `/repos/${encode(request.repositoryOwner)}/${encode(request.repositoryName)}/check-runs/${request.checkRunId}`,
          request.checkRunId === undefined ? "POST" : "PATCH",
          payload,
        )

        return asInt(response.id, "check_run.id")
      })

      return {
        getRepository,
        downloadRepositoryArchive,
        upsertCheckRun,
      }
    }),
  )
}

const requestJson = (
  auth: typeof GitHubAppAuth.Service,
  apiBaseUrl: string,
  installationId: number,
  operation: string,
  path: string,
  method = "GET",
  body?: unknown,
) =>
  Effect.gen(function* () {
    const token = yield* auth.getInstallationToken(installationId).pipe(
      Effect.mapError(
        (error) =>
          new GitHubApiFailed({
            operation,
            message: error.message,
          }),
      ),
    )

    return yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(buildApiUrl(apiBaseUrl, path), {
          method,
          headers: {
            ...gitHubHeaders(token.token),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })

        if (!response.ok) {
          throw new HttpResponseError(response.status, await toResponseError(response))
        }

        return (await response.json()) as Record<string, any>
      },
      catch: (error) => toGitHubApiFailed(operation, error),
    })
  })

const requestBytes = (
  auth: typeof GitHubAppAuth.Service,
  apiBaseUrl: string,
  installationId: number,
  operation: string,
  path: string,
) =>
  Effect.gen(function* () {
    const token = yield* auth.getInstallationToken(installationId).pipe(
      Effect.mapError(
        (error) =>
          new GitHubApiFailed({
            operation,
            message: error.message,
          }),
      ),
    )

    return yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(buildApiUrl(apiBaseUrl, path), {
          headers: gitHubHeaders(token.token),
        })

        if (!response.ok) {
          throw new HttpResponseError(response.status, await toResponseError(response))
        }

        return new Uint8Array(await response.arrayBuffer())
      },
      catch: (error) => toGitHubApiFailed(operation, error),
    })
  })

class HttpResponseError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

const toGitHubApiFailed = (operation: string, error: unknown) =>
  new GitHubApiFailed({
    operation,
    ...(error instanceof HttpResponseError ? { statusCode: error.statusCode } : {}),
    message: error instanceof Error ? error.message : String(error),
  })

const gitHubHeaders = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "effect-cicd",
  "x-github-api-version": "2022-11-28",
})

const buildApiUrl = (baseUrl: string, path: string) => new URL(path, ensureTrailingSlash(baseUrl)).toString()

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)

const toResponseError = async (response: Response) => {
  const body = await response.text()
  return body.trim().length === 0 ? `GitHub API request failed with HTTP ${response.status}` : body
}

const encode = (value: string) => encodeURIComponent(value)

const asInt = (value: unknown, label: string) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }

  throw new Error(`GitHub API response missing integer ${label}`)
}

const asString = (value: unknown, label: string) => {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`GitHub API response missing string ${label}`)
}

const asOptionalString = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)
