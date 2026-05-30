import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { cliProgram, makeCliLayer } from "./src/cli/index.ts"

// Default entrypoint stays deterministic and does not depend on Docker.
cliProgram.pipe(Effect.provide(Layer.mergeAll(makeCliLayer(), BunServices.layer)), BunRuntime.runMain)
