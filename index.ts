import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { appProgram, makeAppLayer } from "./src/cli/index.ts"

const appLayer = makeAppLayer().pipe(Layer.provideMerge(BunServices.layer))

appProgram.pipe(Effect.provide(appLayer), BunRuntime.runMain)
