import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { createHmac } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubBindingCreateRequest, GitHubPushWebhookPayload, GitHubRepositorySnapshot } from "../src/domain/github.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../src/dsl/index.ts"
import { Engine } from "../src/engine/interface.ts"
import { WorkflowRunState } from "../src/domain/runtime-state.ts"
import { GitHubBindingStore } from "../src/github/binding-store.ts"
import { GitHubIntegration } from "../src/github/integration.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { makeInMemoryServiceEngineLayer } from "../src/runtime/layers.ts"

describe("GitHub integration", () => {
  it.effect("creates and lists persisted bindings", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration

        const created = yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            branch: "main",
            workflowModulePath: "workflow.ts",
            workspaceSubdir: "packages/app",
            webhookSecret: "top-secret",
          }),
        )
        const bindings = yield* service.listBindings()

        expect(created.repository).toBe("acme/widgets")
        expect(created.branch).toBe("main")
        expect(created.workflowModulePath).toBe("workflow.ts")
        expect(created.workspaceSubdir).toBe("packages/app")
        expect(created.hasWebhookSecret).toBe(true)
        expect(bindings).toHaveLength(1)
        expect(bindings[0]?.bindingId).toBe(created.bindingId)
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )

  it.effect("rejects unsigned pushes when the binding requires a webhook secret", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration

        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            branch: "main",
            workflowModulePath: "workflow.ts",
            webhookSecret: "top-secret",
          }),
        )

        const result = yield* service
          .triggerPush({
            event: "push",
            signature: null,
            rawBody: JSON.stringify(samplePushPayload()),
            payload: samplePushPayload(),
          })
          .pipe(Effect.exit)

        expect(result._tag).toBe("Failure")
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )

  it.effect("resolves bindings, verifies signatures, and submits a run", () =>
    Effect.gen(function* () {
      const fixture = yield* makeWorkflowSnapshotFixture()
      yield* Effect.gen(function* () {
        const service = yield* GitHubIntegration
        const engine = yield* Engine

        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            branch: "main",
            workflowModulePath: "workflow.ts",
            webhookSecret: "top-secret",
          }),
        )
        yield* service.addBinding(
          new GitHubBindingCreateRequest({
            repository: "acme/widgets",
            branch: "release",
            workflowModulePath: "workflow.ts",
          }),
        )

        const rawBody = JSON.stringify(samplePushPayload())
        const response = yield* service.triggerPush({
          event: "push",
          signature: `sha256=${createHmac("sha256", "top-secret").update(rawBody).digest("hex")}`,
          rawBody,
          payload: samplePushPayload(),
        })
        const runId = response.triggeredRuns[0]?.runId

        expect(response.matchedBindings).toBe(1)
        expect(response.triggeredRuns).toHaveLength(1)
        expect(runId).toBeDefined()

        const run = yield* waitForTerminalRun(engine, runId!)

        expect(run.status).toBe("succeeded")
        expect(run.execution.options.workspacePath).toBe(fixture.workspacePath)
        expect((run.execution.plan.metadata as Record<string, any>).trigger.commitSha).toBe(samplePushPayload().after)
      }).pipe(Effect.provide(gitHubIntegrationLayer(fixture)), Effect.ensuring(cleanupFixture(fixture)))
    }),
  )
})

const gitHubIntegrationLayer = (fixture: WorkflowFixture) => {
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
  )
}

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
    repository: {
      name: "widgets",
      full_name: "acme/widgets",
      clone_url: "https://github.com/acme/widgets.git",
      owner: { login: "acme" },
    },
  })

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
