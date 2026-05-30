import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { cliProgram, makeAppLayer } from "./src/cli/index.ts"

// Opt-in entrypoint that uses the real local Docker executor.
const appLayer = makeAppLayer().pipe(Layer.provideMerge(BunServices.layer))

cliProgram.pipe(Effect.provide(appLayer), BunRuntime.runMain)
