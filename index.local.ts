import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"

import { localCliProgram } from "./src/cli/local.ts"

localCliProgram.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
