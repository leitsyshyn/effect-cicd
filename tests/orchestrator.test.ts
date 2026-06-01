import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../src/domain/artifacts.ts"
import { ContainerCommandDescriptor, ExecutionPlan, PlanCancellationPolicy, PlanDependency, PlanRetryPolicy, PlanTimeoutPolicy, PlanUnit } from "../src/domain/execution-plan.ts"
import { ArtifactRef, AttemptId, EventId, LogRef, PlanId, ProjectId, RunId, UnitId, WorkflowId } from "../src/domain/ids.ts"
import { ProducedReport } from "../src/domain/reports.ts"
import { RunCreated } from "../src/domain/events.ts"
import { FailureSummary, ProgressSummary, RunExecutionContext, RunExecutionOptions, WorkflowRunState, ExecutionUnitState, ExecutionAttemptState } from "../src/domain/runtime-state.ts"
import {
  ArtifactDeclaration,
  TriggerBranchConditionDeclaration,
  NamedDeclaration,
  OutputDeclaration,
  ReportDeclaration,
  UnitInputDeclaration,
  UnitOutputSourceDeclaration,
  UpstreamStatusConditionDeclaration,
  WorkflowInputSourceDeclaration,
  WorkflowOutputDeclaration,
} from "../src/domain/workflow-definition.ts"
import { RunController } from "../src/engine/run-controller.ts"
import { SchedulerConfig } from "../src/runtime/config.ts"
import { DispatchRequest, Executor, ExecutorResult, type TestExecutorLayerOptions } from "../src/engine/executor.ts"
import { ExecutorFailureSummary } from "../src/engine/executor.ts"
import { Orchestrator } from "../src/engine/orchestrator.ts"
import { RunUpdates } from "../src/engine/run-updates.ts"
import { ArtifactStore } from "../src/engine/stores/artifact-store.ts"
import { EventLog } from "../src/engine/stores/event-log.ts"
import { StateStore } from "../src/engine/stores/state-store.ts"
import { StorageTransactor } from "../src/runtime/storage.ts"
import { SecretRef } from "../src/domain/secrets.ts"
import { SecretStore } from "../src/secrets/store.ts"

describe("Orchestrator", () => {
  it.effect("single-unit successful plan creates a succeeded run", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const run = yield* orchestrator.startRun(plan("workflow:single", [planUnit("unit:build")]))

      expect(run.runId.startsWith("run:plan:workflow:single:")).toBe(true)
      expect(run.status).toBe("succeeded")
      expect(run.progress).toEqual(
        new ProgressSummary({
          totalUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
          skippedUnits: 0,
        }),
      )
      expect(run.units[0]?.status).toBe("succeeded")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("two sequential units execute in dependency order", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator

        yield* orchestrator.startRun(
          plan(
            "workflow:sequence",
            [planUnit("unit:build"), planUnit("unit:test", ["unit:build"])],
            [planDependency("unit:build", "unit:test")],
          ),
        )

        expect(requests.map((request) => request.unitId)).toEqual([UnitId.make("unit:build"), UnitId.make("unit:test")])
      }).pipe(Effect.provide(runtimeLayer({ requests })))
    },
  )

  it.effect("failure in an upstream unit fails the run and skips downstream units", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const run = yield* orchestrator.startRun(
          plan(
            "workflow:failure",
            [planUnit("unit:build"), planUnit("unit:test", ["unit:build"])],
            [planDependency("unit:build", "unit:test")],
          ),
        )

        expect(run.status).toBe("failed")
        expect(run.units.find((unit) => unit.unitId === UnitId.make("unit:build"))?.status).toBe("failed")
        expect(run.units.find((unit) => unit.unitId === UnitId.make("unit:test"))?.status).toBe("skipped")
        expect(requests).toHaveLength(1)
        expect(requests[0]?.unitId).toBe(UnitId.make("unit:build"))
      }).pipe(
        Effect.provide(
          runtimeLayer({
            requests,
            resultsByUnitId: {
              "unit:build": {
                outcome: "failed",
              },
            },
          }),
        ),
      )
    },
  )

  it.effect("orchestrator calls Executor through Executor.execute", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator

        yield* orchestrator.startRun(plan("workflow:boundary", [planUnit("unit:build")]))

        expect(requests).toHaveLength(1)
        expect(requests[0]?.runId.startsWith("run:plan:workflow:boundary:")).toBe(true)
        expect(requests[0]?.unitId).toBe(UnitId.make("unit:build"))
        expect(requests[0]?.attemptId).toBe(AttemptId.make(`attempt:${requests[0]!.runId}:unit:build:1`))
        expect(requests[0]?.attemptNumber).toBe(1)
        expect(requests[0]?.artifacts.map((artifact) => artifact.name)).toEqual(["dist"])
        expect(requests[0]?.logNames).toEqual(["stdout"])
        expect(requests[0]?.correlation.planId).toBe("plan:workflow:boundary")
        expect(requests[0]?.payloadDescriptor).toBeInstanceOf(ContainerCommandDescriptor)
      }).pipe(Effect.provide(runtimeLayer({ requests })))
    },
  )

  it.effect("secret-backed env values resolve only for dispatch", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const secretStore = yield* SecretStore

        yield* secretStore.setSecret("workflow:secret-env", "NPM_TOKEN", "top-secret-token")
        const run = yield* orchestrator.startRun(
          plan("workflow:secret-env", [planUnit("unit:build", [], { NPM_TOKEN: new SecretRef({ key: "NPM_TOKEN" }) })]),
        )

        expect(run.status).toBe("succeeded")
        expect(requests[0]?.env).toEqual({ NPM_TOKEN: "top-secret-token" })
        expect(requests[0]?.secretEnvNames).toEqual(["NPM_TOKEN"])
        expect(run.execution.plan.units[0]?.payloadDescriptor.env).toEqual({ NPM_TOKEN: new SecretRef({ key: "NPM_TOKEN" }) })
      }).pipe(Effect.provide(runtimeLayer({ requests })))
    },
  )

  it.effect("runtime secret resolution uses project metadata scope when present", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const secretStore = yield* SecretStore

        yield* secretStore.setSecret("project:alpha", "NPM_TOKEN", "alpha-token")
        yield* secretStore.setSecret("project:beta", "NPM_TOKEN", "beta-token")

        const run = yield* orchestrator.startRun(
          plan(
            "workflow:project-beta",
            [planUnit("unit:build", [], { NPM_TOKEN: new SecretRef({ key: "NPM_TOKEN" }) })],
            [],
            { projectId: "project:beta" },
          ),
        )

        expect(run.status).toBe("succeeded")
        expect(requests[0]?.env).toEqual({ NPM_TOKEN: "beta-token" })
      }).pipe(Effect.provide(runtimeLayer({ requests })))
    },
  )

  it.effect("missing secrets fail the run cleanly without persisting secret values", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const run = yield* orchestrator.startRun(
        plan("workflow:missing-secret", [planUnit("unit:build", [], { NPM_TOKEN: new SecretRef({ key: "NPM_TOKEN" }) })]),
      )
      const events = yield* eventLog.readRunEvents(run.runId)

      expect(run.status).toBe("failed")
      expect(run.failure?.message).toContain("Secret workflow:missing-secret:NPM_TOKEN not found")
      expect(JSON.stringify(run)).not.toContain("top-secret-token")
      expect(JSON.stringify(events)).not.toContain("top-secret-token")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("persisted logs redact injected secret values", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const secretStore = yield* SecretStore
      const artifactStore = yield* ArtifactStore

      yield* secretStore.setSecret("workflow:redaction", "NPM_TOKEN", "top-secret-token")
      const run = yield* orchestrator.startRun(
        plan("workflow:redaction", [planUnit("unit:build", [], { NPM_TOKEN: new SecretRef({ key: "NPM_TOKEN" }) })]),
      )
      const payload = yield* artifactStore.readLogPayload(LogRef.make(`log:attempt:${run.runId}:unit:build:1:stdout`))

      expect(payload).toContain("[REDACTED]")
      expect(payload).not.toContain("top-secret-token")
    }).pipe(
      Effect.provide(
        runtimeLayer({
          resultsByUnitId: {
            "unit:build": {
              logs: [
                new RegisteredLog({
                  metadata: new LogMetadata({
                    logRef: LogRef.make("log:redaction"),
                    runId: RunId.make("run:redaction"),
                    unitId: UnitId.make("unit:build"),
                    attemptId: AttemptId.make("attempt:redaction"),
                    name: "stdout",
                    status: "available",
                    summary: "printed top-secret-token",
                  }),
                  content: "printed top-secret-token\n",
                }),
              ],
            },
          },
        }),
      ),
    ),
  )

  it.effect("StateStore contains current run, unit, and attempt state after execution", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const stateStore = yield* StateStore

      const run = yield* orchestrator.startRun(plan("workflow:state", [planUnit("unit:build")]))
      const storedRun = yield* stateStore.getRun(run.runId)
      const storedUnit = yield* stateStore.getUnit(run.runId, UnitId.make("unit:build"))

      expect(storedRun.status).toBe("succeeded")
      expect(storedUnit.status).toBe("succeeded")
      expect(storedUnit.latestAttemptId).toBe(AttemptId.make(`attempt:${run.runId}:unit:build:1`))
      expect(storedUnit.attempts[0]?.status).toBe("succeeded")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("EventLog contains the expected milestone event order for a successful run", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const run = yield* orchestrator.startRun(plan("workflow:events", [planUnit("unit:build")]))
      const events = yield* eventLog.readRunEvents(run.runId)

      expect(events.map((event) => event._tag)).toEqual([
        "RunCreated",
        "RunStarted",
        "UnitReady",
        "UnitDispatched",
        "AttemptStarted",
        "LogRegistered",
        "ArtifactRegistered",
        "AttemptSucceeded",
        "UnitSucceeded",
        "RunSucceeded",
      ])
    }).pipe(Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:events", "unit:build") } }))),
  )

  it.effect("ArtifactStore registers returned logs and artifacts metadata", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const artifactStore = yield* ArtifactStore

      const run = yield* orchestrator.startRun(plan("workflow:artifacts", [planUnit("unit:build")]))
      const storedArtifact = yield* artifactStore.readArtifact(
        ArtifactRef.make(`artifact:attempt:${run.runId}:unit:build:1:dist`),
      )
      const storedLog = yield* artifactStore.readLog(LogRef.make(`log:attempt:${run.runId}:unit:build:1:stdout`))

      expect(storedArtifact.runId).toBe(run.runId)
      expect(storedArtifact.name).toBe("dist")
      expect(storedLog.runId).toBe(run.runId)
      expect(storedLog.name).toBe("stdout")
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": successPayloads("workflow:artifacts", "unit:build") } })),
    ),
  )

  it.effect("inspectRun returns current state from StateStore", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const started = yield* orchestrator.startRun(plan("workflow:inspect", [planUnit("unit:build")]))
      const inspected = yield* orchestrator.inspectRun(started.runId)

      expect(inspected).toEqual(started)
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("advanceRun is a no-op for terminal runs", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog
      const started = yield* orchestrator.startRun(plan("workflow:advance", [planUnit("unit:build")]))
      const before = yield* eventLog.readRunEvents(started.runId)
      const advanced = yield* orchestrator.advanceRun(started.runId)
      const after = yield* eventLog.readRunEvents(started.runId)

      expect(advanced).toEqual(started)
      expect(after).toEqual(before)
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("resumeIncompleteRuns resumes incomplete runs from persisted state without replay", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const stateStore = yield* StateStore
      const eventLog = yield* EventLog

      const seededRun = interruptedSeedRun("workflow:resume")
      yield* stateStore.createRun(seededRun)
      yield* eventLog.append(
        new RunCreated({
          eventId: EventId.make("event:seed:0"),
          runId: seededRun.runId,
          occurredAt: new Date(0),
          sequence: 0,
        }),
      )

      const resumed = yield* orchestrator.resumeIncompleteRuns()
      const stored = yield* stateStore.getRun(seededRun.runId)
      const events = yield* eventLog.readRunEvents(seededRun.runId)

      expect(resumed).toHaveLength(1)
      expect(stored.status).toBe("succeeded")
      expect(stored.units.find((unit) => unit.unitId === UnitId.make("unit:build"))?.attempts[0]?.status).toBe("interrupted")
      expect(stored.units.find((unit) => unit.unitId === UnitId.make("unit:build"))?.status).toBe("succeeded")
      expect(stored.units.find((unit) => unit.unitId === UnitId.make("unit:lint"))?.status).toBe("succeeded")
      expect(stored.units.find((unit) => unit.unitId === UnitId.make("unit:test"))?.status).toBe("succeeded")
      expect(stored.units[0]?.attempts[0]?.status).toBe("interrupted")
      expect(events.map((event) => event._tag)).toContain("RunResumed")
      expect(events.map((event) => event._tag)).toContain("RunSucceeded")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("resumeIncompleteRuns restores scheduled retries after restart", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const stateStore = yield* StateStore

      const seededRun = scheduledRetrySeedRun("workflow:resume-retry")
      yield* stateStore.createRun(seededRun)

      const resumed = yield* orchestrator.resumeIncompleteRuns()
      const resumedRun = resumed[0]

      expect(resumedRun?.status).toBe("running")
      expect(resumedRun?.units[0]?.nextRetryAt).toBeInstanceOf(Date)

      yield* TestClock.adjust("1 second")

      const stored = yield* stateStore.getRun(seededRun.runId)
      expect(stored.status).toBe("succeeded")
      expect(stored.units[0]?.status).toBe("succeeded")
      expect(stored.units[0]?.nextRetryAt).toBeUndefined()
      expect(stored.units[0]?.attempts).toHaveLength(2)
    }).pipe(
      Effect.provide(
        runtimeLayer({
          resultsByUnitId: {
            "unit:build": {
              outcome: "succeeded",
            },
          },
        }),
      ),
    ),
  )

  it.effect("workflow inputs, upstream outputs, workflow outputs, and reports are persisted without mutating the plan", () => {
    const requests = new Array<DispatchRequest>()

    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      const run = yield* orchestrator.startRun(
        plan(
          "workflow:dataflow",
          [
            planUnit("unit:build", [], {}, {
              inputs: [workflowInputRef("release", "release")],
              outputs: [output("digest", "outputs/digest.json")],
              reports: [report("summary", "reports/summary.txt")],
            }),
            planUnit("unit:deploy", ["unit:build"], {}, {
              inputs: [workflowInputRef("release", "release"), unitOutputRef("digest", "unit:build", "digest")],
            }),
          ],
          [planDependency("unit:build", "unit:deploy")],
          {},
          [named("release")],
          [workflowOutput("release", "release"), workflowUnitOutput("digest", "unit:build", "digest")],
        ),
        { inputValues: { release: "1.2.3" } },
      )

      expect(requests[0]?.inputs.map((input) => ({ name: input.name, value: input.value }))).toEqual([
        { name: "release", value: "1.2.3" },
      ])
      expect(requests[1]?.inputs.map((input) => ({ name: input.name, value: input.value }))).toEqual([
        { name: "release", value: "1.2.3" },
        { name: "digest", value: { sha: "abc123" } },
      ])
      expect(run.units.find((unit) => unit.unitId === UnitId.make("unit:build"))?.outputs?.map((value) => value.name)).toEqual(["digest"])
      expect(run.outputs?.map((value) => `${value.name}=${JSON.stringify(value.value)}`)).toEqual([
        'release="1.2.3"',
        'digest={"sha":"abc123"}',
      ])
      expect(run.reports?.map((value) => value.name)).toEqual(["summary"])
      expect(run.units.map((unit) => unit.unitId)).toEqual([UnitId.make("unit:build"), UnitId.make("unit:deploy")])
      expect(run.units).toHaveLength(2)
    }).pipe(
      Effect.provide(
        runtimeLayer({
          requests,
          resultsByUnitId: {
            "unit:build": {
              outputs: { digest: { sha: "abc123" } },
              reports: [reportPayload("workflow:dataflow", "unit:build", "summary")],
            },
          },
        }),
      ),
    )
  })

  it.effect("timed out units produce timed_out state and timeline events", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const fiber = yield* orchestrator
        .startRun(plan("workflow:timeout", [planUnit("unit:slow", [], {}, { policies: [new PlanTimeoutPolicy({ seconds: 1 })] })]))
        .pipe(Effect.forkChild)

      yield* TestClock.adjust("2 seconds")

      const run = yield* Fiber.join(fiber)
      const events = yield* eventLog.readRunEvents(run.runId)

      expect(run.status).toBe("timed_out")
      expect(run.units[0]?.status).toBe("timed_out")
      expect(run.failure?.code).toBe("timeout")
      expect(events.map((event) => event._tag)).toContain("AttemptTimedOut")
      expect(events.map((event) => event._tag)).toContain("UnitTimedOut")
      expect(events.map((event) => event._tag)).toContain("RunTimedOut")
    }).pipe(
      Effect.provide(
        runtimeLayer({
          resultsByUnitId: {
            "unit:slow": {
              execute: (request) =>
                Effect.sleep("5 seconds").pipe(
                  Effect.as(
                    new ExecutorResult({
                      runId: request.runId,
                      unitId: request.unitId,
                      attemptId: request.attemptId,
                      attemptNumber: request.attemptNumber,
                      outcome: "succeeded",
                      exitCode: 0,
                      outputs: {},
                      reports: [],
                      artifacts: [],
                      logs: [],
                      diagnostics: [],
                    }),
                  ),
                ),
            },
          },
        }),
      ),
    ),
  )

  it.effect("unit retry policy schedules a retry and eventually succeeds", () =>
    {
      let attempts = 0

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const eventLog = yield* EventLog

        const started = yield* orchestrator.startRun(
          plan("workflow:retry-success", [planUnit("unit:build", [], {}, { policies: [retryPolicy(2)] })]),
        )

        expect(started.status).toBe("running")
        expect(started.units[0]?.nextRetryAt).toBeInstanceOf(Date)

        yield* TestClock.adjust("1 second")

        const finalRun = yield* orchestrator.inspectRun(started.runId)
        const events = yield* eventLog.readRunEvents(started.runId)

        expect(attempts).toBe(2)
        expect(finalRun.status).toBe("succeeded")
        expect(finalRun.units[0]?.status).toBe("succeeded")
        expect(finalRun.units[0]?.nextRetryAt).toBeUndefined()
        expect(events.map((event) => event._tag)).toContain("RetryScheduled")
      }).pipe(
        Effect.provide(
          runtimeLayer({
            resultsByUnitId: {
              "unit:build": {
                execute: (request) =>
                  Effect.sync(() => {
                    attempts += 1

                    return new ExecutorResult({
                      runId: request.runId,
                      unitId: request.unitId,
                      attemptId: request.attemptId,
                      attemptNumber: request.attemptNumber,
                      outcome: attempts === 1 ? "failed" : "succeeded",
                      exitCode: attempts === 1 ? 1 : 0,
                      failure: attempts === 1 ? new ExecutorFailureSummary({ message: "transient failure" }) : undefined,
                      outputs: {},
                      reports: [],
                      artifacts: [],
                      logs: [],
                      diagnostics: [],
                    })
                  }),
              },
            },
          }),
        ),
      )
    },
  )

  it.effect("retry backoff delay increases between attempts", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const started = yield* orchestrator.startRun(
        plan("workflow:retry-backoff", [planUnit("unit:build", [], {}, { policies: [retryPolicy(3)] })]),
      )

      yield* TestClock.adjust("3 seconds")

      const events = yield* eventLog.readRunEvents(started.runId)
      const retries = events.filter((event) => event._tag === "RetryScheduled")

      expect(retries).toHaveLength(2)
      expect((retries[0] as any)?.delayMillis).toBe(1000)
      expect((retries[1] as any)?.delayMillis).toBe(2000)
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" } } })),
    ),
  )

  it.effect("retry jitter stays within the expected range", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog
      const delays = new Array<number>()

      for (let index = 0; index < 5; index += 1) {
        const run = yield* orchestrator.startRun(
          plan(`workflow:retry-jitter:${index}`, [planUnit("unit:build", [], {}, { policies: [retryPolicy(2, { jitter: "full" })] })]),
        )
        const events = yield* eventLog.readRunEvents(run.runId)
        const retryEvent = events.find((event) => event._tag === "RetryScheduled") as any
        delays.push(retryEvent.delayMillis)
      }

      expect(delays.every((delay) => delay >= 0 && delay <= 1000)).toBe(true)
      expect(new Set(delays).size).toBeGreaterThan(1)
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" } } })),
    ),
  )

  it.effect("retry backoff respects max delay caps", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const started = yield* orchestrator.startRun(
        plan("workflow:retry-cap", [planUnit("unit:build", [], {}, { policies: [retryPolicy(4, { exponent: 3, maxDelayMillis: 5000 })] })]),
      )

      yield* TestClock.adjust("10 seconds")

      const events = yield* eventLog.readRunEvents(started.runId)
      const retries = events.filter((event) => event._tag === "RetryScheduled") as Array<any>

      expect(retries.map((event) => event.delayMillis)).toEqual([1000, 3000, 5000])
    }).pipe(
      Effect.provide(runtimeLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" } } })),
    ),
  )

  it.effect("maxAttempts of one or no retry policy does not schedule retries", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const withPolicy = yield* orchestrator.startRun(
        plan("workflow:no-retry-policy", [planUnit("unit:build", [], {}, { policies: [retryPolicy(1)] })]),
      )
      const withoutPolicy = yield* orchestrator.startRun(plan("workflow:no-retry-default", [planUnit("unit:test")]))

      const withPolicyEvents = yield* eventLog.readRunEvents(withPolicy.runId)
      const withoutPolicyEvents = yield* eventLog.readRunEvents(withoutPolicy.runId)

      expect(withPolicy.status).toBe("failed")
      expect(withoutPolicy.status).toBe("failed")
      expect(withPolicyEvents.map((event) => event._tag)).not.toContain("RetryScheduled")
      expect(withoutPolicyEvents.map((event) => event._tag)).not.toContain("RetryScheduled")
    }).pipe(
      Effect.provide(
        runtimeLayer({ resultsByUnitId: { "unit:build": { outcome: "failed" }, "unit:test": { outcome: "failed" } } }),
      ),
    ),
  )

  it.effect("false trigger conditions skip units visibly and still succeed the run", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventLog = yield* EventLog

      const run = yield* orchestrator.startRun(
        plan("workflow:conditional-skip", [planUnit("unit:build", [], {}, { conditions: [new TriggerBranchConditionDeclaration({ branch: "main" })] })]),
      )
      const events = yield* eventLog.readRunEvents(run.runId)

      expect(run.status).toBe("succeeded")
      expect(run.units[0]?.status).toBe("skipped")
      expect(run.units[0]?.skipReason).toContain("branch is not main")
      expect(events.map((event) => event._tag)).toContain("UnitSkipped")
      expect(events.map((event) => event._tag)).toContain("RunSucceeded")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("upstream status conditions can run follow-up units after failure", () =>
    {
      const requests = new Array<DispatchRequest>()

      return Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const run = yield* orchestrator.startRun(
          plan(
            "workflow:on-failure",
            [
              planUnit("unit:build"),
              planUnit("unit:notify", ["unit:build"], {}, {
                conditions: [new UpstreamStatusConditionDeclaration({ unitId: UnitId.make("unit:build"), status: "failed" })],
              }),
            ],
            [planDependency("unit:build", "unit:notify")],
          ),
        )

        expect(run.status).toBe("failed")
        expect(run.units.find((unit) => unit.unitId === UnitId.make("unit:build"))?.status).toBe("failed")
        expect(run.units.find((unit) => unit.unitId === UnitId.make("unit:notify"))?.status).toBe("succeeded")
        expect(requests.map((request) => request.unitId)).toEqual([UnitId.make("unit:build"), UnitId.make("unit:notify")])
      }).pipe(
        Effect.provide(
          runtimeLayer({
            requests,
            resultsByUnitId: {
              "unit:build": { outcome: "failed" },
            },
          }),
        ),
      )
    },
  )
})

describe("RunController", () => {
  it.effect("retryRun preserves inputValues from the original run", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const runController = yield* RunController

      const testPlan = plan(
        "workflow:retry-inputs",
        [planUnit("unit:build")],
        [],
        {},
        [named("version")],
      )

      const original = yield* orchestrator.startRun(testPlan, { inputValues: { version: "1.0.0" } })
      expect(original.status).toBe("succeeded")
      expect(original.execution.options.inputValues).toEqual({ version: "1.0.0" })

      const retried = yield* runController.retryRun(original.runId)
      expect(retried.execution.options.inputValues).toEqual({ version: "1.0.0" })
    }).pipe(
      Effect.provide(
        RunController.layer.pipe(
          Layer.provideMerge(runtimeLayer()),
          Layer.provideMerge(Layer.succeed(SchedulerConfig, { maxConcurrentRuns: 10, maxConcurrentRunsPerProject: 5 })),
        ),
      ),
    ),
  )
})

describe("CancellationPolicy", () => {
  it.effect("best-effort cancellation sets status to canceling not canceled", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      const run = yield* orchestrator.createRun(
        plan("workflow:cancel-best-effort", [planUnit("unit:build")]),
      )
      expect(run.status).toBe("queued")

      const canceled = yield* orchestrator.cancelRun(run.runId)

      expect(canceled.status).toBe("canceling")
      expect(canceled.units[0]?.status).toBe("pending")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("fail-fast cancellation immediately sets status to canceled", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      const run = yield* orchestrator.createRun(
        plan("workflow:cancel-fail-fast", [planUnit("unit:build", [], {}, { policies: [new PlanCancellationPolicy({ mode: "fail-fast" })] })]),
      )
      expect(run.status).toBe("queued")

      const canceled = yield* orchestrator.cancelRun(run.runId)

      expect(canceled.status).toBe("canceled")
      expect(canceled.units[0]?.status).toBe("canceled")
    }).pipe(Effect.provide(runtimeLayer())),
  )

  it.effect("fail-fast cancellation transitions all pending units to canceled", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      const run = yield* orchestrator.createRun(
        plan(
          "workflow:cancel-fail-fast-all",
          [
            planUnit("unit:build", [], {}, { policies: [new PlanCancellationPolicy({ mode: "fail-fast" })] }),
            planUnit("unit:test", ["unit:build"]),
          ],
          [planDependency("unit:build", "unit:test")],
        ),
      )
      expect(run.status).toBe("queued")

      const canceled = yield* orchestrator.cancelRun(run.runId)

      expect(canceled.status).toBe("canceled")
      expect(canceled.units[0]?.status).toBe("canceled")
      expect(canceled.units[1]?.status).toBe("canceled")
    }).pipe(Effect.provide(runtimeLayer())),
  )
})

const runtimeLayer = (options: TestExecutorLayerOptions = {}) =>
  Orchestrator.layer.pipe(
    Layer.provideMerge(StorageTransactor.memoryLayer),
    Layer.provideMerge(StateStore.memoryLayer),
    Layer.provideMerge(EventLog.memoryLayer),
    Layer.provideMerge(ArtifactStore.memoryLayer),
    Layer.provideMerge(SecretStore.memoryLayer),
    Layer.provideMerge(Executor.testLayer(options)),
    Layer.provideMerge(RunUpdates.noopLayer),
  )

const plan = (
  workflowId: string,
  units: ReadonlyArray<PlanUnit>,
  dependencies: ReadonlyArray<PlanDependency> = [],
  metadata: Record<string, unknown> = {},
  inputs: ReadonlyArray<NamedDeclaration> = [],
  outputs: ReadonlyArray<WorkflowOutputDeclaration> = [],
) =>
  new ExecutionPlan({
    planId: PlanId.make(`plan:${workflowId}`),
    schemaVersion: "0.1.0",
    workflowId: WorkflowId.make(workflowId),
    workflowName: workflowId.replace("workflow:", ""),
    metadata,
    triggers: [],
    inputs,
    outputs,
    units,
    dependencies,
    diagnostics: [],
  })

const planUnit = (
  unitId: string,
  dependencies: ReadonlyArray<string> = [],
  env: Record<string, string | SecretRef> = {},
  overrides: Partial<ConstructorParameters<typeof PlanUnit>[0]> = {},
) =>
  new PlanUnit({
    unitId: UnitId.make(unitId),
    name: unitId.replace("unit:", ""),
    dependencies: dependencies.map((dependency) => UnitId.make(dependency)),
    payloadDescriptor: new ContainerCommandDescriptor({
      image: "oven/bun:latest",
      command: ["bun", "test"],
      env,
    }),
    inputs: [],
    outputs: [],
    reports: [],
    logExpectations: [named("stdout")],
    artifactExpectations: [artifact("dist")],
    conditions: [],
    policies: [],
    diagnostics: [],
    ...overrides,
  })

const planDependency = (from: string, to: string) =>
  new PlanDependency({
    from: UnitId.make(from),
    to: UnitId.make(to),
  })

const retryPolicy = (maxAttempts: number, overrides: Partial<ConstructorParameters<typeof PlanRetryPolicy>[0]> = {}) =>
  new PlanRetryPolicy({
    maxAttempts,
    exponent: 2,
    baseDelayMillis: 1000,
    maxDelayMillis: 60_000,
    jitter: "none",
    ...overrides,
  })

const named = (name: string) =>
  new NamedDeclaration({
    name,
    metadata: {},
  })

const artifact = (name: string) =>
  new ArtifactDeclaration({
    name,
    kind: "file",
    path: `artifacts/${name}.txt`,
    contentType: "text/plain",
    metadata: {},
  })

const output = (name: string, path: string) =>
  new OutputDeclaration({
    name,
    path,
    format: "json",
    metadata: {},
  })

const report = (name: string, path: string) =>
  new ReportDeclaration({
    name,
    path,
    format: "text",
    contentType: "text/plain",
    metadata: {},
  })

const workflowInputRef = (name: string, inputName: string) =>
  new UnitInputDeclaration({
    name,
    from: new WorkflowInputSourceDeclaration({ inputName }),
    metadata: {},
  })

const unitOutputRef = (name: string, unitId: string, outputName: string) =>
  new UnitInputDeclaration({
    name,
    from: new UnitOutputSourceDeclaration({ unitId: UnitId.make(unitId), outputName }),
    metadata: {},
  })

const workflowOutput = (name: string, inputName: string) =>
  new WorkflowOutputDeclaration({
    name,
    from: new WorkflowInputSourceDeclaration({ inputName }),
    metadata: {},
  })

const workflowUnitOutput = (name: string, unitId: string, outputName: string) =>
  new WorkflowOutputDeclaration({
    name,
    from: new UnitOutputSourceDeclaration({ unitId: UnitId.make(unitId), outputName }),
    metadata: {},
  })

const successPayloads = (workflowId: string, unitId: string) => {
  const runId = RunId.make(`run:plan:${workflowId}`)
  const attemptId = AttemptId.make(`attempt:${runId}:${unitId}:1`)
  const brandedUnitId = UnitId.make(unitId)

  return {
    logs: [
      new RegisteredLog({
        metadata: new LogMetadata({
          logRef: LogRef.make(`log:${workflowId}:${unitId}:stdout`),
          runId,
          unitId: brandedUnitId,
          attemptId,
          name: "stdout",
          status: "available",
          summary: "unit stdout",
        }),
        content: "unit stdout\n",
      }),
    ],
    artifacts: [
      new RegisteredArtifact({
        metadata: new ArtifactMetadata({
          artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:dist`),
          runId,
          unitId: brandedUnitId,
          attemptId,
          name: "dist",
          category: "build-output",
          status: "available",
          summary: "unit artifact",
        }),
        payloadBase64: Buffer.from(JSON.stringify({ workflowId, unitId, artifact: "dist" }) + "\n").toString("base64"),
        contentType: "application/json",
      }),
    ],
  } satisfies NonNullable<TestExecutorLayerOptions["resultsByUnitId"]>[string]
}

const reportPayload = (workflowId: string, unitId: string, name: string) => {
  const runId = RunId.make(`run:plan:${workflowId}`)
  const attemptId = AttemptId.make(`attempt:${runId}:${unitId}:1`)

  return new ProducedReport({
    name,
    unitId: UnitId.make(unitId),
    attemptId,
    format: "text",
    contentType: "text/plain",
    artifact: new RegisteredArtifact({
      metadata: new ArtifactMetadata({
        artifactRef: ArtifactRef.make(`artifact:${workflowId}:${unitId}:report:${name}`),
        runId,
        unitId: UnitId.make(unitId),
        attemptId,
        name,
        category: "report",
        status: "available",
        summary: `${name}.txt`,
      }),
      payloadBase64: Buffer.from(`${name}\n`).toString("base64"),
      contentType: "text/plain",
    }),
  })
}

const interruptedSeedRun = (workflowId: string) => {
  const runId = RunId.make(`run:plan:${workflowId}`)
  const buildAttemptId = AttemptId.make(`attempt:${runId}:unit:build:1`)
  const runningAttempt = new ExecutionAttemptState({
    attemptId: buildAttemptId,
    runId,
    unitId: UnitId.make("unit:build"),
    attemptNumber: 1,
    status: "running",
    startedAt: new Date(0),
    artifacts: [],
    logs: [],
  })

  const units = [
    new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:build"),
      status: "running",
      dependencies: [],
      latestAttemptId: buildAttemptId,
      attempts: [runningAttempt],
      startedAt: new Date(0),
      artifacts: [],
      logs: [],
    }),
    new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:lint"),
      status: "ready",
      dependencies: [],
      attempts: [],
      artifacts: [],
      logs: [],
    }),
    new ExecutionUnitState({
      runId,
      unitId: UnitId.make("unit:test"),
      status: "pending",
      dependencies: [UnitId.make("unit:build")],
      attempts: [],
      artifacts: [],
      logs: [],
    }),
  ]

  return new WorkflowRunState({
    runId,
    projectId: ProjectId.make(`project:${workflowId}`),
    workflowId: WorkflowId.make(workflowId),
    planId: PlanId.make(`plan:${workflowId}`),
    execution: new RunExecutionContext({
      plan: plan(
        workflowId,
        [planUnit("unit:build"), planUnit("unit:lint"), planUnit("unit:test", ["unit:build", "unit:lint"])],
        [
          planDependency("unit:build", "unit:test"),
          planDependency("unit:lint", "unit:test"),
        ],
      ),
      options: new RunExecutionOptions({ workspacePath: "/repo/workspace" }),
      submittedAt: new Date(0),
    }),
    status: "running",
    units,
    progress: new ProgressSummary({
      totalUnits: 3,
      completedUnits: 0,
      failedUnits: 0,
      skippedUnits: 0,
    }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    startedAt: new Date(0),
    artifacts: [],
    logs: [],
  })
}

const scheduledRetrySeedRun = (workflowId: string) => {
  const runId = RunId.make(`run:plan:${workflowId}`)
  const attemptId = AttemptId.make(`attempt:${runId}:unit:build:1`)
  const retryAt = new Date(1000)

  return new WorkflowRunState({
    runId,
    projectId: ProjectId.make(`project:${workflowId}`),
    workflowId: WorkflowId.make(workflowId),
    planId: PlanId.make(`plan:${workflowId}`),
    execution: new RunExecutionContext({
      plan: plan(workflowId, [planUnit("unit:build", [], {}, { policies: [retryPolicy(2)] })]),
      options: new RunExecutionOptions({ workspacePath: "/repo/workspace" }),
      submittedAt: new Date(0),
    }),
    status: "running",
    units: [
      new ExecutionUnitState({
        runId,
        unitId: UnitId.make("unit:build"),
        status: "failed",
        dependencies: [],
        latestAttemptId: attemptId,
        nextRetryAt: retryAt,
        attempts: [
          new ExecutionAttemptState({
            attemptId,
            runId,
            unitId: UnitId.make("unit:build"),
            attemptNumber: 1,
            status: "failed",
            startedAt: new Date(0),
            finishedAt: new Date(0),
            failure: new FailureSummary({ message: "retry me" }),
            artifacts: [],
            logs: [],
          }),
        ],
        startedAt: new Date(0),
        finishedAt: new Date(0),
        failure: new FailureSummary({ message: "retry me" }),
        artifacts: [],
        logs: [],
      }),
    ],
    progress: new ProgressSummary({
      totalUnits: 1,
      completedUnits: 0,
      failedUnits: 1,
      skippedUnits: 0,
    }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    startedAt: new Date(0),
    artifacts: [],
    logs: [],
  })
}
