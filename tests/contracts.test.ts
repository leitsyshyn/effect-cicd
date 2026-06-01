import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { ArtifactMetadata, LogMetadata } from "../src/domain/artifacts.ts"
import {
  ArtifactRegistered,
  AttemptFailed,
  AttemptStarted,
  AttemptSucceeded,
  LogRegistered,
  RunCreated,
  RunFailed,
  RunInterrupted,
  RunStarted,
  RunSucceeded,
  UnitDispatched,
  UnitFailed,
  UnitReady,
  UnitSkipped,
  UnitSucceeded,
} from "../src/domain/events.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanDependency, PlanUnit } from "../src/domain/execution-plan.ts"
import { ArtifactRef, AttemptId, EventId, LogRef, PlanId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { FailureSummary } from "../src/domain/runtime-state.ts"
import {
  ArtifactDeclaration,
  ContainerCommandDeclaration,
  DependencyDeclaration,
  NamedDeclaration,
  NormalizedWorkflowDefinition,
  OutputDeclaration,
  UnitInputDeclaration,
  UnitDeclaration,
  WorkflowOutputDeclaration,
} from "../src/domain/workflow-definition.ts"
import { DslMaterializer } from "../src/dsl/index.ts"
import { Engine } from "../src/engine/interface.ts"
import { Executor } from "../src/engine/executor.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { Planner } from "../src/engine/planner.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"

describe("contract skeleton", () => {
  it("constructs branded IDs", () => {
    expect(WorkflowId.make("workflow:test")).toBe("workflow:test")
    expect(UnitId.make("unit:test")).toBe("unit:test")
    expect(PlanId.make("plan:test")).toBe("plan:test")
    expect(RunId.make("run:test")).toBe("run:test")
    expect(AttemptId.make("attempt:test")).toBe("attempt:test")
    expect(EventId.make("event:test")).toBe("event:test")
    expect(ArtifactRef.make("artifact:test")).toBe("artifact:test")
    expect(LogRef.make("log:test")).toBe("log:test")
  })

  it("constructs a minimal normalized workflow definition", () => {
    const workflow = minimalWorkflow()

    expect(workflow.workflowId).toBe(WorkflowId.make("workflow:minimal"))
    expect(workflow.units).toHaveLength(1)
    expect(workflow.dependencies).toHaveLength(0)
  })

  it("constructs a minimal execution plan", () => {
    const plan = minimalPlan()

    expect(plan.planId).toBe(PlanId.make("plan:minimal"))
    expect(plan.units).toHaveLength(1)
    expect(plan.dependencies).toHaveLength(0)
  })

  it("constructs event variants", () => {
    const runId = RunId.make("run:minimal")
    const unitId = UnitId.make("unit:build")
    const attemptId = AttemptId.make("attempt:build:1")
    const occurredAt = new Date(0)
    const failure = new FailureSummary({ message: "failed" })
    const artifact = new ArtifactMetadata({
      artifactRef: ArtifactRef.make("artifact:build"),
      runId,
      unitId,
      attemptId,
      name: "dist",
      category: "build-output",
      status: "available",
    })
    const log = new LogMetadata({
      logRef: LogRef.make("log:build"),
      runId,
      unitId,
      attemptId,
      name: "stdout",
      status: "available",
    })

    const base = { runId, occurredAt }
    const events = [
      new RunCreated({ ...base, eventId: EventId.make("event:1"), sequence: 1 }),
      new RunStarted({ ...base, eventId: EventId.make("event:2"), sequence: 2 }),
      new UnitReady({ ...base, eventId: EventId.make("event:3"), sequence: 3, unitId }),
      new UnitDispatched({ ...base, eventId: EventId.make("event:4"), sequence: 4, unitId, attemptId }),
      new AttemptStarted({
        ...base,
        eventId: EventId.make("event:5"),
        sequence: 5,
        unitId,
        attemptId,
        attemptNumber: 1,
      }),
      new AttemptSucceeded({ ...base, eventId: EventId.make("event:6"), sequence: 6, unitId, attemptId }),
      new AttemptFailed({ ...base, eventId: EventId.make("event:7"), sequence: 7, unitId, attemptId, failure }),
      new UnitSucceeded({ ...base, eventId: EventId.make("event:8"), sequence: 8, unitId }),
      new UnitFailed({ ...base, eventId: EventId.make("event:9"), sequence: 9, unitId, failure }),
      new UnitSkipped({ ...base, eventId: EventId.make("event:10"), sequence: 10, unitId, reason: "condition" }),
      new LogRegistered({ ...base, eventId: EventId.make("event:11"), sequence: 11, unitId, attemptId, log }),
      new ArtifactRegistered({
        ...base,
        eventId: EventId.make("event:12"),
        sequence: 12,
        unitId,
        attemptId,
        artifact,
      }),
      new RunSucceeded({ ...base, eventId: EventId.make("event:13"), sequence: 13 }),
      new RunFailed({ ...base, eventId: EventId.make("event:14"), sequence: 14, failure }),
      new RunInterrupted({ ...base, eventId: EventId.make("event:15"), sequence: 15, reason: "restart" }),
    ]

    expect(events.map((event) => event._tag)).toEqual([
      "RunCreated",
      "RunStarted",
      "UnitReady",
      "UnitDispatched",
      "AttemptStarted",
      "AttemptSucceeded",
      "AttemptFailed",
      "UnitSucceeded",
      "UnitFailed",
      "UnitSkipped",
      "LogRegistered",
      "ArtifactRegistered",
      "RunSucceeded",
      "RunFailed",
      "RunInterrupted",
    ])
  })

  it("references service tags in Effect code", () => {
    const program = Effect.gen(function* () {
      yield* DslMaterializer
      yield* Planner
      yield* Orchestrator
      yield* Executor
      yield* StateStore
      yield* EventLog
      yield* ArtifactStore
      yield* Engine
    })

    expect(program).toBeDefined()
  })
})

const emptyNamedDeclarations: ReadonlyArray<NamedDeclaration> = []
const emptyUnitInputDeclarations: ReadonlyArray<UnitInputDeclaration> = []
const emptyOutputDeclarations: ReadonlyArray<OutputDeclaration> = []
const emptyWorkflowOutputDeclarations: ReadonlyArray<WorkflowOutputDeclaration> = []

const minimalNamedDeclaration = (name: string) =>
  new NamedDeclaration({
    name,
    metadata: {},
  })

const minimalArtifactDeclaration = (name: string) =>
  new ArtifactDeclaration({
    name,
    kind: "file",
    path: `artifacts/${name}.txt`,
    contentType: "text/plain",
    metadata: {},
  })

const minimalWorkflow = () => {
  const unitId = UnitId.make("unit:build")

  return new NormalizedWorkflowDefinition({
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:minimal"),
    name: "minimal",
    metadata: {},
    units: [
      new UnitDeclaration({
        unitId,
        name: "build",
        payloadDeclaration: new ContainerCommandDeclaration({
          image: "alpine:latest",
          command: ["sh", "-c", "true"],
        }),
        metadata: {},
        inputs: emptyUnitInputDeclarations,
        outputs: emptyOutputDeclarations,
        artifacts: [minimalArtifactDeclaration("dist")],
        reports: [],
        policies: [],
      }),
    ],
    dependencies: [] satisfies ReadonlyArray<DependencyDeclaration>,
    inputs: emptyNamedDeclarations,
    outputs: emptyWorkflowOutputDeclarations,
    artifacts: [minimalArtifactDeclaration("dist")],
    reports: emptyNamedDeclarations,
  })
}

const minimalPlan = () => {
  const unitId = UnitId.make("unit:build")

  return new ExecutionPlan({
    planId: PlanId.make("plan:minimal"),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make("workflow:minimal"),
    workflowName: "minimal",
    metadata: {},
    inputs: emptyNamedDeclarations,
    outputs: emptyWorkflowOutputDeclarations,
    units: [
      new PlanUnit({
        unitId,
        name: "build",
        dependencies: [],
        payloadDescriptor: new ContainerCommandDescriptor({
          image: "alpine:latest",
          command: ["sh", "-c", "true"],
          env: {},
        }),
        inputs: emptyUnitInputDeclarations,
        outputs: emptyOutputDeclarations,
        reports: [],
        logExpectations: [minimalNamedDeclaration("stdout")],
        artifactExpectations: [minimalArtifactDeclaration("dist")],
        policies: [],
        diagnostics: [],
      }),
    ],
    dependencies: [] satisfies ReadonlyArray<PlanDependency>,
    diagnostics: [],
  })
}
