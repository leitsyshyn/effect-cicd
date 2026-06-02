import type { RunDetailDto, RunSummaryDto, PayloadMetadataDto, TimelineEventDto } from "./types.ts"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface ProjectSummaryDto {
  readonly projectId: string
  readonly provider: string
  readonly repositoryOwner?: string
  readonly repositoryName?: string
  readonly repositoryId?: number
  readonly bindingCount: number
  readonly runCount: number
  readonly latestRunAt?: string
}

export interface GitHubBindingSummaryDto {
  readonly bindingId: string
  readonly projectId: string
  readonly provider: "github"
  readonly installationId?: number
  readonly repositoryId?: number
  readonly repository: string
  readonly cloneUrl: string
  readonly sourceKind: "github-archive"
  readonly branch?: string
  readonly workflowModulePath: string
  readonly workspaceSubdir?: string
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface GitHubBindingCreateRequestDto {
  readonly repository: string
  readonly installationId: number
  readonly workflowModulePath: string
  readonly branch?: string
  readonly workspaceSubdir?: string
  readonly enabled?: boolean
}

export interface SecretSummaryDto {
  readonly projectId: string
  readonly key: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SecretSetRequestDto {
  readonly projectId: string
  readonly key: string
  readonly value: string
}

export type ArtifactPayloadDto =
  | { readonly kind: "text"; readonly text: string; readonly contentType?: string }
  | { readonly kind: "binary"; readonly contentType?: string }

export const createDashboardApi = (fetcher: FetchLike = fetch) => ({
  getVersion: () => getText(fetcher, "/api/version"),
  listProjects: () => getJson<ReadonlyArray<ProjectSummaryDto>>(fetcher, "/api/projects"),
  listBindings: () => getJson<ReadonlyArray<GitHubBindingSummaryDto>>(fetcher, "/api/bindings"),
  createBinding: (request: GitHubBindingCreateRequestDto) =>
    postJson<GitHubBindingSummaryDto>(fetcher, "/api/bindings/github", request),
  listSecrets: (projectId: string) =>
    getJson<ReadonlyArray<SecretSummaryDto>>(fetcher, `/api/secrets?projectId=${encodeURIComponent(projectId)}`),
  setSecret: (request: SecretSetRequestDto) => postEmpty(fetcher, "/api/secrets", request),
  deleteSecret: (projectId: string, key: string) =>
    sendEmpty(fetcher, `/api/secrets/${encodeURIComponent(projectId)}/${encodeURIComponent(key)}`, { method: "DELETE" }),
  listRuns: (projectId?: string) =>
    getJson<ReadonlyArray<RunSummaryDto>>(
      fetcher,
      projectId === undefined ? "/api/runs" : `/api/runs?projectId=${encodeURIComponent(projectId)}`,
    ),
  inspectRun: (runId: string) => getJson<RunDetailDto>(fetcher, `/api/runs/${encodeURIComponent(runId)}`),
  cancelRun: (runId: string, reason?: string) => postJson<RunSummaryDto | RunDetailDto["run"]>(fetcher, `/api/runs/${encodeURIComponent(runId)}/cancel`, reason === undefined ? undefined : { reason }),
  retryRun: (runId: string, reason?: string) => postJson<RunSummaryDto>(fetcher, `/api/runs/${encodeURIComponent(runId)}/retry`, reason === undefined ? undefined : { reason }),
  gcRunArtifacts: (runId: string) => postJson<{ readonly deletedCount: number; readonly bytesFreed: number }>(fetcher, `/api/runs/${encodeURIComponent(runId)}/gc`),
  listEvents: (runId: string, unitId?: string) =>
    getJson<ReadonlyArray<TimelineEventDto>>(
      fetcher,
      `/api/runs/${encodeURIComponent(runId)}/events${unitId === undefined ? "" : `?unitId=${encodeURIComponent(unitId)}`}`,
    ),
  listLogs: (runId: string) => getJson<ReadonlyArray<PayloadMetadataDto>>(fetcher, `/api/runs/${encodeURIComponent(runId)}/logs`),
  listArtifacts: (runId: string) =>
    getJson<ReadonlyArray<PayloadMetadataDto>>(fetcher, `/api/runs/${encodeURIComponent(runId)}/artifacts`),
  readLogPayload: (logRef: string) => getText(fetcher, `/api/logs/${encodeURIComponent(logRef)}`),
  readArtifactPayload: async (artifactRef: string): Promise<ArtifactPayloadDto> => {
    const response = await fetchOk(fetcher, `/api/artifacts/${encodeURIComponent(artifactRef)}`)
    const contentType = response.headers.get("content-type") ?? undefined

    if (isTextLike(contentType)) {
      return {
        kind: "text",
        text: await response.text(),
        ...(contentType === undefined ? {} : { contentType }),
      }
    }

    return {
      kind: "binary",
      ...(contentType === undefined ? {} : { contentType }),
    }
  },
})

const getJson = async <A>(fetcher: FetchLike, path: string) => {
  const response = await fetchOk(fetcher, path)
  return (await response.json()) as A
}

const getText = async (fetcher: FetchLike, path: string) => {
  const response = await fetchOk(fetcher, path)
  return response.text()
}

const postJson = async <A>(fetcher: FetchLike, path: string, body?: unknown) => {
  const response = await fetchOk(fetcher, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  return (await response.json()) as A
}

const postEmpty = async (fetcher: FetchLike, path: string, body?: unknown) => {
  await fetchOk(fetcher, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const sendEmpty = async (fetcher: FetchLike, path: string, init?: RequestInit) => {
  await fetchOk(fetcher, path, init)
}

const fetchOk = async (fetcher: FetchLike, path: string, init?: RequestInit) => {
  const response = await fetcher(path, init)
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return response
}

const isTextLike = (contentType: string | undefined) => {
  if (contentType === undefined) {
    return false
  }

  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("svg")
  )
}

const readError = async (response: Response) => {
  const text = await response.text()

  try {
    const payload = JSON.parse(text)
    if (typeof payload.error === "string") {
      return payload.error
    }
  } catch {
    return text
  }

  return text
}
