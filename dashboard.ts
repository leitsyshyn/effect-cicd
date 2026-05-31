import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { dashboardProgram, makeDashboardLayer } from "./src/dashboard/server.ts"

const dashboardLayer = makeDashboardLayer().pipe(Layer.provideMerge(BunServices.layer))

dashboardProgram.pipe(Effect.provide(dashboardLayer), BunRuntime.runMain)
