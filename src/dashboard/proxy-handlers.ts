import { mapRawEvent, mapRawPayloadMetadata, mapRawRunDetail, mapRawRunSummary } from "./reads.ts"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const createDashboardProxyHandlers = (baseUrl: string, fetcher: FetchLike = fetch) => ({
  version: () => proxyText(fetcher, `${baseUrl}/version`),

  listRuns: async () => {
    try {
      const runs = await fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs`)
      return Response.json(runs.map(mapRawRunSummary))
    } catch (error) {
      return errorResponse(error)
    }
  },

  inspectRun: async (runId: string) => {
    try {
      const encodedRunId = encodeURIComponent(runId)
      const [run, events, artifacts, logs] = await Promise.all([
        fetchJson<Record<string, unknown>>(fetcher, `${baseUrl}/api/runs/${encodedRunId}`),
        fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodedRunId}/events`),
        fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodedRunId}/artifacts`),
        fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodedRunId}/logs`),
      ])

      return Response.json(mapRawRunDetail(run, events, artifacts, logs))
    } catch (error) {
      return errorResponse(error)
    }
  },

  listEvents: async (runId: string, unitId?: string) => {
    try {
      const encodedRunId = encodeURIComponent(runId)
      const events = await fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodedRunId}/events`)
      const mapped = events.map(mapRawEvent)
      return Response.json(unitId === undefined ? mapped : mapped.filter((event) => event.unitId === unitId))
    } catch (error) {
      return errorResponse(error)
    }
  },

  listArtifacts: async (runId: string) => {
    try {
      const artifacts = await fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts`)
      return Response.json(artifacts.map(mapRawPayloadMetadata))
    } catch (error) {
      return errorResponse(error)
    }
  },

  listLogs: async (runId: string) => {
    try {
      const logs = await fetchJson<ReadonlyArray<unknown>>(fetcher, `${baseUrl}/api/runs/${encodeURIComponent(runId)}/logs`)
      return Response.json(logs.map(mapRawPayloadMetadata))
    } catch (error) {
      return errorResponse(error)
    }
  },

  cancelRun: (runId: string, reason?: string) =>
    proxyJson(fetcher, `${baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason === undefined ? {} : { runId, reason }),
    }, mapRawRunSummary),

  retryRun: (runId: string, reason?: string) =>
    proxyJson(fetcher, `${baseUrl}/api/runs/${encodeURIComponent(runId)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason === undefined ? {} : { runId, reason }),
    }, mapRawRunSummary),

  gcRunArtifacts: (runId: string) =>
    proxyJson(fetcher, `${baseUrl}/api/runs/${encodeURIComponent(runId)}/gc`, { method: "POST" }),

  readLogPayload: (logRef: string) => proxyText(fetcher, `${baseUrl}/api/logs/${encodeURIComponent(logRef)}`),

  readArtifactPayload: (artifactRef: string) => proxyText(fetcher, `${baseUrl}/api/artifacts/${encodeURIComponent(artifactRef)}`),
})

const proxyJson = async <A>(
  fetcher: FetchLike,
  url: string,
  init?: RequestInit,
  map?: (value: any) => A,
) => {
  try {
    const payload = await fetchJson<any>(fetcher, url, init)
    return Response.json(map === undefined ? payload : map(payload))
  } catch (error) {
    return errorResponse(error)
  }
}

const proxyText = async (fetcher: FetchLike, url: string, init?: RequestInit) => {
  try {
    const response = await fetcher(url, init)
    if (!response.ok) {
      throw new Error(await readError(response))
    }

    return new Response(await response.text(), {
      headers: { "content-type": response.headers.get("content-type") ?? "text/plain; charset=utf-8" },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

const fetchJson = async <A>(fetcher: FetchLike, url: string, init?: RequestInit) => {
  const response = await fetcher(url, init)
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

const errorResponse = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: error instanceof Error && error.message.toLowerCase().includes("not found") ? 404 : 500 },
  )
