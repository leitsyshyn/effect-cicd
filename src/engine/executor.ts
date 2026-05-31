import { Clock, Effect, Layer, Schema, Stream } from "effect"
import * as Context from "effect/Context"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { join, posix } from "node:path"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../domain/artifacts.ts"
import { ExecutorFailed } from "../domain/errors.ts"
import { ArtifactDeclaration } from "../domain/workflow-definition.ts"
import { PayloadDescriptor, PlanPolicy } from "../domain/execution-plan.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "../domain/ids.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export class DispatchInput extends Schema.Class<DispatchInput>("DispatchInput")({
  name: Schema.String,
  value: Schema.Unknown,
}) {}

export class DispatchWorkspace extends Schema.Class<DispatchWorkspace>("DispatchWorkspace")({
  hostPath: Schema.String,
  mountPath: Schema.String,
}) {}

export class DispatchRequest extends Schema.Class<DispatchRequest>("DispatchRequest")({
  runId: RunId,
  unitId: UnitId,
  attemptId: AttemptId,
  attemptNumber: PositiveInt,
  payloadDescriptor: PayloadDescriptor,
  workspace: Schema.optional(DispatchWorkspace),
  inputs: Schema.Array(DispatchInput),
  artifacts: Schema.Array(ArtifactDeclaration),
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
  artifacts: Schema.Array(RegisteredArtifact),
  logs: Schema.Array(RegisteredLog),
  startedAt: Schema.optional(Schema.Date),
  finishedAt: Schema.optional(Schema.Date),
  diagnostics: Schema.Array(Schema.String),
}) {}

export interface TestExecutorResultConfig {
  readonly outcome?: ExecutorOutcome
  readonly exitCode?: number
  readonly failure?: ExecutorFailureSummary
  readonly outputs?: Record<string, unknown>
  readonly artifacts?: ReadonlyArray<RegisteredArtifact>
  readonly logs?: ReadonlyArray<RegisteredLog>
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
          artifacts: normalizeArtifacts(request, configured?.artifacts ?? []),
          logs: normalizeLogs(request, configured?.logs ?? []),
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
          Effect.catchTag("ExecutorFailed", Effect.fail),
          Effect.mapError(
            (error) =>
              new ExecutorFailed({
                runId: request.runId,
                unitId: request.unitId,
                attemptId: request.attemptId,
                message: `Failed to start local container execution: ${toErrorMessage(error)}`,
              }),
          ),
        )
      })

      return { execute }
    }),
  )
}

const executeDockerRequest = Effect.fn("LocalContainerExecutor.executeDockerRequest")(function* (request: DispatchRequest) {
  const startedAt = yield* nowDate
  const handle = yield* ChildProcess.make("docker", dockerArgs(request.payloadDescriptor, request.workspace))
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

  const artifacts = yield* collectArtifacts(request, finishedAt)

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
    artifacts,
    logs: buildLogs(request, finishedAt, stdout, stderr),
    startedAt,
    finishedAt,
    diagnostics: numericExitCode === 0 ? [] : [`docker run exited with code ${numericExitCode}`],
  })
})

const dockerArgs = (payloadDescriptor: PayloadDescriptor, workspace: DispatchWorkspace | undefined) => {
  const envArgs = Object.keys(payloadDescriptor.env)
    .sort()
    .flatMap((name) => ["--env", `${name}=${payloadDescriptor.env[name]}`])
  const volumeArgs = workspace === undefined ? [] : ["--volume", `${workspace.hostPath}:${workspace.mountPath}`]
  const workingDirectory = resolveContainerWorkingDirectory(payloadDescriptor, workspace)

  return [
    "run",
    "--rm",
    ...envArgs,
    ...volumeArgs,
    ...(workingDirectory === undefined ? [] : ["--workdir", workingDirectory]),
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
  new RegisteredLog({
    metadata: new LogMetadata({
      logRef: LogRef.make(`log:${request.runId}:${request.unitId}:${request.attemptId}:${name}`),
      runId: request.runId,
      unitId: request.unitId,
      attemptId: request.attemptId,
      name,
      status: "available",
      sizeBytes: new TextEncoder().encode(content).byteLength,
      createdAt,
      summary: summarizeLog(content),
    }),
    content,
  })

const collectArtifacts = Effect.fn("LocalContainerExecutor.collectArtifacts")(function* (
  request: DispatchRequest,
  createdAt: Date,
) {
  if (request.workspace === undefined) {
    return []
  }

  const registered = new Array<RegisteredArtifact>()

  for (const artifact of request.artifacts) {
    const hostPath = join(request.workspace.hostPath, artifact.path)
    const file = Bun.file(hostPath)
    const exists = yield* Effect.tryPromise({
      try: () => file.exists(),
      catch: (error) =>
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Failed to inspect artifact ${artifact.name}: ${toErrorMessage(error)}`,
        }),
    })

    if (!exists) {
      registered.push(
        new RegisteredArtifact({
          metadata: new ArtifactMetadata({
            artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:${artifact.name}`),
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            name: artifact.name,
            category: artifact.kind,
            status: "missing",
            createdAt,
            summary: artifact.path,
          }),
          contentType: artifact.contentType,
        }),
      )
      continue
    }

    const bytes = yield* Effect.tryPromise({
      try: () => file.bytes(),
      catch: (error) =>
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Failed to read artifact ${artifact.name}: ${toErrorMessage(error)}`,
        }),
    })

    registered.push(
      new RegisteredArtifact({
        metadata: new ArtifactMetadata({
          artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:${artifact.name}`),
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          name: artifact.name,
          category: artifact.kind,
          status: "available",
          sizeBytes: bytes.byteLength,
          createdAt,
          summary: artifact.path,
        }),
        payloadBase64: Buffer.from(bytes).toString("base64"),
        contentType: artifact.contentType,
      }),
    )
  }

  return registered
})

const normalizeArtifacts = (request: DispatchRequest, artifacts: ReadonlyArray<RegisteredArtifact>) =>
  artifacts.map(({ metadata, payloadBase64, contentType }) =>
    new RegisteredArtifact({
      metadata: new ArtifactMetadata({
        ...metadata,
        artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:${metadata.name}`),
        runId: request.runId,
        unitId: request.unitId,
        attemptId: request.attemptId,
      }),
      payloadBase64,
      contentType,
    }),
  )

const normalizeLogs = (request: DispatchRequest, logs: ReadonlyArray<RegisteredLog>) =>
  logs.map(({ metadata, content }) =>
    new RegisteredLog({
      metadata: new LogMetadata({
        ...metadata,
        logRef: LogRef.make(`log:${request.attemptId}:${metadata.name}`),
        runId: request.runId,
        unitId: request.unitId,
        attemptId: request.attemptId,
      }),
      content,
    }),
  )

const summarizeLog = (content: string) => {
  const normalized = content.trim()
  return normalized.length === 0 ? undefined : normalized.slice(0, 200)
}

const resolveContainerWorkingDirectory = (
  payloadDescriptor: PayloadDescriptor,
  workspace: DispatchWorkspace | undefined,
) => {
  if (workspace === undefined) {
    return payloadDescriptor.workingDirectory
  }

  if (payloadDescriptor.workingDirectory === undefined || payloadDescriptor.workingDirectory.length === 0) {
    return workspace.mountPath
  }

  if (payloadDescriptor.workingDirectory.startsWith(workspace.mountPath)) {
    return payloadDescriptor.workingDirectory
  }

  if (payloadDescriptor.workingDirectory.startsWith("/")) {
    return payloadDescriptor.workingDirectory
  }

  return posix.join(workspace.mountPath, payloadDescriptor.workingDirectory)
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
