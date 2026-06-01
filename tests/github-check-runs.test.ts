import { describe, expect, it } from "@effect/vitest"
import { createHmac } from "node:crypto"

import { AttemptId, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanUnit } from "../src/domain/execution-plan.ts"
import {
  ExecutionAttemptState,
  ExecutionUnitState,
  FailureSummary,
  ProgressSummary,
  RunExecutionContext,
  RunExecutionOptions,
  WorkflowRunState,
} from "../src/domain/runtime-state.ts"
import { toGitHubCheckLifecycle } from "../src/github/check-runs.ts"
import { verifyWebhookSignature } from "../src/github/integration.ts"

describe("GitHub checks lifecycle", () => {
  it("verifies webhook signatures", () => {
    const body = JSON.stringify({ hello: "world" })
    const signature = `sha256=${createHmac("sha256", "top-secret").update(body).digest("hex")}`

    expect(verifyWebhookSignature(body, signature, "top-secret")).toBe(true)
  })

  it("maps completed workflow outcomes to GitHub conclusions", () => {
    expect(toGitHubCheckLifecycle(sampleRun("succeeded")).conclusion).toBe("success")
    expect(toGitHubCheckLifecycle(sampleRun("failed")).conclusion).toBe("failure")
    expect(toGitHubCheckLifecycle(sampleRun("canceled")).conclusion).toBe("cancelled")
    expect(toGitHubCheckLifecycle(sampleRun("interrupted")).conclusion).toBe("neutral")
  })
})

const sampleRun = (status: WorkflowRunState["status"]) =>
  new WorkflowRunState({
    runId: RunId.make(`run:${status}`),
    workflowId: WorkflowId.make("workflow:github:test"),
    planId: PlanId.make("plan:github:test"),
    execution: new RunExecutionContext({
      plan: new ExecutionPlan({
        planId: PlanId.make("plan:github:test"),
        schemaVersion: "0.1.0",
        workflowId: WorkflowId.make("workflow:github:test"),
        workflowName: "github test",
        metadata: {},
        units: [
          new PlanUnit({
            unitId: UnitId.make("unit:build"),
            name: "build",
            dependencies: [],
            payloadDescriptor: new ContainerCommandDescriptor({ image: "alpine", command: ["true"], env: {} }),
            logExpectations: [],
            artifactExpectations: [],
            policies: [],
            diagnostics: [],
          }),
        ],
        dependencies: [],
        diagnostics: [],
      }),
      options: new RunExecutionOptions({}),
      submittedAt: new Date(0),
    }),
    status,
    units: [
      new ExecutionUnitState({
        runId: RunId.make(`run:${status}`),
        unitId: UnitId.make("unit:build"),
        status: status === "failed" ? "failed" : "succeeded",
        dependencies: [],
        attempts: [
          new ExecutionAttemptState({
            attemptId: AttemptId.make("attempt:build:1"),
            runId: RunId.make(`run:${status}`),
            unitId: UnitId.make("unit:build"),
            attemptNumber: 1,
            status: status === "failed" ? "failed" : "succeeded",
            failure: status === "failed" ? new FailureSummary({ message: "build failed" }) : undefined,
            artifacts: [],
            logs: [],
          }),
        ],
        failure: status === "failed" ? new FailureSummary({ message: "build failed" }) : undefined,
        artifacts: [],
        logs: [],
      }),
    ],
    progress: new ProgressSummary({ totalUnits: 1, completedUnits: 1, failedUnits: status === "failed" ? 1 : 0, skippedUnits: 0 }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: new Date(0),
    failure: status === "failed" ? new FailureSummary({ message: "build failed" }) : undefined,
    artifacts: [],
    logs: [],
  })
