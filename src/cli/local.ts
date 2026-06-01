import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { appProgram, makeAppLayerForBaseUrl } from "./index.ts"
import { makeServiceLayer, startServiceServer } from "../service/server.ts"

export interface LocalServiceHandle {
  readonly baseUrl: string
  readonly stop: () => void | Promise<void>
}

export const runWithLocalService = <A, E1, E2>(
  startLocalService: Effect.Effect<LocalServiceHandle, E1>,
  runProgram: (baseUrl: string) => Effect.Effect<A, E2>,
) =>
  Effect.acquireUseRelease(
    startLocalService,
    (service) => runProgram(service.baseUrl),
    (service) => Effect.promise(() => Promise.resolve(service.stop()).then(() => undefined)),
  )

export const localCliProgram = runWithLocalService(
  Effect.gen(function* () {
    const serviceLayer = makeServiceLayer().pipe(Layer.provideMerge(BunServices.layer))
    const server = yield* startServiceServer.pipe(Effect.provide(serviceLayer))
    return {
      baseUrl: String(server.url),
      stop: () => server.stop(true),
    } satisfies LocalServiceHandle
  }),
  (baseUrl) =>
    appProgram.pipe(
      Effect.provide(
        makeAppLayerForBaseUrl(baseUrl).pipe(Layer.provideMerge(BunServices.layer)),
      ),
    ),
)
