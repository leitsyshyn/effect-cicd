import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { cliProgram, makeCliLayer } from "./src/cli/index.ts"

cliProgram.pipe(Effect.provide(Layer.mergeAll(makeCliLayer(), BunServices.layer)), BunRuntime.runMain)
