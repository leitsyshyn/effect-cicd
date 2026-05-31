import { Console, Effect } from "effect"

import { makeAppLayer } from "../cli/index.ts"
import { Engine } from "../engine/interface.ts"
import { Orchestrator } from "../engine/orchestrator.ts"
import { StorageRuntimeConfig } from "../runtime/config.ts"
import dashboardHtml from "./dashboard.html"
import { createDashboardHandlers } from "./handlers.ts"

export const makeDashboardLayer = () => makeAppLayer()

export const dashboardProgram = Effect.gen(function* () {
  const runtimeConfig = yield* StorageRuntimeConfig
  const orchestrator = yield* Orchestrator
  const engine = yield* Engine

  if (runtimeConfig.runRecoveryOnStartup) {
    yield* orchestrator.resumeIncompleteRuns()
  }

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
      "/api/runs/:runId": {
        GET: (request) => handlers.inspectRun(request.params.runId),
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
