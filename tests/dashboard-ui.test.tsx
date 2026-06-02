import { describe, expect, it } from "@effect/vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { createDashboardApi } from "../src/dashboard/api.ts"
import { RunHeader } from "../src/dashboard/components/run-header.tsx"
import { RunPipelineView } from "../src/dashboard/components/run-pipeline.tsx"
import type { RunDetailDto } from "../src/dashboard/types.ts"

describe("dashboard UI smoke", () => {
  it("run detail renders stage and job layout data", () => {
    const detail = sampleDetail()
    const markup = renderToStaticMarkup(<RunPipelineView detail={detail} selectedUnitId="unit:build" onSelectUnit={() => {}} />)

    expect(markup).toContain("Stage 1")
    expect(markup).toContain("Stage 2")
    expect(markup).toContain("unit:build")
    expect(markup).toContain("data-testid=\"pipeline-deps\"")
  })

  it("run header renders workflow and payload summaries", () => {
    const markup = renderToStaticMarkup(<RunHeader detail={sampleDetail()} onCancel={() => {}} onRetry={() => {}} onGc={() => {}} />)

    expect(markup).toContain("Runs")
    expect(markup).toContain("workflow:dashboard")
    expect(markup).toContain("Retry Run")
  })

  it("API client fetches log payload text", async () => {
    const api = createDashboardApi(async (input) => {
      expect(input).toBe("/api/logs/log%3Ademo")
      return new Response("hello from log\n", { status: 200 })
    })

    await expect(api.readLogPayload("log:demo")).resolves.toBe("hello from log\n")
  })

  it("API client posts retry action", async () => {
    const api = createDashboardApi(async (input, init) => {
      expect(input).toBe("/api/runs/run%3Ademo/retry")
      expect(init?.method).toBe("POST")
      return Response.json({ runId: "run:next", projectId: "project:demo", planId: "plan:demo", workflowId: "workflow:demo", status: "queued", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", progress: { totalUnits: 2, completedUnits: 0, failedUnits: 0, skippedUnits: 0 }, controls: { canCancel: true, canRetry: false, canGc: false } })
    })

    await expect(api.retryRun("run:demo", "Retried from test")).resolves.toMatchObject({ runId: "run:next" })
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
