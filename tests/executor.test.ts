import { NodeChildProcessSpawner } from "@effect/platform-node-shared"
import { describe, expect, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path, Sink, Stream } from "effect"
import * as PlatformError from "effect/PlatformError"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { ContainerCommandDescriptor } from "../src/domain/execution-plan.ts"
import { AttemptId, RunId, UnitId } from "../src/domain/ids.ts"
import {
  DispatchInput,
  DispatchRequest,
  Executor,
  ExecutorFailureSummary,
  LocalContainerExecutor,
} from "../src/engine/executor.ts"

describe("Executor", () => {
  it.effect("Executor.testLayer stays deterministic", () =>
    Effect.gen(function* () {
      const executor = yield* Executor
      const result = yield* executor.execute(request())

      expect(result.outcome).toBe("failed")
      expect(result.exitCode).toBe(17)
      expect(result.failure?.message).toBe("configured failure")
      expect(result.diagnostics).toEqual(["test diagnostic"])
    }).pipe(
      Effect.provide(
        Executor.testLayer({
          resultsByUnitId: {
            "unit:build": {
              outcome: "failed",
              exitCode: 17,
              failure: new ExecutorFailureSummary({ message: "configured failure" }),
              diagnostics: ["test diagnostic"],
            },
          },
        }),
      ),
    ),
  )

  it.effect("LocalContainerExecutor rejects unsupported dispatch inputs with ExecutorFailed", () =>
    Effect.gen(function* () {
      const executor = yield* Executor
      const error = yield* executor
        .execute(
          request({
            inputs: [new DispatchInput({ name: "workspace", value: "ignored" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error._tag).toBe("ExecutorFailed")
      expect(error.message).toContain("does not yet support dispatch inputs")
    }).pipe(Effect.provide(localExecutorLayer())),
  )

  it.effect("LocalContainerExecutor normalizes successful docker execution", () =>
    {
      const commands = new Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>()

      return Effect.gen(function* () {
        const executor = yield* Executor
        const result = yield* executor.execute(
          request({
            payloadDescriptor: new ContainerCommandDescriptor({
              image: "alpine:latest",
              command: ["sh", "-c", "echo hello"],
              env: { B: "two", A: "one" },
              workingDirectory: "/workspace",
            }),
          }),
        )

        expect(result.outcome).toBe("succeeded")
        expect(result.exitCode).toBe(0)
        expect(result.failure).toBeUndefined()
        expect(result.logs).toHaveLength(1)
        expect(result.logs[0]?.name).toBe("stdout")
        expect(result.logs[0]?.summary).toBe("hello")
        expect(result.artifacts).toEqual([])
        expect(result.outputs).toEqual({})
        expect(result.startedAt).toBeInstanceOf(Date)
        expect(result.finishedAt).toBeInstanceOf(Date)

        expect(commands).toEqual([
          {
            command: "docker",
            args: [
              "run",
              "--rm",
              "--env",
              "A=one",
              "--env",
              "B=two",
              "--workdir",
              "/workspace",
              "alpine:latest",
              "sh",
              "-c",
              "echo hello",
            ],
          },
        ])
      }).pipe(
        Effect.provide(
          localExecutorLayer({
            commands,
            stdout: "hello\n",
          }),
        ),
      )
    },
  )

  it.effect("LocalContainerExecutor maps non-zero container exit to failed outcome", () =>
    Effect.gen(function* () {
      const executor = yield* Executor
      const result = yield* executor.execute(request())

      expect(result.outcome).toBe("failed")
      expect(result.exitCode).toBe(23)
      expect(result.failure?.message).toBe("boom")
      expect(result.failure?.code).toBe("exit:23")
      expect(result.logs.map((log) => log.name)).toEqual(["stdout", "stderr"])
      expect(result.diagnostics).toEqual(["docker run exited with code 23"])
    }).pipe(
      Effect.provide(
        localExecutorLayer({
          stdout: "partial output\n",
          stderr: "boom\n",
          exitCode: 23,
        }),
      ),
    ),
  )

  it.effect("LocalContainerExecutor converts docker startup failures into ExecutorFailed", () =>
    Effect.gen(function* () {
      const executor = yield* Executor
      const error = yield* executor.execute(request()).pipe(Effect.flip)

      expect(error._tag).toBe("ExecutorFailed")
      expect(error.message).toContain("nonexistent docker")
    }).pipe(
      Effect.provide(
        localExecutorLayer({
          fail: PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            pathOrDescriptor: "docker",
            syscall: "spawn docker",
            description: "nonexistent docker",
          }),
        }),
      ),
    ),
  )

  it.live("LocalContainerExecutor runs a real container when Docker integration is enabled", () => {
    if (!dockerIntegrationEnabled) {
      return Effect.void
    }

    return Effect.gen(function* () {
      const executor = yield* Executor
      const result = yield* executor.execute(
        request({
          payloadDescriptor: new ContainerCommandDescriptor({
            image: "alpine:latest",
            command: ["sh", "-c", "echo hello"],
            env: {},
          }),
        }),
      )

      expect(result.outcome).toBe("succeeded")
      expect(result.exitCode).toBe(0)
      expect(result.logs[0]?.name).toBe("stdout")
      expect(result.logs[0]?.summary).toContain("hello")
    }).pipe(Effect.provide(realDockerExecutorLayer))
  })
})

const localExecutorLayer = (options: {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
  readonly fail?: PlatformError.PlatformError
  readonly commands?: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>
} = {}) =>
  LocalContainerExecutor.layer.pipe(Layer.provideMerge(childProcessSpawnerLayer(options)))

const childProcessSpawnerLayer = (options: {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
  readonly fail?: PlatformError.PlatformError
  readonly commands?: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>
}) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      if (command._tag === "StandardCommand") {
        options.commands?.push({ command: command.command, args: command.args })
      }

      if (options.fail !== undefined) {
        return Effect.fail(options.fail)
      }

      const stdout = options.stdout ?? ""
      const stderr = options.stderr ?? ""
      const combined = [stdout.trimEnd(), stderr.trimEnd()].filter((chunk) => chunk.length > 0).join("\n")

      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.exitCode ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: textStream(stdout),
          stderr: textStream(stderr),
          all: textStream(combined),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      )
    }),
  )

const request = (overrides: Partial<ConstructorParameters<typeof DispatchRequest>[0]> = {}) =>
  new DispatchRequest({
    runId: RunId.make("run:plan:workflow:test"),
    unitId: UnitId.make("unit:build"),
    attemptId: AttemptId.make("attempt:run:plan:workflow:test:unit:build:1"),
    attemptNumber: 1,
    payloadDescriptor: new ContainerCommandDescriptor({
      image: "alpine:latest",
      command: ["sh", "-c", "exit 23"],
      env: {},
    }),
    inputs: [],
    artifactNames: [],
    logNames: ["stdout"],
    policies: [],
    correlation: {},
    ...overrides,
  })

const textStream = (content: string) => Stream.make(new TextEncoder().encode(content))

const realDockerExecutorLayer = LocalContainerExecutor.layer.pipe(
  Layer.provideMerge(NodeChildProcessSpawner.layer),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(FileSystem.layerNoop({})),
)

const dockerIntegrationEnabled =
  typeof Bun !== "undefined" &&
  Bun.env.RUN_DOCKER_TESTS === "1" &&
  Bun.spawnSync({
    cmd: ["docker", "info", "--format", "{{.ServerVersion}}"],
    stdout: "ignore",
    stderr: "ignore",
  }).success
