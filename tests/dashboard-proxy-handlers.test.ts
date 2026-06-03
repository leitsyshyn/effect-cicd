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

  it("forwards project run creation requests", async () => {
    const handlers = createDashboardProxyHandlers("http://engine.test", async (input, init) => {
      expect(input).toBe("http://engine.test/api/projects/project%3Ademo/runs")
      expect(init?.method).toBe("POST")
      expect(init?.headers).toEqual({ "content-type": "application/json" })
      expect(init?.body).toBe(JSON.stringify({ inputValues: { release: "1.2.3" } }))

      return Response.json({
        runId: "run:demo",
        projectId: "project:demo",
        planId: "plan:demo",
        workflowId: "workflow:demo",
        status: "queued",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        progress: { totalUnits: 1, completedUnits: 0, failedUnits: 0, skippedUnits: 0 },
      })
    })

    const response = await handlers.startProjectRun("project:demo", { inputValues: { release: "1.2.3" } })
    await expect(response.json()).resolves.toEqual({
      runId: "run:demo",
      projectId: "project:demo",
      planId: "plan:demo",
      workflowId: "workflow:demo",
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      progress: { totalUnits: 1, completedUnits: 0, failedUnits: 0, skippedUnits: 0 },
      controls: { canCancel: true, canRetry: false, canGc: false },
    })
  })

  it("forwards project run config requests", async () => {
    const handlers = createDashboardProxyHandlers("http://engine.test", async (input, init) => {
      expect(input).toBe("http://engine.test/api/projects/project%3Ademo/runs")
      expect(init?.method).toBe("GET")

      return Response.json({ requiredInputs: ["release"] })
    })

    const response = await handlers.getProjectRunConfig("project:demo")
    await expect(response.json()).resolves.toEqual({ requiredInputs: ["release"] })
  })

  it("forwards GitHub branch and workflow discovery requests", async () => {
    const seen = new Array<string>()
    const handlers = createDashboardProxyHandlers("http://engine.test", async (input) => {
      seen.push(String(input))
      return Response.json([])
    })

    await handlers.listGitHubRepositoryBranches(1001, "acme/widgets")
    await handlers.listGitHubRepositoryWorkflowFiles(1001, "acme/widgets", "main")

    expect(seen).toEqual([
      "http://engine.test/api/github/repositories/branches?installationId=1001&repository=acme%2Fwidgets",
      "http://engine.test/api/github/repositories/workflows?installationId=1001&repository=acme%2Fwidgets&ref=main",
    ])
  })
})
