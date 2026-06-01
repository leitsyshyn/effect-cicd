import { Clock, Effect, Layer, Schema, Stream } from "effect"
import * as Context from "effect/Context"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { posix, resolve as resolvePath } from "node:path"

import { ArtifactMetadata, LogMetadata, RegisteredArtifact, RegisteredLog } from "../domain/artifacts.ts"
import { ExecutorFailed } from "../domain/errors.ts"
import { ProducedReport } from "../domain/reports.ts"
import { ArtifactDeclaration, OutputDeclaration, ReportDeclaration } from "../domain/workflow-definition.ts"
import { PayloadDescriptor, PlanPolicy } from "../domain/execution-plan.ts"
import { ArtifactRef, AttemptId, LogRef, RunId, UnitId } from "../domain/ids.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const maxOutputBytes = 64 * 1024

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
  env: Schema.Record(Schema.String, Schema.String),
  secretEnvNames: Schema.Array(Schema.String),
  workspace: Schema.optional(DispatchWorkspace),
  inputs: Schema.Array(DispatchInput),
  outputs: Schema.optional(Schema.Array(OutputDeclaration)),
  reports: Schema.optional(Schema.Array(ReportDeclaration)),
  artifacts: Schema.Array(ArtifactDeclaration),
  logNames: Schema.Array(Schema.String),
  policies: Schema.Array(PlanPolicy),
  correlation: Schema.Record(Schema.String, Schema.String),
}) {}

export class ExecutorFailureSummary extends Schema.Class<ExecutorFailureSummary>("ExecutorFailureSummary")({
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export const ExecutorOutcome = Schema.Literals(["succeeded", "failed", "timed_out", "canceled", "interrupted"])
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
  reports: Schema.Array(ProducedReport),
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
  readonly execute?: (request: DispatchRequest) => Effect.Effect<ExecutorResult, ExecutorFailed>
  readonly outputs?: Record<string, unknown>
  readonly reports?: ReadonlyArray<ProducedReport>
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
        if (configured?.execute !== undefined) {
          return yield* configured.execute(request)
        }

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
          reports: normalizeReports(request, configured?.reports ?? []),
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
        if (request.workspace === undefined && ((request.outputs ?? []).length > 0 || (request.reports ?? []).length > 0)) {
          return yield* new ExecutorFailed({
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            message: "LocalContainerExecutor requires a workspace to collect declared outputs or reports",
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
  const env = augmentEnvWithInputs(request.env, request.inputs)
  const handle = yield* ChildProcess.make("docker", dockerArgs(env, request.payloadDescriptor, request.workspace), {
    env,
    extendEnv: true,
  })
  const [stdout, stderr, exitCode] = yield* Effect.all([readText(handle.stdout), readText(handle.stderr), handle.exitCode], {
    concurrency: "unbounded",
  }).pipe(Effect.onInterrupt(() => handle.kill()))
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

  const outputs = numericExitCode === 0 ? yield* collectOutputs(request) : {}
  const reports = yield* collectReports(request, finishedAt)
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
    outputs,
    reports,
    artifacts,
    logs: buildLogs(request, finishedAt, stdout, stderr),
    startedAt,
    finishedAt,
    diagnostics: numericExitCode === 0 ? [] : [`docker run exited with code ${numericExitCode}`],
  })
})

const dockerArgs = (
  env: Readonly<Record<string, string>>,
  payloadDescriptor: PayloadDescriptor,
  workspace: DispatchWorkspace | undefined,
) => {
  const envArgs = Object.keys(env)
    .sort()
    .flatMap((name): Array<string> => ["--env", name])
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
    const hostPath = yield* resolveWorkspaceHostPath(request, artifact.path)
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

const collectOutputs = Effect.fn("LocalContainerExecutor.collectOutputs")(function* (request: DispatchRequest) {
  if (request.workspace === undefined || (request.outputs ?? []).length === 0) {
    return {}
  }

  const collected: Record<string, unknown> = {}

  for (const output of request.outputs ?? []) {
    const file = Bun.file(yield* resolveWorkspaceHostPath(request, output.path))
    const exists = yield* Effect.tryPromise({
      try: () => file.exists(),
      catch: (error) =>
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Failed to inspect output ${output.name}: ${toErrorMessage(error)}`,
        }),
    })

    if (!exists) {
      return yield* new ExecutorFailed({
        runId: request.runId,
        unitId: request.unitId,
        attemptId: request.attemptId,
        message: `Declared output ${output.name} was not produced at ${output.path}`,
      })
    }

    const bytes = yield* Effect.tryPromise({
      try: () => file.bytes(),
      catch: (error) =>
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Failed to read output ${output.name}: ${toErrorMessage(error)}`,
        }),
    })

    if (bytes.byteLength > maxOutputBytes) {
      return yield* new ExecutorFailed({
        runId: request.runId,
        unitId: request.unitId,
        attemptId: request.attemptId,
        message: `Declared output ${output.name} exceeded the ${maxOutputBytes} byte limit`,
      })
    }

    const text = Buffer.from(bytes).toString("utf-8")
    collected[output.name] = yield* decodeOutputValue(request, output, text)
  }

  return collected
})

const decodeOutputValue = (request: DispatchRequest, output: OutputDeclaration, text: string) =>
  output.format === "text"
    ? Effect.succeed(text)
    : Effect.try({
        try: () => JSON.parse(text),
        catch: (error) =>
          new ExecutorFailed({
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            message: `Declared output ${output.name} did not contain valid JSON: ${toErrorMessage(error)}`,
          }),
      })

const collectReports = Effect.fn("LocalContainerExecutor.collectReports")(function* (
  request: DispatchRequest,
  createdAt: Date,
) {
  if (request.workspace === undefined) {
    return []
  }

  const registered = new Array<ProducedReport>()

  for (const report of request.reports ?? []) {
    const hostPath = yield* resolveWorkspaceHostPath(request, report.path)
    const file = Bun.file(hostPath)
    const exists = yield* Effect.tryPromise({
      try: () => file.exists(),
      catch: (error) =>
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Failed to inspect report ${report.name}: ${toErrorMessage(error)}`,
        }),
    })

    if (!exists) {
      registered.push(
        new ProducedReport({
          name: report.name,
          unitId: request.unitId,
          attemptId: request.attemptId,
          format: report.format,
          contentType: report.contentType,
          artifact: new RegisteredArtifact({
            metadata: new ArtifactMetadata({
              artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:report:${report.name}`),
              runId: request.runId,
              unitId: request.unitId,
              attemptId: request.attemptId,
              name: report.name,
              category: "report",
              status: "missing",
              createdAt,
              summary: report.path,
            }),
            contentType: report.contentType,
          }),
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
          message: `Failed to read report ${report.name}: ${toErrorMessage(error)}`,
        }),
    })

    registered.push(
      new ProducedReport({
        name: report.name,
        unitId: request.unitId,
        attemptId: request.attemptId,
        format: report.format,
        contentType: report.contentType,
        artifact: new RegisteredArtifact({
          metadata: new ArtifactMetadata({
            artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:report:${report.name}`),
            runId: request.runId,
            unitId: request.unitId,
            attemptId: request.attemptId,
            name: report.name,
            category: "report",
            status: "available",
            sizeBytes: bytes.byteLength,
            createdAt,
            summary: report.path,
          }),
          payloadBase64: Buffer.from(bytes).toString("base64"),
          contentType: report.contentType,
        }),
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

const normalizeReports = (request: DispatchRequest, reports: ReadonlyArray<ProducedReport>) =>
  reports.map(({ name, format, contentType, artifact }) =>
    new ProducedReport({
      name,
      unitId: request.unitId,
      attemptId: request.attemptId,
      format,
      contentType,
      artifact: new RegisteredArtifact({
        metadata: new ArtifactMetadata({
          ...artifact.metadata,
          artifactRef: ArtifactRef.make(`artifact:${request.attemptId}:report:${name}`),
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
        }),
        payloadBase64: artifact.payloadBase64,
        contentType: artifact.contentType,
      }),
    }),
  )

const augmentEnvWithInputs = (env: Readonly<Record<string, string>>, inputs: ReadonlyArray<DispatchInput>) => ({
  ...env,
  ...(inputs.length === 0
    ? {}
    : {
        EFFECT_CICD_INPUTS_JSON: JSON.stringify(Object.fromEntries(inputs.map((input) => [input.name, input.value]))),
        ...Object.fromEntries(
          inputs.map((input) => [
            `EFFECT_CICD_INPUT_${normalizeInputEnvName(input.name)}`,
            serializeInputValue(input.value),
          ]),
        ),
      }),
})

const normalizeInputEnvName = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "VALUE"

const serializeInputValue = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value)

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

const resolveWorkspaceHostPath = (request: DispatchRequest, declaredPath: string) => {
  const workspaceRoot = resolvePath(request.workspace!.hostPath)
  const resolvedPath = resolvePath(workspaceRoot, declaredPath)

  return resolvedPath === workspaceRoot || resolvedPath.startsWith(`${workspaceRoot}/`)
    ? Effect.succeed(resolvedPath)
    : Effect.fail(
        new ExecutorFailed({
          runId: request.runId,
          unitId: request.unitId,
          attemptId: request.attemptId,
          message: `Declared path escapes the workspace root: ${declaredPath}`,
        }),
      )
}
