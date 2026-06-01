import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { dirname, resolve as resolvePath } from "node:path"
import { mkdir, rename, rm, stat } from "node:fs/promises"

import { SourceAcquisitionFailed } from "../domain/errors.ts"
import { GitHubBinding, GitHubRepositorySnapshot } from "../domain/github.ts"
import { GitHubTriggerConfig } from "../runtime/config.ts"

export class GitHubSourceSnapshots extends Context.Service<
  GitHubSourceSnapshots,
  {
    readonly acquire: (
      binding: GitHubBinding,
      ref: string,
      commitSha: string,
    ) => Effect.Effect<GitHubRepositorySnapshot, SourceAcquisitionFailed>
  }
>()("@effect-cicd/github/GitHubSourceSnapshots") {
  static readonly layer = Layer.effect(
    GitHubSourceSnapshots,
    Effect.gen(function* () {
      const config = yield* GitHubTriggerConfig

      const acquire = Effect.fn("GitHubSourceSnapshots.acquire")(
        function* (binding: GitHubBinding, ref: string, commitSha: string) {
          const repository = `${binding.repositoryOwner}/${binding.repositoryName}`
          const snapshotPath = resolvePath(
            config.workspaceRoot,
            sanitizePathSegment(binding.repositoryOwner),
            sanitizePathSegment(binding.repositoryName),
            commitSha,
          )
          const workspacePath =
            binding.workspaceSubdir === undefined ? snapshotPath : resolvePath(snapshotPath, binding.workspaceSubdir)

          if (!(yield* pathExists(snapshotPath))) {
            yield* materializeSnapshot(binding, repository, ref, commitSha, snapshotPath)
          }

          if (!(yield* pathExists(workspacePath))) {
            return yield* new SourceAcquisitionFailed({
              repository,
              ref,
              commitSha,
              bindingId: binding.bindingId,
              message: `Workspace path does not exist in snapshot: ${workspacePath}`,
            })
          }

          return new GitHubRepositorySnapshot({
            repository,
            ref,
            commitSha,
            snapshotPath,
            workspacePath,
          })
        },
      )

      return { acquire }
    }),
  )
}

const materializeSnapshot = (binding: GitHubBinding, repository: string, ref: string, commitSha: string, snapshotPath: string) =>
  Effect.tryPromise({
    try: async () => {
      const tempPath = `${snapshotPath}.tmp-${crypto.randomUUID()}`

      await mkdir(dirname(snapshotPath), { recursive: true })
      await rm(tempPath, { recursive: true, force: true })

      try {
        const branch = branchNameFromRef(ref)
        if (branch === undefined) {
          throw new Error(`Unsupported Git ref for snapshot acquisition: ${ref}`)
        }

        await runGit(cloneCommand(binding, branch, tempPath))
        await runGit(["git", "-C", tempPath, "checkout", "--detach", commitSha])
        await rename(tempPath, snapshotPath)
      } catch (error) {
        await rm(tempPath, { recursive: true, force: true })
        throw error
      }
    },
    catch: (error) =>
      new SourceAcquisitionFailed({
        repository,
        ref,
        commitSha,
        bindingId: binding.bindingId,
        message: toErrorMessage(error),
      }),
  })

const cloneCommand = (binding: GitHubBinding, branch: string, targetPath: string) => [
  "git",
  ...gitAuthArgs(binding.accessToken),
  "clone",
  "--no-checkout",
  "--depth",
  "1",
  "--branch",
  branch,
  binding.cloneUrl,
  targetPath,
]

const gitAuthArgs = (accessToken: string | undefined) => {
  if (accessToken === undefined) {
    return []
  }

  const basicAuth = Buffer.from(`x-access-token:${accessToken}`).toString("base64")
  return ["-c", `http.extraHeader=Authorization: Basic ${basicAuth}`]
}

const runGit = async (cmd: ReadonlyArray<string>) => {
  const process = Bun.spawn({
    cmd: [...cmd],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...processEnv,
      GIT_TERMINAL_PROMPT: "0",
    },
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim().length > 0 ? stderr.trim() : stdout.trim() || `git exited with code ${exitCode}`)
  }
}

const branchNameFromRef = (ref: string) => (ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined)

const pathExists = (path: string) =>
  Effect.promise(() =>
    stat(path)
      .then(() => true)
      .catch(() => false),
  )

const sanitizePathSegment = (segment: string) => segment.replace(/[^A-Za-z0-9._-]/g, "_")

const processEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
)

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
