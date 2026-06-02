import { Effect } from "effect"

import { ArtifactRef, LogRef, RunId, UnitId } from "../domain/ids.ts"
import type { DashboardEngine } from "./reads.ts"
import { mapEvent, mapPayloadMetadata, mapRunDetail, mapRunSummary } from "./reads.ts"

export const createDashboardHandlers = (engine: DashboardEngine) => ({
  version: () => runText(engine.version()),

  listRuns: () => runJson(engine.listRuns().pipe(Effect.map((runs) => runs.map(mapRunSummary)))),

  inspectRun: (runId: string) => {
    const brandedRunId = RunId.make(runId)
    return runJson(
      Effect.all([
        engine.inspectRun(brandedRunId),
        engine.readRunEvents(brandedRunId),
        engine.readArtifacts(brandedRunId),
        engine.readLogs(brandedRunId),
      ]).pipe(Effect.map(([run, events, artifacts, logs]) => mapRunDetail(run, events, artifacts, logs))),
    )
  },

  listEvents: (runId: string, unitId?: string) => {
    const brandedRunId = RunId.make(runId)
    const brandedUnitId = unitId === undefined ? undefined : UnitId.make(unitId)

    return runJson(
      engine.readRunEvents(brandedRunId).pipe(
        Effect.map((events) =>
          events
            .filter((event) => (brandedUnitId === undefined ? true : ("unitId" in event ? event.unitId === brandedUnitId : false)))
            .map(mapEvent),
        ),
      ),
    )
  },

  listArtifacts: (runId: string) =>
    runJson(engine.readArtifacts(RunId.make(runId)).pipe(Effect.map((artifacts) => artifacts.map(mapPayloadMetadata)))),

  listLogs: (runId: string) =>
    runJson(engine.readLogs(RunId.make(runId)).pipe(Effect.map((logs) => logs.map(mapPayloadMetadata)))),

  cancelRun: (runId: string, reason?: string) => runJson(engine.cancelRun(RunId.make(runId), reason).pipe(Effect.map(mapRunSummary))),

  retryRun: (runId: string, reason?: string) => runJson(engine.retryRun(RunId.make(runId), reason).pipe(Effect.map(mapRunSummary))),

  gcRunArtifacts: (runId: string) => runJson(engine.gcRunArtifacts(RunId.make(runId))),

  readLogPayload: (logRef: string) => runText(engine.readLogPayload(LogRef.make(logRef))),

  readArtifactPayload: (artifactRef: string) => runText(engine.readArtifactPayload(ArtifactRef.make(artifactRef))),
})

const runJson = async <A>(effect: Effect.Effect<A, unknown, never>) => {
  try {
    const payload = await Effect.runPromise(effect)
    return Response.json(payload)
  } catch (error) {
    return errorResponse(error)
  }
}

const runText = async (effect: Effect.Effect<string, unknown, never>) => {
  try {
    const payload = await Effect.runPromise(effect)
    return new Response(payload, { headers: { "content-type": "text/plain; charset=utf-8" } })
  } catch (error) {
    return errorResponse(error)
  }
}

const errorResponse = (error: unknown) => {
  const status = isNotFound(error) ? 404 : 500
  const message = error instanceof Error ? error.message : String(error)
  return Response.json({ error: message }, { status })
}

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "RunNotFound" || error._tag === "ArtifactNotFound" || error._tag === "LogNotFound")
