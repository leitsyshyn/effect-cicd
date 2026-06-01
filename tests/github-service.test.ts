import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { createHmac } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubPushWebhookPayload, GitHubRepositorySnapshot } from "../src/domain/github.ts"
import { WorkflowRunState } from "../src/domain/runtime-state.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../src/dsl/index.ts"
import { GitHubApiClient, type GitHubCheckRunUpsert } from "../src/github/api-client.ts"
import { GitHubBindingStore } from "../src/github/binding-store.ts"
import { GitHubCheckRuns } from "../src/github/check-runs.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { GitHubRunLinkStore } from "../src/github/run-link-store.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { EngineServiceConfig, GitHubAppConfig, StorageRuntimeConfig } from "../src/runtime/config.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"
import { startServiceServer } from "../src/service/server.ts"

describe("GitHub service routes", () => {
  it.live("creates bindings, accepts a signed webhook, and updates GitHub checks", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const mock = makeGitHubApiMock()
      const port = 40100 + Math.floor(Math.random() * 500)
      const baseUrl = `http://127.0.0.1:${port}`

      const server = yield* startServiceServer.pipe(Effect.provide(serviceLayer(baseUrl, port, fixture, mock)))

      yield* Effect.gen(function* () {
        const bindingResponse = yield* Effect.promise(() =>
          fetch(`${baseUrl}/api/bindings/github`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              repository: "acme/widgets",
              installationId: 1001,
              branch: "main",
              workflowModulePath: "workflow.ts",
              workspaceSubdir: "packages/app",
            }),
          }),
        )
        const bindingsResponse = yield* Effect.promise(() => fetch(`${baseUrl}/api/bindings`))
        const triggerPayload = JSON.stringify(samplePushPayload())
        const triggerResponse = yield* Effect.promise(() =>
          fetch(`${baseUrl}/api/github/webhooks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-github-event": "push",
              "x-github-delivery": "delivery-1",
              "x-hub-signature-256": signWebhook(triggerPayload),
            },
            body: triggerPayload,
          }),
        )

        const bindings = yield* Effect.promise(() => bindingsResponse.json() as Promise<Array<{ readonly bindingId: string }>>)
        const trigger = yield* Effect.promise(() =>
          triggerResponse.json() as Promise<{ readonly triggeredRuns: Array<{ readonly runId: string; readonly checkRunId?: number }> }>,
        )
        const run = yield* waitForTerminalRun(baseUrl, trigger.triggeredRuns[0]!.runId)
        yield* waitForCompletedCheck(mock)

        expect(bindingResponse.status).toBe(201)
        expect(bindings).toHaveLength(1)
        expect(triggerResponse.status).toBe(202)
        expect(trigger.triggeredRuns).toHaveLength(1)
        expect(trigger.triggeredRuns[0]?.checkRunId).toBe(9001)
        expect(run.status).toBe("succeeded")
        expect(run.execution.options.workspacePath).toBe(fixture.workspacePath)
        expect((run.execution.plan.metadata as Record<string, any>).trigger.commitSha).toBe(samplePushPayload().after)
        expect(mock.checkRuns[0]?.status).toBe("in_progress")
        expect(mock.checkRuns.at(-1)?.status).toBe("completed")
        expect(mock.checkRuns.at(-1)?.conclusion).toBe("success")
      }).pipe(Effect.ensuring(stopServer(server)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )
})

const serviceLayer = (baseUrl: string, port: number, fixture: WorkflowFixture, mock: GitHubApiMock) => {
  const engineLayer = makeInMemoryServiceEngineLayer()
  const bindingStoreLayer = GitHubBindingStore.memoryLayer
  const runLinkStoreLayer = GitHubRunLinkStore.memoryLayer
  const configLayer = Layer.succeed(GitHubAppConfig, {
    appId: "123",
    privateKey: Redacted.make("test-key"),
    webhookSecret: Redacted.make("top-secret"),
    clientId: undefined,
    clientSecret: undefined,
    publicBaseUrl: "https://ci.example.test",
    apiBaseUrl: "https://api.github.test",
  })
  const apiLayer = Layer.succeed(GitHubApiClient, {
    getRepository: (_installationId, repositoryOwner, repositoryName) =>
      Effect.succeed({
        id: 2002,
        owner: repositoryOwner,
        name: repositoryName,
        fullName: `${repositoryOwner}/${repositoryName}`,
        cloneUrl: `https://github.com/${repositoryOwner}/${repositoryName}.git`,
        defaultBranch: "main",
      }),
    downloadRepositoryArchive: () => Effect.die("unused"),
    upsertCheckRun: (request) =>
      Effect.sync(() => {
        mock.checkRuns.push(request)
        return request.checkRunId ?? 9001
      }),
  })
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
  const checksLayer = GitHubCheckRuns.layer.pipe(
    Layer.provideMerge(engineLayer),
    Layer.provideMerge(runLinkStoreLayer),
    Layer.provideMerge(apiLayer),
    Layer.provideMerge(configLayer),
  )
  const gitHubLayer = GitHubIntegration.layer.pipe(
    Layer.provideMerge(bindingStoreLayer),
    Layer.provideMerge(apiLayer),
    Layer.provideMerge(checksLayer),
    Layer.provideMerge(snapshotLayer),
    Layer.provideMerge(DslMaterializer.layer),
    Layer.provideMerge(WorkflowModuleLoader.layer),
    Layer.provideMerge(engineLayer),
    Layer.provideMerge(configLayer),
  )

  return Layer.mergeAll(
    engineLayer,
    bindingStoreLayer,
    runLinkStoreLayer,
    configLayer,
    apiLayer,
    snapshotLayer,
    checksLayer,
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    gitHubLayer,
    Layer.succeed(EngineServiceConfig, { baseUrl, port }),
    Layer.succeed(StorageRuntimeConfig, { runRecoveryOnStartup: false, runStorageTests: false }),
  )
}

interface GitHubApiMock {
  readonly checkRuns: Array<GitHubCheckRunUpsert>
}

const makeGitHubApiMock = (): GitHubApiMock => ({ checkRuns: [] })

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
    installation: { id: 1001 },
    repository: {
      id: 2002,
      name: "widgets",
      full_name: "acme/widgets",
      clone_url: "https://github.com/acme/widgets.git",
      owner: { login: "acme" },
    },
  })

const signWebhook = (rawBody: string) => `sha256=${createHmac("sha256", "top-secret").update(rawBody).digest("hex")}`

const waitForTerminalRun = (baseUrl: string, runId: string): Effect.Effect<WorkflowRunState, unknown> =>
  Effect.promise(() => fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}`)).pipe(
    Effect.flatMap((response) => Effect.promise(() => response.json() as Promise<WorkflowRunState>)),
    Effect.flatMap((run) =>
      run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "interrupted"
        ? Effect.succeed(run)
        : Effect.sleep("25 millis").pipe(Effect.flatMap(() => waitForTerminalRun(baseUrl, runId))),
    ),
  )

const waitForCompletedCheck = (mock: GitHubApiMock): Effect.Effect<void, never> =>
  mock.checkRuns.at(-1)?.status === "completed"
    ? Effect.void
    : Effect.sleep("25 millis").pipe(Effect.flatMap(() => waitForCompletedCheck(mock)))

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
