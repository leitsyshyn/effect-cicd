import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubBinding } from "../src/domain/github.ts"
import { BindingId } from "../src/domain/ids.ts"
import { deriveGitHubProjectId } from "../src/domain/project.ts"
import { GitHubApiClient } from "../src/github/api-client.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { GitHubTriggerConfig } from "../src/runtime/config.ts"

describe("GitHub source snapshots", () => {
  it.live("extracts and reuses a commit-specific tarball snapshot", () =>
    Effect.gen(function* () {
      const fixture = yield* makeArchiveFixture()
      yield* Effect.gen(function* () {
        const snapshots = yield* GitHubSourceSnapshots

        const binding = new GitHubBinding({
          bindingId: BindingId.make("binding:github:snapshot"),
          projectId: deriveGitHubProjectId(2002, "acme", "widgets"),
          provider: "github",
          installationId: 1001,
          repositoryId: 2002,
          repositoryOwner: "acme",
          repositoryName: "widgets",
          cloneUrl: "https://github.com/acme/widgets.git",
          sourceKind: "github-archive",
          branch: "main",
          workflowModulePath: "workflow.ts",
          enabled: true,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        })

        const first = yield* snapshots.acquire(binding, "refs/heads/main", fixture.commitSha)
        const second = yield* snapshots.acquire(binding, "refs/heads/main", fixture.commitSha)
        const content = yield* Effect.promise(() => Bun.file(join(first.snapshotPath, "workflow.ts")).text())

        expect(first.snapshotPath).toBe(second.snapshotPath)
        expect(first.workspacePath).toBe(first.snapshotPath)
        expect(content).toContain("workflow:github:snapshot")
      }).pipe(
        Effect.provide(
          GitHubSourceSnapshots.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(GitHubApiClient, {
                getRepository: () => Effect.die("unused"),
                downloadRepositoryArchive: () => Effect.succeed(fixture.archive),
                upsertCheckRun: () => Effect.die("unused"),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(GitHubTriggerConfig, {
                workspaceRoot: fixture.workspaceRoot,
                snapshotRetentionPerProject: 5,
              }),
            ),
          ),
        ),
        Effect.ensuring(cleanupArchiveFixture(fixture)),
      )
    }),
  )

  it.live("isolates snapshot paths by project identity", () =>
    Effect.gen(function* () {
      const fixture = yield* makeArchiveFixture()
      yield* Effect.gen(function* () {
        const snapshots = yield* GitHubSourceSnapshots

        const firstBinding = new GitHubBinding({
          bindingId: BindingId.make("binding:github:first"),
          projectId: deriveGitHubProjectId(2002, "acme", "widgets"),
          provider: "github",
          installationId: 1001,
          repositoryId: 2002,
          repositoryOwner: "acme",
          repositoryName: "widgets",
          cloneUrl: "https://github.com/acme/widgets.git",
          sourceKind: "github-archive",
          branch: "main",
          workflowModulePath: "workflow.ts",
          enabled: true,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        })
        const secondBinding = new GitHubBinding({
          ...firstBinding,
          bindingId: BindingId.make("binding:github:second"),
          projectId: deriveGitHubProjectId(3003, "acme", "widgets-fork"),
          repositoryId: 3003,
          repositoryName: "widgets-fork",
          cloneUrl: "https://github.com/acme/widgets-fork.git",
        })

        const first = yield* snapshots.acquire(firstBinding, "refs/heads/main", fixture.commitSha)
        const second = yield* snapshots.acquire(secondBinding, "refs/heads/main", fixture.commitSha)

        expect(first.snapshotPath).not.toBe(second.snapshotPath)
        expect(first.snapshotPath).toContain("github")
        expect(first.snapshotPath).toContain("project_github_repo_2002")
        expect(second.snapshotPath).toContain("project_github_repo_3003")
      }).pipe(
        Effect.provide(
          GitHubSourceSnapshots.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(GitHubApiClient, {
                getRepository: () => Effect.die("unused"),
                downloadRepositoryArchive: () => Effect.succeed(fixture.archive),
                upsertCheckRun: () => Effect.die("unused"),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(GitHubTriggerConfig, {
                workspaceRoot: fixture.workspaceRoot,
                snapshotRetentionPerProject: 5,
              }),
            ),
          ),
        ),
        Effect.ensuring(cleanupArchiveFixture(fixture)),
      )
    }),
  )
})

interface ArchiveFixture {
  readonly workspaceRoot: string
  readonly archive: Uint8Array
  readonly commitSha: string
  readonly root: string
}

const makeArchiveFixture = () =>
  Effect.promise(async () => {
    const root = await mkdtemp(join(tmpdir(), "effect-cicd-github-archive-"))
    const archiveSource = join(root, "archive-source")
    const snapshotRoot = join(archiveSource, "acme-widgets-sha")
    const archivePath = join(root, "snapshot.tar.gz")
    const workspaceRoot = join(root, "cache")

    await mkdir(snapshotRoot, { recursive: true })
    await Bun.write(join(snapshotRoot, "workflow.ts"), workflowModuleText())
    await runTar(["tar", "-czf", archivePath, "-C", archiveSource, "acme-widgets-sha"])

    return {
      workspaceRoot,
      archive: new Uint8Array(await Bun.file(archivePath).arrayBuffer()),
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      root,
    }
  })

const cleanupArchiveFixture = (fixture: ArchiveFixture) =>
  Effect.promise(() => rm(fixture.root, { recursive: true, force: true }).catch(() => undefined))

const runTar = async (cmd: ReadonlyArray<string>) => {
  const process = Bun.spawn({ cmd: [...cmd], stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim().length > 0 ? stderr.trim() : stdout.trim() || `tar exited with code ${exitCode}`)
  }
}

const workflowModuleText = () => `
export default {
  workflowId: "workflow:github:snapshot",
  name: "snapshot workflow",
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
