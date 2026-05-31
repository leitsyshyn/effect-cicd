import { Effect, Layer, Schema, Stream } from "effect"
import { flow } from "effect/Function"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Sse } from "effect/unstable/encoding"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { DomainError, EngineUnavailable } from "../domain/errors.ts"
import { ExecutionPlan } from "../domain/execution-plan.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { ArtifactRef, LogRef, RunId } from "../domain/ids.ts"
import { RunExecutionOptions, WorkflowRunState, WorkflowRunStatus } from "../domain/runtime-state.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"
import { Engine } from "../engine/interface.ts"
import { type RunStartOptions } from "../engine/orchestrator.ts"
import { RunUpdate } from "../engine/run-updates.ts"
import { EngineServiceConfig } from "../runtime/config.ts"
import { RunActionRequest, RunSubmissionRequest, ServiceErrorResponse } from "./contracts.ts"
import { decodeJson, encodeJson } from "./schema-json.ts"

export const engineServiceClientLayer = Layer.effect(
  Engine,
  Effect.gen(function* () {
    const config = yield* EngineServiceConfig
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(flow(HttpClientRequest.prependUrl(config.baseUrl), HttpClientRequest.acceptJson)),
    )

    const validate = Effect.fn("EngineServiceClient.validate")(function* (definition: NormalizedWorkflowDefinition) {
      const request = HttpClientRequest.post("/api/workflows/validate").pipe(
        HttpClientRequest.bodyJsonUnsafe(encodeJson(NormalizedWorkflowDefinition, definition)),
      )
      yield* requestJsonNoContent(http, request)
    })

    const plan = Effect.fn("EngineServiceClient.plan")(function* (definition: NormalizedWorkflowDefinition) {
      const request = HttpClientRequest.post("/api/workflows/plan").pipe(
        HttpClientRequest.bodyJsonUnsafe(encodeJson(NormalizedWorkflowDefinition, definition)),
      )
      return yield* requestJson(http, request, ExecutionPlan)
    })

    const submitRun = Effect.fn("EngineServiceClient.submitRun")(function* (executionPlan: ExecutionPlan, options?: RunStartOptions) {
      const request = HttpClientRequest.post("/api/runs").pipe(
        HttpClientRequest.bodyJsonUnsafe(
          encodeJson(
            RunSubmissionRequest,
            new RunSubmissionRequest({
              plan: executionPlan,
              options:
                options?.workspacePath === undefined
                  ? undefined
                  : new RunExecutionOptions({ workspacePath: options.workspacePath }),
            }),
          ),
        ),
      )
      return yield* requestJson(http, request, WorkflowRunState)
    })

    const inspectRun = Effect.fn("EngineServiceClient.inspectRun")((runId: RunId) =>
      requestJson(http, HttpClientRequest.get(`/api/runs/${encodeURIComponent(runId)}`), WorkflowRunState),
    )

    const startRun = Effect.fn("EngineServiceClient.startRun")(function* (executionPlan: ExecutionPlan, options?: RunStartOptions) {
      const run = yield* submitRun(executionPlan, options)
      return yield* waitForTerminalRun(inspectRun, run.runId)
    })

    const cancelRun = Effect.fn("EngineServiceClient.cancelRun")((runId: RunId, reason?: string) =>
      requestJson(
        http,
        HttpClientRequest.post(`/api/runs/${encodeURIComponent(runId)}/cancel`).pipe(
          HttpClientRequest.bodyJsonUnsafe(
            encodeJson(RunActionRequest, new RunActionRequest({ runId, reason })),
          ),
        ),
        WorkflowRunState,
      ),
    )

    const retryRun = Effect.fn("EngineServiceClient.retryRun")((runId: RunId, reason?: string) =>
      requestJson(
        http,
        HttpClientRequest.post(`/api/runs/${encodeURIComponent(runId)}/retry`).pipe(
          HttpClientRequest.bodyJsonUnsafe(
            encodeJson(RunActionRequest, new RunActionRequest({ runId, reason })),
          ),
        ),
        WorkflowRunState,
      ),
    )

    const listRuns = Effect.fn("EngineServiceClient.listRuns")(() =>
      requestJson(http, HttpClientRequest.get("/api/runs"), Schema.Array(WorkflowRunState)),
    )

    const readRunEvents = Effect.fn("EngineServiceClient.readRunEvents")((runId: RunId) =>
      requestJson(http, HttpClientRequest.get(`/api/runs/${encodeURIComponent(runId)}/events`), Schema.Array(WorkflowEvent)),
    )

    const readArtifacts = Effect.fn("EngineServiceClient.readArtifacts")((runId: RunId) =>
      requestJson(http, HttpClientRequest.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`), Schema.Array(ArtifactMetadata)),
    )

    const readArtifactPayload = Effect.fn("EngineServiceClient.readArtifactPayload")((artifactRef: ArtifactRef) =>
      requestText(http, HttpClientRequest.get(`/api/artifacts/${encodeURIComponent(artifactRef)}`)),
    )

    const readLogs = Effect.fn("EngineServiceClient.readLogs")((runId: RunId) =>
      requestJson(http, HttpClientRequest.get(`/api/runs/${encodeURIComponent(runId)}/logs`), Schema.Array(LogMetadata)),
    )

    const readLogPayload = Effect.fn("EngineServiceClient.readLogPayload")((logRef: LogRef) =>
      requestText(http, HttpClientRequest.get(`/api/logs/${encodeURIComponent(logRef)}`)),
    )

    const streamRuns = () => requestStream(http, HttpClientRequest.get("/api/runs/stream"))

    const streamRun = (runId: RunId) => requestStream(http, HttpClientRequest.get(`/api/runs/${encodeURIComponent(runId)}/stream`))

    return {
      validate,
      plan,
      startRun,
      submitRun,
      cancelRun,
      retryRun,
      listRuns,
      inspectRun,
      streamRuns,
      streamRun,
      readRunEvents,
      readArtifacts,
      readArtifactPayload,
      readLogs,
      readLogPayload,
    }
  }),
)

export const defaultEngineServiceClientLayer = engineServiceClientLayer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(EngineServiceConfig.layer),
)

export const requestText = (
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<string, DomainError> =>
  request.pipe(
    http.execute,
    Effect.flatMap(handleResponse),
    Effect.flatMap((response) => response.text),
    Effect.mapError((error) => (isDomainError(error) ? error : toEngineUnavailable(error))),
  )

export const openServiceEventStream = (path: string) =>
  Effect.gen(function* () {
    const config = yield* EngineServiceConfig
    return yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(new URL(path, config.baseUrl), {
          headers: { accept: "text/event-stream" },
        })

        if (!response.ok || response.body === null) {
          throw new Error(await response.text())
        }

        return response.body
      },
      catch: toEngineUnavailable,
    })
  })

const requestJson = <A, I, RD, RE>(
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, I, RD, RE>,
): Effect.Effect<A, DomainError> =>
  request.pipe(
    http.execute,
    Effect.flatMap(handleResponse),
    Effect.flatMap((response) => response.json),
    Effect.map((body) => decodeJson(schema, body)),
    Effect.mapError((error) => (isDomainError(error) ? error : toEngineUnavailable(error))),
  )

const requestJsonNoContent = (
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<void, DomainError> =>
  request.pipe(
    http.execute,
    Effect.flatMap(handleResponse),
    Effect.asVoid,
    Effect.mapError((error) => (isDomainError(error) ? error : toEngineUnavailable(error))),
  )

const requestStream = (http: HttpClient.HttpClient, request: HttpClientRequest.HttpClientRequest): Stream.Stream<RunUpdate, DomainError> =>
  (() => {
    const parser = makeRunUpdateSseParser()

    return Stream.unwrap(
      request.pipe(
        http.execute,
        Effect.flatMap(handleResponse),
        Effect.map((response) =>
          response.stream.pipe(
            Stream.decodeText,
            Stream.map(parser.feed),
            Stream.flatMap((updates) => Stream.fromIterable(updates)),
            Stream.mapError(toEngineUnavailable),
          ),
        ),
        Effect.mapError((error) => (isDomainError(error) ? error : toEngineUnavailable(error))),
      ),
    )
  })()

const waitForTerminalRun = (
  inspectRun: (runId: RunId) => Effect.Effect<WorkflowRunState, DomainError>,
  runId: RunId,
): Effect.Effect<WorkflowRunState, DomainError> =>
  inspectRun(runId).pipe(
    Effect.flatMap((run) =>
      terminalRunStatuses.has(run.status)
        ? Effect.succeed(run)
        : Effect.sleep("250 millis").pipe(Effect.flatMap(() => waitForTerminalRun(inspectRun, runId))),
    ),
  )

const handleResponse = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<HttpClientResponse.HttpClientResponse, DomainError> => {
  if (response.status >= 200 && response.status < 300) {
    return Effect.succeed(response)
  }

  return response.text.pipe(
    Effect.flatMap((text) =>
      Effect.sync(() => {
        const body = text.length === 0 ? undefined : JSON.parse(text)

        try {
          return decodeJson(DomainError, body)
        } catch {
          return decodeJson(ServiceErrorResponse, body)
        }
      }),
    ),
    Effect.flatMap((error) => Effect.fail(isDomainError(error) ? error : new EngineUnavailable({ message: error.error }))),
    Effect.catchIf(
      (error) => !isDomainError(error),
      () => Effect.fail(new EngineUnavailable({ message: `HTTP ${response.status}` })),
    ),
  )
}

const makeRunUpdateSseParser = () => {
  let buffer = new Array<RunUpdate>()
  const parser = Sse.makeParser((event) => {
    if (event._tag !== "Event") {
      return
    }

    buffer.push(decodeJson(RunUpdate, JSON.parse(event.data)))
  })

  return {
    feed: (chunk: string) => {
      parser.feed(chunk)
      const updates = buffer
      buffer = []
      return updates
    },
  }
}

const isDomainError = (error: unknown): error is DomainError =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

const toEngineUnavailable = (error: unknown) =>
  new EngineUnavailable({
    message: error instanceof Error ? error.message : String(error),
  })

const terminalRunStatuses = new Set<WorkflowRunStatus>(["succeeded", "failed", "canceled", "interrupted"])
