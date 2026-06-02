import { describe, expect, it } from "@effect/vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import { createDashboardApi } from "../src/dashboard/api.ts"
import { RunHeader } from "../src/dashboard/components/run-header.tsx"
import { RunPipelineView } from "../src/dashboard/components/run-pipeline.tsx"
import { hrefForJob, hrefForProject, hrefForRun, parseDashboardRoute } from "../src/dashboard/lib/routing.ts"
import type { RunDetailDto } from "../src/dashboard/types.ts"

describe("dashboard UI smoke", () => {
  it("run detail renders stage and job layout data", () => {
    const detail = sampleDetail()
    const markup = renderToStaticMarkup(<RunPipelineView detail={detail} selectedUnitId="unit:build" onSelectUnit={() => {}} />)

    expect(markup).toContain("Stage 1")
    expect(markup).toContain("Stage 2")
    expect(markup).toContain("build")
    expect(markup).toContain("data-testid=\"pipeline-deps\"")
  })

  it("run header renders project breadcrumb and actions", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <RunHeader detail={sampleDetail()} onCancel={() => {}} onRetry={() => {}} onGc={() => {}} />
      </MemoryRouter>,
    )

    expect(markup).toContain("Projects")
    expect(markup).toContain("project:dashboard")
    expect(markup).toContain("workflow:dashboard")
    expect(markup).toContain("Retry Run")
  })

  it("routing parses project, run, and job pages", () => {
    expect(parseDashboardRoute("/projects/project%3Ademo", "?view=bindings")).toEqual({
      _tag: "ProjectRoute",
      projectId: "project:demo",
      view: "bindings",
    })

    expect(parseDashboardRoute("/runs/run%3Ademo", "?view=timeline")).toEqual({
      _tag: "RunRoute",
      runId: "run:demo",
      view: "timeline",
    })

    expect(parseDashboardRoute("/runs/run%3Ademo/jobs/unit%3Atest", "?view=logs&attempt=2")).toEqual({
      _tag: "JobRoute",
      runId: "run:demo",
      unitId: "unit:test",
      view: "logs",
      attempt: 2,
    })
  })

  it("routing helpers build expected URLs", () => {
    expect(hrefForProject("project:demo", "secrets")).toBe("/projects/project%3Ademo?view=secrets")
    expect(hrefForRun("run:demo", "timeline")).toBe("/runs/run%3Ademo?view=timeline")
    expect(hrefForJob("run:demo", "unit:test", "artifacts", 3)).toBe(
      "/runs/run%3Ademo/jobs/unit%3Atest?view=artifacts&attempt=3",
    )
  })

  it("API client fetches log payload text", async () => {
    const api = createDashboardApi(async (input) => {
      expect(input).toBe("/api/logs/log%3Ademo")
      return new Response("hello from log\n", { status: 200 })
    })

    await expect(api.readLogPayload("log:demo")).resolves.toBe("hello from log\n")
  })

  it("API client uses projectId query for run lists", async () => {
    const api = createDashboardApi(async (input) => {
      expect(input).toBe("/api/runs?projectId=project%3Ademo")
      return Response.json([])
    })

    await expect(api.listRuns("project:demo")).resolves.toEqual([])
  })

  it("API client detects binary artifacts", async () => {
    const api = createDashboardApi(async (input) => {
      expect(input).toBe("/api/artifacts/artifact%3Ademo")
      return new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    })

    await expect(api.readArtifactPayload("artifact:demo")).resolves.toEqual({
      kind: "binary",
      contentType: "application/octet-stream",
    })
  })
})

const sampleDetail = (): RunDetailDto => ({
  run: {
    runId: "run:dashboard",
    projectId: "project:dashboard",
    planId: "plan:dashboard",
    workflowId: "workflow:dashboard",
    status: "succeeded",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:04.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:04.000Z",
    durationMs: 4000,
    progress: { totalUnits: 2, completedUnits: 2, failedUnits: 0, skippedUnits: 0 },
    controls: { canCancel: false, canRetry: true, canGc: true },
  },
  source: {
    projectId: "project:dashboard",
    planId: "plan:dashboard",
    workspacePath: "/repo/examples",
    triggers: [{ type: "ManualTriggerDeclaration", summary: "manual" }],
    metadata: [],
    diagnostics: [],
  },
  stages: [
    {
      id: "stage-1",
      label: "Stage 1",
      depth: 0,
      units: [
        {
          unitId: "unit:build",
          name: "build",
          status: "succeeded",
          dependencies: [],
          dependencyNames: [],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:02.000Z",
          durationMs: 2000,
          command: "bun test",
          image: "oven/bun:1",
          attempts: [],
          artifactCount: 1,
          logCount: 1,
        },
      ],
    },
    {
      id: "stage-2",
      label: "Stage 2",
      depth: 1,
      units: [
        {
          unitId: "unit:test",
          name: "test",
          status: "succeeded",
          dependencies: ["unit:build"],
          dependencyNames: ["build"],
          startedAt: "2026-01-01T00:00:02.500Z",
          finishedAt: "2026-01-01T00:00:04.000Z",
          durationMs: 1500,
          command: "bun test",
          image: "oven/bun:1",
          attempts: [],
          artifactCount: 0,
          logCount: 0,
        },
      ],
    },
  ],
  dependencies: [{ from: "unit:build", to: "unit:test" }],
  units: [
    {
      unitId: "unit:build",
      name: "build",
      status: "succeeded",
      dependencies: [],
      dependencyNames: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      durationMs: 2000,
      command: "bun test",
      image: "oven/bun:1",
      attempts: [],
      artifactCount: 1,
      logCount: 1,
    },
    {
      unitId: "unit:test",
      name: "test",
      status: "succeeded",
      dependencies: ["unit:build"],
      dependencyNames: ["build"],
      startedAt: "2026-01-01T00:00:02.500Z",
      finishedAt: "2026-01-01T00:00:04.000Z",
      durationMs: 1500,
      command: "bun test",
      image: "oven/bun:1",
      attempts: [],
      artifactCount: 0,
      logCount: 0,
    },
  ],
  artifacts: [{ ref: "artifact:dist", runId: "run:dashboard", unitId: "unit:build", name: "dist", category: "build-output", status: "available" }],
  logs: [{ ref: "log:stdout", runId: "run:dashboard", unitId: "unit:build", name: "stdout", status: "available" }],
  events: [],
})
