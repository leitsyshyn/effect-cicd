import type { RunDetailDto, RunSummaryDto, PayloadMetadataDto, TimelineEventDto } from "./types.ts"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const createDashboardApi = (fetcher: FetchLike = fetch) => ({
  listRuns: () => getJson<ReadonlyArray<RunSummaryDto>>(fetcher, "/api/runs"),
  inspectRun: (runId: string) => getJson<RunDetailDto>(fetcher, `/api/runs/${encodeURIComponent(runId)}`),
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
    throw new Error(await response.text())
  }

  return (await response.json()) as A
}

const getText = async (fetcher: FetchLike, path: string) => {
  const response = await fetcher(path)
  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.text()
}
