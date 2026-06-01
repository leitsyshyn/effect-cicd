import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { dirname, resolve as resolvePath } from "node:path"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"

import { SourceAcquisitionFailed } from "../domain/errors.ts"
import { GitHubBinding, GitHubRepositorySnapshot } from "../domain/github.ts"
import { sanitizeProjectPathSegment } from "../domain/project.ts"
import { GitHubTriggerConfig } from "../runtime/config.ts"
import { GitHubApiClient } from "./api-client.ts"

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
      const gitHubApi = yield* GitHubApiClient

      const acquire = Effect.fn("GitHubSourceSnapshots.acquire")(
        function* (binding: GitHubBinding, ref: string, commitSha: string) {
          const repository = `${binding.repositoryOwner}/${binding.repositoryName}`
          const projectRoot = resolvePath(config.workspaceRoot, binding.provider, sanitizeProjectPathSegment(binding.projectId))
          const snapshotPath = resolvePath(projectRoot, commitSha)
          const workspacePath =
            binding.workspaceSubdir === undefined ? snapshotPath : resolvePath(snapshotPath, binding.workspaceSubdir)

          if (!(yield* pathExists(snapshotPath))) {
            yield* materializeSnapshot(gitHubApi, binding, repository, ref, commitSha, snapshotPath)
            yield* pruneSnapshots(projectRoot, snapshotPath, config.snapshotRetentionPerProject)
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
            projectId: binding.projectId,
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

const materializeSnapshot = (
  gitHubApi: typeof GitHubApiClient.Service,
  binding: GitHubBinding,
  repository: string,
  ref: string,
  commitSha: string,
  snapshotPath: string,
) =>
  Effect.tryPromise({
    try: async () => {
      if (binding.installationId === undefined) {
        throw new Error(`GitHub binding ${binding.bindingId} is missing installationId`)
      }

      const tempRoot = `${snapshotPath}.tmp-${crypto.randomUUID()}`
      const extractPath = resolvePath(tempRoot, "snapshot")
      const archivePath = resolvePath(tempRoot, "archive.tar.gz")

      await mkdir(dirname(snapshotPath), { recursive: true })
      await rm(tempRoot, { recursive: true, force: true })

      try {
        const archive = await Effect.runPromise(
          gitHubApi.downloadRepositoryArchive(
            binding.installationId,
            binding.repositoryOwner,
            binding.repositoryName,
            commitSha,
          ),
        )

        await mkdir(extractPath, { recursive: true })
        await Bun.write(archivePath, archive)
        await runTarExtraction(archivePath, extractPath)

        try {
          await rename(extractPath, snapshotPath)
        } catch (error) {
          if (!(await pathExists(snapshotPath))) {
            throw error
          }
        }
      } catch (error) {
        await rm(tempRoot, { recursive: true, force: true })
        throw error
      } finally {
        await rm(tempRoot, { recursive: true, force: true })
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

const runTarExtraction = async (archivePath: string, targetPath: string) => {
  const process = Bun.spawn({
    cmd: ["tar", "-xzf", archivePath, "-C", targetPath, "--strip-components", "1"],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...processEnv,
    },
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim().length > 0 ? stderr.trim() : stdout.trim() || `tar exited with code ${exitCode}`)
  }
}

const pathExists = (path: string) =>
  Effect.promise(() =>
    stat(path)
      .then(() => true)
      .catch(() => false),
  )

const processEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
)

const pruneSnapshots = (projectRoot: string, currentSnapshotPath: string, retentionCount: number) =>
  Effect.promise(async () => {
    try {
      if (retentionCount < 1) {
        return
      }

      const entries = await readdir(projectRoot).catch(() => [])
      const snapshots = await Promise.all(
        entries.map(async (entry) => {
          const snapshotPath = resolvePath(projectRoot, entry)
          const stats = await stat(snapshotPath).catch(() => undefined)

          return stats?.isDirectory() ? { path: snapshotPath, modifiedAt: stats.mtimeMs } : undefined
        }),
      )

      const staleEntries = snapshots
        .filter(
          (entry): entry is { readonly path: string; readonly modifiedAt: number } => entry !== undefined && entry.path !== currentSnapshotPath,
        )
        .sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path))
        .slice(Math.max(retentionCount - 1, 0))

      await Promise.all(staleEntries.map((entry) => rm(entry.path, { recursive: true, force: true })))
    } catch {
      return
    }
  })

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
