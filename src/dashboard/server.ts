import { Console, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

import { Engine } from "../engine/interface.ts"
import { EngineServiceConfig } from "../runtime/config.ts"
import { engineServiceClientLayer } from "../service/client.ts"
import dashboardHtml from "./dashboard.html"
import { createDashboardHandlers } from "./handlers.ts"

export const makeDashboardLayer = () =>
  engineServiceClientLayer.pipe(
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(EngineServiceConfig.layer),
  )

export const dashboardProgram = Effect.gen(function* () {
  const engine = yield* Engine
  const engineServiceConfig = yield* EngineServiceConfig

  const handlers = createDashboardHandlers(engine as any)
  const port = Number(process.env.DASHBOARD_PORT ?? 3001)
  const development = process.env.NODE_ENV !== "production"

  const server = Bun.serve({
    port,
    routes: {
      "/": dashboardHtml,
      "/runs/:runId": dashboardHtml,
      "/api/runs": {
        GET: () => handlers.listRuns(),
      },
      "/api/runs/stream": {
        GET: () => proxyEventStream(`${engineServiceConfig.baseUrl}/api/runs/stream`),
      },
      "/api/runs/:runId": {
        GET: (request) => handlers.inspectRun(request.params.runId),
      },
      "/api/runs/:runId/stream": {
        GET: (request) => proxyEventStream(`${engineServiceConfig.baseUrl}/api/runs/${encodeURIComponent(request.params.runId)}/stream`),
      },
      "/api/runs/:runId/events": {
        GET: (request) => handlers.listEvents(request.params.runId, new URL(request.url).searchParams.get("unitId") ?? undefined),
      },
      "/api/runs/:runId/logs": {
        GET: (request) => handlers.listLogs(request.params.runId),
      },
      "/api/logs/:logRef": {
        GET: (request) => handlers.readLogPayload(request.params.logRef),
      },
      "/api/runs/:runId/artifacts": {
        GET: (request) => handlers.listArtifacts(request.params.runId),
      },
      "/api/artifacts/:artifactRef": {
        GET: (request) => handlers.readArtifactPayload(request.params.artifactRef),
      },
    },
    development: development ? { hmr: true, console: true } : false,
    fetch() {
      return new Response("Not Found", { status: 404 })
    },
  })

  yield* Console.log(`dashboard listening on ${server.url}`)
  return yield* Effect.never
})

const proxyEventStream = async (url: string) => {
  const response = await fetch(url, {
    headers: { accept: "text/event-stream" },
  })

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": response.headers.get("cache-control") ?? "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
