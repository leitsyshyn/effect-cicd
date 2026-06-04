#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { appProgram, makeAppLayerForBaseUrl } from "../src/cli/index.ts"
import { makeServiceLayer, startServiceServer } from "../src/service/server.ts"

const DEFAULT_BASE_URL = "http://127.0.0.1:3000"

const healthCheck = Effect.tryPromise(() =>
  fetch(`${DEFAULT_BASE_URL}/healthz`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok),
).pipe(Effect.catch(() => Effect.succeed(false)))

const connectToServer = (baseUrl: string) =>
  appProgram.pipe(
    Effect.provide(
      makeAppLayerForBaseUrl(baseUrl).pipe(Layer.provideMerge(BunServices.layer)),
    ),
  )

const startLocalServer = Effect.acquireUseRelease(
  Effect.gen(function* () {
    const serviceLayer = makeServiceLayer().pipe(Layer.provideMerge(BunServices.layer))
    const server = yield* startServiceServer.pipe(Effect.provide(serviceLayer))
    return {
      baseUrl: String(server.url),
      stop: () => server.stop(true),
    }
  }),
  (service) => connectToServer(service.baseUrl),
  (service) => Effect.promise(() => Promise.resolve(service.stop()).then(() => undefined)),
)

const program = healthCheck.pipe(
  Effect.flatMap((running) => (running ? connectToServer(DEFAULT_BASE_URL) : startLocalServer)),
)

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
