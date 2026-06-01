import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { createHmac } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubBindingCreateRequest, GitHubPushWebhookPayload, GitHubRepositorySnapshot } from "../src/domain/github.ts"
import { deriveGitHubProjectId } from "../src/domain/project.ts"
import { WorkflowRunState } from "../src/domain/runtime-state.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../src/dsl/index.ts"
import { Engine } from "../src/engine/interface.ts"
import { GitHubApiClient, type GitHubCheckRunUpsert } from "../src/github/api-client.ts"
import { GitHubBindingStore } from "../src/github/binding-store.ts"
import { GitHubCheckRuns } from "../src/github/check-runs.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { GitHubRunLinkStore } from "../src/github/run-link-store.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { GitHubTriggerDeliveryStore } from "../src/github/trigger-delivery-store.ts"
import { GitHubAppConfig } from "../src/runtime/config.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"

describe("GitHub integration", () => {
  it.effect("creates and lists persisted GitHub App bindings", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const mock = makeGitHubApiMock()

      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration

        const created = yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            installationId: 1001,
            branch: "main",
            workflowModulePath: "workflow.ts",
            workspaceSubdir: "packages/app",
          }),
        )
        const bindings = yield* service.listBindings()
        const projects = yield* service.listProjects()

        expect(created.repository).toBe("acme/widgets")
        expect(created.projectId).toBe(deriveGitHubProjectId(2002, "acme", "widgets"))
        expect(created.installationId).toBe(1001)
        expect(created.repositoryId).toBe(2002)
        expect(created.sourceKind).toBe("github-archive")
        expect(bindings).toHaveLength(1)
        expect(bindings[0]?.bindingId).toBe(created.bindingId)
        expect(projects).toHaveLength(1)
        expect(projects[0]?.projectId).toBe(created.projectId)
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture, mock)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )

  it.effect("rejects unsigned webhook pushes when the app secret is configured", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const mock = makeGitHubApiMock()

      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration

        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            installationId: 1001,
            branch: "main",
            workflowModulePath: "workflow.ts",
          }),
        )

        const result = yield* service
          .handleWebhook({
            event: "push",
            signature: null,
            rawBody: JSON.stringify(samplePushPayload()),
          })
          .pipe(Effect.exit)

        expect(result._tag).toBe("Failure")
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture, mock)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )

  it.effect("verifies signatures, submits a run, and syncs check-run lifecycle", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const mock = makeGitHubApiMock()

      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration
        const engine = yield* Engine
        const checks = yield* GitHubCheckRuns

        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            installationId: 1001,
            branch: "main",
            workflowModulePath: "workflow.ts",
          }),
        )
        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            installationId: 1001,
            branch: "release",
            workflowModulePath: "workflow.ts",
          }),
        )

        const rawBody = JSON.stringify(samplePushPayload())
        const response = yield* service.handleWebhook({
          event: "push",
          signature: signWebhook(rawBody),
          deliveryId: "delivery-1",
          rawBody,
        })
        const runId = response.triggeredRuns[0]?.runId

        expect(response.matchedBindings).toBe(1)
        expect(response.triggeredRuns).toHaveLength(1)
        expect(response.triggeredRuns[0]?.checkRunId).toBe(9001)
        expect(mock.checkRuns[0]?.status).toBe("queued")

        const run = yield* waitForTerminalRun(engine, runId!)
        yield* checks.syncRun(run.runId)

        expect(run.status).toBe("succeeded")
        expect(run.execution.options.workspacePath).toBe(fixture.workspacePath)
        expect((run.execution.plan.metadata as Record<string, any>).trigger.commitSha).toBe(samplePushPayload().after)
        expect(mock.checkRuns.at(-1)?.status).toBe("completed")
        expect(mock.checkRuns.at(-1)?.conclusion).toBe("success")
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture, mock)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )

  it.effect("dedupes duplicate webhook deliveries for the same binding", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      const mock = makeGitHubApiMock()

      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration
        const engine = yield* Engine

        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            installationId: 1001,
            branch: "main",
            workflowModulePath: "workflow.ts",
          }),
        )

        const rawBody = JSON.stringify(samplePushPayload())
        const first = yield* service.handleWebhook({
          event: "push",
          signature: signWebhook(rawBody),
          deliveryId: "delivery-dedupe",
          rawBody,
        })
        const second = yield* service.handleWebhook({
          event: "push",
          signature: signWebhook(rawBody),
          deliveryId: "delivery-dedupe",
          rawBody,
        })
        const runs = yield* engine.listRuns()

        expect(first.triggeredRuns).toHaveLength(1)
        expect(second.triggeredRuns).toHaveLength(1)
        expect(second.triggeredRuns[0]?.deduped).toBe(true)
        expect(second.triggeredRuns[0]?.runId).toBe(first.triggeredRuns[0]?.runId)
        expect(runs).toHaveLength(1)
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture, mock)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )
})

const gitHubIntegrationLayer = (fixture: WorkflowFixture, mock: GitHubApiMock) => {
  const engineLayer = makeInMemoryServiceEngineLayer()
  const bindingStoreLayer = GitHubBindingStore.memoryLayer
  const runLinkStoreLayer = GitHubRunLinkStore.memoryLayer
  const triggerDeliveryLayer = GitHubTriggerDeliveryStore.memoryLayer
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
          projectId: deriveGitHubProjectId(2002, "acme", "widgets"),
          repository: "acme/widgets",
          ref,
          commitSha,
          snapshotPath: fixture.snapshotPath,
          workspacePath: fixture.workspacePath,
        }),
      ),
  })
  const checkRunsLayer = GitHubCheckRuns.layer.pipe(
    Layer.provideMerge(engineLayer),
    Layer.provideMerge(runLinkStoreLayer),
    Layer.provideMerge(apiLayer),
    Layer.provideMerge(configLayer),
  )
  const gitHubLayer = GitHubIntegration.layer.pipe(
    Layer.provideMerge(bindingStoreLayer),
    Layer.provideMerge(apiLayer),
    Layer.provideMerge(checkRunsLayer),
    Layer.provideMerge(snapshotLayer),
    Layer.provideMerge(DslMaterializer.layer),
    Layer.provideMerge(WorkflowModuleLoader.layer),
    Layer.provideMerge(engineLayer),
    Layer.provideMerge(configLayer),
    Layer.provideMerge(runLinkStoreLayer),
    Layer.provideMerge(triggerDeliveryLayer),
  )

  return Layer.mergeAll(
    engineLayer,
    bindingStoreLayer,
    runLinkStoreLayer,
    configLayer,
    apiLayer,
    snapshotLayer,
    DslMaterializer.layer,
    WorkflowModuleLoader.layer,
    checkRunsLayer,
    triggerDeliveryLayer,
    gitHubLayer,
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
    const snapshotPath = await mkdtemp(join(tmpdir(), "effect-cicd-github-snapshot-"))
    const workspacePath = join(snapshotPath, "packages", "app")
    await mkdir(workspacePath, { recursive: true })
    await Bun.write(join(snapshotPath, "workflow.ts"), workflowModuleText())
    await Bun.write(join(workspacePath, ".keep"), "")

    return { snapshotPath, workspacePath }
  })

const cleanupFixture = (fixture: WorkflowFixture) =>
  Effect.promise(() => rm(fixture.snapshotPath, { recursive: true, force: true }).catch(() => undefined))

const samplePushPayload = () =>
  new GitHubPushWebhookPayload({
    ref: "refs/heads/main",
    after: "0123456789abcdef0123456789abcdef01234567",
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

const waitForTerminalRun = (engine: typeof Engine.Service, runId: string): Effect.Effect<WorkflowRunState, unknown, never> =>
  engine.inspectRun(runId as any).pipe(
    Effect.flatMap((run) =>
      run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "interrupted"
        ? Effect.succeed(run)
        : Effect.sleep("25 millis").pipe(Effect.flatMap(() => waitForTerminalRun(engine, runId))),
    ),
  )

const workflowModuleText = () => `
export default {
  workflowId: "workflow:github:test",
  name: "github test workflow",
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
