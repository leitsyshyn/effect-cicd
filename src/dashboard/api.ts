import type { RunDetailDto, RunSummaryDto, PayloadMetadataDto, TimelineEventDto } from "./types.ts"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const createDashboardApi = (fetcher: FetchLike = fetch) => ({
  getVersion: () => getText(fetcher, "/api/version"),
  listRuns: () => getJson<ReadonlyArray<RunSummaryDto>>(fetcher, "/api/runs"),
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
  readArtifactPayload: (artifactRef: string) => getText(fetcher, `/api/artifacts/${encodeURIComponent(artifactRef)}`),
})

const getJson = async <A>(fetcher: FetchLike, path: string) => {
  const response = await fetcher(path)
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return (await response.json()) as A
}

const getText = async (fetcher: FetchLike, path: string) => {
  const response = await fetcher(path)
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return response.text()
}

const postJson = async <A>(fetcher: FetchLike, path: string, body?: unknown) => {
  const response = await fetcher(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return (await response.json()) as A
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
