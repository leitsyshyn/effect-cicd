import { Clock, Effect, Layer, Schema, Stream } from "effect"
import * as Context from "effect/Context"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { ExecutorFailed } from "../domain/errors.ts"
import { PayloadDescriptor, PlanPolicy } from "../domain/execution-plan.ts"
import { AttemptId, LogRef, RunId, UnitId } from "../domain/ids.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export class DispatchInput extends Schema.Class<DispatchInput>("DispatchInput")({
  name: Schema.String,
  value: Schema.Unknown,
}) {}

export class DispatchRequest extends Schema.Class<DispatchRequest>("DispatchRequest")({
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
  payloadDescriptor: PayloadDescriptor,
  inputs: Schema.Array(DispatchInput),
  artifactNames: Schema.Array(Schema.String),
  logNames: Schema.Array(Schema.String),
  policies: Schema.Array(PlanPolicy),
  correlation: Schema.Record(Schema.String, Schema.String),
}) {}

export class ExecutorFailureSummary extends Schema.Class<ExecutorFailureSummary>("ExecutorFailureSummary")({
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export const ExecutorOutcome = Schema.Literals(["succeeded", "failed", "canceled", "interrupted"])
export type ExecutorOutcome = typeof ExecutorOutcome.Type

export class ExecutorResult extends Schema.Class<ExecutorResult>("ExecutorResult")({
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
  outcome: ExecutorOutcome,
  exitCode: Schema.optional(Schema.Int),
  failure: Schema.optional(ExecutorFailureSummary),
  outputs: Schema.Record(Schema.String, Schema.Unknown),
  artifacts: Schema.Array(ArtifactMetadata),
  logs: Schema.Array(LogMetadata),
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  diagnostics: Schema.Array(Schema.String),
}) {}

export interface TestExecutorResultConfig {
  readonly outcome?: ExecutorOutcome
  readonly exitCode?: number
  readonly failure?: ExecutorFailureSummary
  readonly outputs?: Record<string, unknown>
  readonly artifacts?: ReadonlyArray<ArtifactMetadata>
  readonly logs?: ReadonlyArray<LogMetadata>
  readonly startedAt?: Date
  readonly finishedAt?: Date
  readonly diagnostics?: ReadonlyArray<string>
}

export interface TestExecutorLayerOptions {
  readonly requests?: Array<DispatchRequest>
  readonly resultsByUnitId?: Readonly<Record<string, TestExecutorResultConfig>>
}

export class Executor extends Context.Service<
  Executor,
  {
    readonly execute: (request: DispatchRequest) => Effect.Effect<ExecutorResult, ExecutorFailed>
  }
>()("@effect-cicd/engine/Executor") {
  static readonly testLayer = (options: TestExecutorLayerOptions = {}) =>
    Layer.sync(Executor, () => {
      const execute = Effect.fn("Executor.execute")(function* (request: DispatchRequest) {
        options.requests?.push(request)

        const configured = options.resultsByUnitId?.[request.unitId.toString()]
        const outcome = configured?.outcome ?? "succeeded"

        return new ExecutorResult({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          attemptNumber: request.attemptNumber,
          outcome,
          exitCode: configured?.exitCode ?? (outcome === "succeeded" ? 0 : 1),
          failure:
            configured?.failure ??
            (outcome === "failed"
              ? new ExecutorFailureSummary({ message: `Configured failure for ${request.unitId}` })
              : undefined),
          outputs: configured?.outputs ?? {},
          artifacts: [...(configured?.artifacts ?? [])],
          logs: [...(configured?.logs ?? [])],
          startedAt: configured?.startedAt,
          finishedAt: configured?.finishedAt,
          diagnostics: [...(configured?.diagnostics ?? [])],
        })
      })

      return { execute }
    })
}

export class LocalContainerExecutor {
  static readonly layer = Layer.effect(
    Executor,
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const execute = Effect.fn("LocalContainerExecutor.execute")(function* (request: DispatchRequest) {
        if (request.inputs.length > 0) {
          return yield* new ExecutorFailed({
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            message: "LocalContainerExecutor does not yet support dispatch inputs",
          })
        }

        return yield* executeDockerRequest(request).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
          Effect.scoped,
          Effect.catchTag("ExecutorFailed", (error) => Effect.fail(error)),
          Effect.catch((error) =>
            Effect.fail(
              new ExecutorFailed({
                runId: request.runId,
                unitId: request.unitId,
                attemptId: request.attemptId,
                message: `Failed to start local container execution: ${toErrorMessage(error)}`,
              }),
            ),
          ),
        )
      })

      return { execute }
    }),
  )
}

const executeDockerRequest = Effect.fn("LocalContainerExecutor.executeDockerRequest")(function* (request: DispatchRequest) {
  const startedAt = yield* nowDate
  const handle = yield* ChildProcess.make("docker", dockerArgs(request.payloadDescriptor))
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [readText(handle.stdout), readText(handle.stderr), handle.exitCode],
    { concurrency: "unbounded" },
  )
  const finishedAt = yield* nowDate
  const numericExitCode = Number(exitCode)

  if (isExecutorInfrastructureFailure(numericExitCode, stderr)) {
    return yield* new ExecutorFailed({
      runId: request.runId,
      unitId: request.unitId,
      attemptId: request.attemptId,
      message: summarizeExecutorInfrastructureFailure(numericExitCode, stderr),
    })
  }

  return new ExecutorResult({
    runId: request.runId,
    unitId: request.unitId,
    attemptId: request.attemptId,
    attemptNumber: request.attemptNumber,
    outcome: numericExitCode === 0 ? "succeeded" : "failed",
    exitCode: numericExitCode,
    failure:
      numericExitCode === 0
        ? undefined
        : new ExecutorFailureSummary({
            message: summarizeUnitFailure(numericExitCode, stdout, stderr),
            code: `exit:${numericExitCode}`,
          }),
    outputs: {},
    artifacts: [],
    logs: buildLogs(request, finishedAt, stdout, stderr),
    startedAt,
    finishedAt,
    diagnostics: numericExitCode === 0 ? [] : [`docker run exited with code ${numericExitCode}`],
  })
})

const dockerArgs = (payloadDescriptor: PayloadDescriptor) => {
  const envArgs = Object.keys(payloadDescriptor.env)
    .sort()
    .flatMap((name) => ["--env", `${name}=${payloadDescriptor.env[name]}`])

  return [
    "run",
    "--rm",
    ...envArgs,
    ...(payloadDescriptor.workingDirectory === undefined ? [] : ["--workdir", payloadDescriptor.workingDirectory]),
    payloadDescriptor.image,
    ...payloadDescriptor.command,
  ]
}

const readText = (stream: ReturnType<typeof ChildProcessSpawner.makeHandle>["stdout"]) =>
  stream.pipe(Stream.decodeText, Stream.mkString)

const buildLogs = (request: DispatchRequest, createdAt: Date, stdout: string, stderr: string) => {
  const logs = [buildLog(request, createdAt, "stdout", stdout)]

  if (stderr.length > 0) {
    logs.push(buildLog(request, createdAt, "stderr", stderr))
  }

  return logs
}

const buildLog = (request: DispatchRequest, createdAt: Date, name: "stdout" | "stderr", content: string) =>
  new LogMetadata({
    logRef: LogRef.make(`log:${request.runId}:${request.unitId}:${request.attemptId}:${name}`),
    runId: request.runId,
    unitId: request.unitId,
    attemptId: request.attemptId,
    name,
    status: "available",
    sizeBytes: new TextEncoder().encode(content).byteLength,
    createdAt,
    summary: summarizeLog(content),
  })

const summarizeLog = (content: string) => {
  const normalized = content.trim()
  return normalized.length === 0 ? undefined : normalized.slice(0, 200)
}

const summarizeUnitFailure = (exitCode: number, stdout: string, stderr: string) => {
  const stderrSummary = summarizeLog(stderr)
  if (stderrSummary !== undefined) {
    return stderrSummary
  }

  const stdoutSummary = summarizeLog(stdout)
  if (stdoutSummary !== undefined) {
    return stdoutSummary
  }

  return `Container command exited with code ${exitCode}`
}

const summarizeExecutorInfrastructureFailure = (exitCode: number, stderr: string) => {
  const summary = summarizeLog(stderr)
  return summary === undefined ? `Docker failed before starting the container (exit code ${exitCode})` : summary
}

const isExecutorInfrastructureFailure = (exitCode: number, stderr: string) => {
  if (exitCode === 125) {
    return true
  }

  return dockerInfrastructurePatterns.some((pattern) => pattern.test(stderr))
}

const dockerInfrastructurePatterns = [
  /cannot connect to the docker daemon/i,
  /failed to connect to the docker api/i,
  /is the docker daemon running/i,
  /permission denied while trying to connect to the docker daemon socket/i,
]

const nowDate = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

const toErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }

  return String(error)
}
