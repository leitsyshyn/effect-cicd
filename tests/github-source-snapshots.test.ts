import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitHubBinding } from "../src/domain/github.ts"
import { BindingId } from "../src/domain/ids.ts"
import { GitHubSourceSnapshots } from "../src/github/source-snapshots.ts"
import { GitHubTriggerConfig } from "../src/runtime/config.ts"

describe("GitHub source snapshots", () => {
  it.live("clones and reuses a commit-specific snapshot", () =>
    Effect.gen(function* () {
      const fixture = yield* makeGitRepositoryFixture()
      yield* Effect.gen(function* () {
        const snapshots = yield* GitHubSourceSnapshots

        const binding = new GitHubBinding({
          bindingId: BindingId.make("binding:github:snapshot"),
          provider: "github",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          cloneUrl: fixture.repositoryPath,
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
            Layer.provide(
              Layer.succeed(GitHubTriggerConfig, {
                workspaceRoot: fixture.workspaceRoot,
              }),
            ),
          ),
        ),
        Effect.ensuring(cleanupGitRepositoryFixture(fixture)),
      )
    }),
  )
})

interface GitRepositoryFixture {
  readonly repositoryPath: string
  readonly workspaceRoot: string
  readonly commitSha: string
}

const makeGitRepositoryFixture = () =>
  Effect.promise(async () => {
    const root = await mkdtemp(join(tmpdir(), "effect-cicd-git-source-"))
    const repositoryPath = join(root, "repository")
    const workspaceRoot = join(root, "cache")

    await mkdir(repositoryPath, { recursive: true })
    await Bun.write(join(repositoryPath, "workflow.ts"), workflowModuleText())
    await runGit(["git", "init", "-b", "main"], repositoryPath)
    await runGit(["git", "config", "user.email", "tests@example.com"], repositoryPath)
    await runGit(["git", "config", "user.name", "Tests"], repositoryPath)
    await runGit(["git", "add", "workflow.ts"], repositoryPath)
    await runGit(["git", "commit", "-m", "initial"], repositoryPath)
    const commitSha = await runGit(["git", "rev-parse", "HEAD"], repositoryPath)

    return { repositoryPath, workspaceRoot, commitSha: commitSha.trim() }
  })

const cleanupGitRepositoryFixture = (fixture: GitRepositoryFixture) =>
  Effect.promise(() => rm(join(fixture.repositoryPath, ".."), { recursive: true, force: true }).catch(() => undefined))

const runGit = async (cmd: ReadonlyArray<string>, cwd: string) => {
  const process = Bun.spawn({ cmd: [...cmd], cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim().length > 0 ? stderr.trim() : stdout.trim() || `git exited with code ${exitCode}`)
  }

  return stdout
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
