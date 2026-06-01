import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runWithLocalService } from "../src/cli/local.ts"

describe("local CLI bootstrap", () => {
  it.effect("starts a local service, runs the program against its base URL, and stops it", () =>
    Effect.gen(function* () {
      const events = new Array<string>()

      const result = yield* runWithLocalService(
        Effect.sync(() => ({
          baseUrl: "http://127.0.0.1:4010",
          stop: () => {
            events.push("stop")
          },
        })),
        (baseUrl) =>
          Effect.sync(() => {
            events.push(`run:${baseUrl}`)
            return baseUrl
          }),
      )

      expect(result).toBe("http://127.0.0.1:4010")
      expect(events).toEqual(["run:http://127.0.0.1:4010", "stop"])
    }),
  )
})
