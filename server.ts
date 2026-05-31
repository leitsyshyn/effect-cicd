import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { makeServiceLayer, serviceProgram } from "./src/service/server.ts"

const serviceLayer = makeServiceLayer().pipe(Layer.provideMerge(BunServices.layer))

serviceProgram.pipe(Effect.provide(serviceLayer), BunRuntime.runMain)
