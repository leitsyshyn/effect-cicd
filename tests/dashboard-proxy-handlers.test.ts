import { describe, expect, it } from "@effect/vitest"

import { createDashboardProxyHandlers } from "../src/dashboard/proxy-handlers.ts"

describe("dashboard proxy handlers", () => {
  it("forwards project-scoped run queries", async () => {
    const handlers = createDashboardProxyHandlers("http://engine.test", async (input) => {
      expect(input).toBe("http://engine.test/api/runs?projectId=project%3Ademo")
      return Response.json([])
    })

    const response = await handlers.listRuns("project:demo")
    await expect(response.json()).resolves.toEqual([])
  })

  it("passes binary artifact payloads through unchanged", async () => {
    const body = new Uint8Array([1, 2, 3, 4])
    const handlers = createDashboardProxyHandlers("http://engine.test", async (input) => {
      expect(input).toBe("http://engine.test/api/artifacts/artifact%3Ademo")
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": "inline; filename=artifact.bin",
        },
      })
    })

    const response = await handlers.readArtifactPayload("artifact:demo")

    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("content-disposition")).toBe("inline; filename=artifact.bin")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
  })
})
