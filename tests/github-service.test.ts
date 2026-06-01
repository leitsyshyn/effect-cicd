import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubPushWebhookPayload, GitHubRepositorySnapshot } from "../src/domain/github.ts"
import { WorkflowRunState } from "../src/domain/runtime-state.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../src/dsl/index.ts"
import { GitHubBindingStore } from "../src/github/binding-store.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { EngineServiceConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"
import { startServiceServer } from "../src/service/server.ts"

describe("GitHub service routes", () => {
  it.live("creates bindings, accepts a simulated push, and exposes the resulting run", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const port = 40100 + Math.floor(Math.random() * 500)
      const baseUrl = `http://127.0.0.1:${port}`

      const server = yield* startServiceServer.pipe(Effect.provide(serviceLayer(baseUrl, port, fixture)))

      yield* Effect.gen(function* () {
        const bindingResponse = yield* Effect.promise(() =>
          fetch(`${baseUrl}/api/bindings/github`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              repository: "acme/widgets",
              branch: "main",
              workflowModulePath: "workflow.ts",
              workspaceSubdir: "packages/app",
            }),
          }),
        )
        const bindingsResponse = yield* Effect.promise(() => fetch(`${baseUrl}/api/bindings`))
        const triggerPayload = JSON.stringify(samplePushPayload())
        const triggerResponse = yield* Effect.promise(() =>
          fetch(`${baseUrl}/api/triggers/github`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-github-event": "push",
            },
            body: triggerPayload,
          }),
        )

        const bindings = yield* Effect.promise(() => bindingsResponse.json() as Promise<Array<{ readonly bindingId: string }>>)
        const trigger = yield* Effect.promise(() =>
          triggerResponse.json() as Promise<{ readonly triggeredRuns: Array<{ readonly runId: string }> }>,
        )
        const run = yield* waitForTerminalRun(baseUrl, trigger.triggeredRuns[0]!.runId)

        expect(bindingResponse.status).toBe(201)
        expect(bindings).toHaveLength(1)
        expect(triggerResponse.status).toBe(202)
        expect(trigger.triggeredRuns).toHaveLength(1)
        expect(run.status).toBe("succeeded")
        expect(run.execution.options.workspacePath).toBe(fixture.workspacePath)
        expect((run.execution.plan.metadata as Record<string, any>).trigger.commitSha).toBe(samplePushPayload().after)
      }).pipe(Effect.ensuring(stopServer(server)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )
})

const serviceLayer = (baseUrl: string, port: number, fixture: WorkflowFixture) => {
  const engineLayer = makeInMemoryServiceEngineLayer()
  const bindingStoreLayer = GitHubBindingStore.memoryLayer
  const snapshotLayer = Layer.succeed(GitHubSourceSnapshots, {
    acquire: (_binding, ref, commitSha) =>
      Effect.succeed(
        new GitHubRepositorySnapshot({
          repository: "acme/widgets",
          ref,
          commitSha,
          snapshotPath: fixture.snapshotPath,
          workspacePath: fixture.workspacePath,
        }),
      ),
  })
  const gitHubLayer = GitHubIntegration.layer.pipe(
    Layer.provideMerge(engineLayer),
    Layer.provideMerge(bindingStoreLayer),
    Layer.provideMerge(snapshotLayer),
    Layer.provideMerge(DslMaterializer.layer),
    Layer.provideMerge(WorkflowModuleLoader.layer),
  )

  return Layer.mergeAll(
    engineLayer,
    bindingStoreLayer,
    snapshotLayer,
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    gitHubLayer,
    Layer.succeed(EngineServiceConfig, { baseUrl, port }),
    Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
  )
}

interface WorkflowFixture {
  readonly snapshotPath: string
  readonly workspacePath: string
}

const makeWorkflowSnapshotFixture = () =>
  Effect.promise(async () => {
    const snapshotPath = await mkdtemp(join(tmpdir(), "effect-cicd-service-github-"))
    const workspacePath = join(snapshotPath, "packages", "app")
    await mkdir(workspacePath, { recursive: true })
    await Bun.write(join(snapshotPath, "workflow.ts"), workflowModuleText())
    await Bun.write(join(workspacePath, ".keep"), "")

    return { snapshotPath, workspacePath }
  })

const cleanupFixture = (fixture: WorkflowFixture) =>
  Effect.promise(() => rm(fixture.snapshotPath, { recursive: true, force: true }).catch(() => undefined))

const stopServer = (server: ReturnType<typeof Bun.serve>) =>
  Effect.promise(() => Promise.resolve(server.stop(true)).catch(() => undefined))

const samplePushPayload = () =>
  new GitHubPushWebhookPayload({
    ref: "refs/heads/main",
    after: "fedcba9876543210fedcba9876543210fedcba98",
    repository: {
      name: "widgets",
      full_name: "acme/widgets",
      clone_url: "https://github.com/acme/widgets.git",
      owner: { login: "acme" },
    },
  })

const waitForTerminalRun = (baseUrl: string, runId: string): Effect.Effect<WorkflowRunState, unknown> =>
  Effect.promise(() => fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}`)).pipe(
    Effect.flatMap((response) => Effect.promise(() => response.json() as Promise<WorkflowRunState>)),
    Effect.flatMap((run) =>
      run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "interrupted"
        ? Effect.succeed(run)
        : Effect.sleep("25 millis").pipe(Effect.flatMap(() => waitForTerminalRun(baseUrl, runId))),
    ),
  )

const workflowModuleText = () => `
export default {
  workflowId: "workflow:github:service",
  name: "github service workflow",
  units: [
    {
      unitId: "unit:build",
      name: "build",
      command: {
        _tag: "ContainerCommand",
        image: "alpine:latest",
        command: ["sh", "-c", "echo build"]
      }
    }
  ]
}
`
