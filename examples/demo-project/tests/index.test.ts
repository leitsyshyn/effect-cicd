import { expect, test } from "bun:test"

import { add, describeBuild } from "../src/index.ts"

test("add sums numbers", () => {
  expect(add(20, 22)).toBe(42)
})

test("build metadata stays deterministic", () => {
  expect(describeBuild()).toEqual({
    name: "effect-cicd-demo-project",
    result: 42,
    builtWith: "bun",
  })
})
