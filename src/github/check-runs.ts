import { Effect, Layer, Stream } from "effect"
import * as Context from "effect/Context"

import { DomainError } from "../domain/errors.ts"
import { GitHubRunLink } from "../domain/github.ts"
import { BindingId, RunId } from "../domain/ids.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"
import { Engine } from "../engine/interface.ts"
import { RunUpdate, RunUpdates } from "../engine/run-updates.ts"
import { GitHubAppConfig } from "../runtime/config.ts"
import { GitHubApiClient } from "./api-client.ts"
import { GitHubRunLinkStore } from "./run-link-store.ts"

export interface GitHubRunRegistration {
  readonly bindingId: BindingId
  readonly installationId: number
  readonly repositoryId: number
  readonly repositoryOwner: string
  readonly repositoryName: string
  readonly workflowModulePath: string
  readonly ref: string
  readonly branch?: string
  readonly commitSha: string
  readonly deliveryId?: string
}

export interface GitHubCheckLifecycle {
  readonly status: "queued" | "in_progress" | "completed"
  readonly conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required"
  readonly title: string
  readonly summary: string
}

export class GitHubCheckRuns extends Context.Service<
  GitHubCheckRuns,
  {
    readonly registerRun: (
      run: WorkflowRunState,
      registration: GitHubRunRegistration,
    ) => Effect.Effect<number | undefined, DomainError>
    readonly syncRun: (runId: RunId) => Effect.Effect<void, DomainError>
    readonly watchRunUpdates: Effect.Effect<void, never, never>
  }
>()("@effect-cicd/github/GitHubCheckRuns") {
  static readonly layer = Layer.effect(
    GitHubCheckRuns,
    Effect.gen(function* () {
      const config = yield* GitHubAppConfig
      const engine = yield* Engine
      const runLinks = yield* GitHubRunLinkStore
      const gitHubApi = yield* GitHubApiClient
      const runUpdates = yield* RunUpdates

      const registerRun = Effect.fn("GitHubCheckRuns.registerRun")(
        function* (run: WorkflowRunState, registration: GitHubRunRegistration) {
          const now = new Date()
          const link = new GitHubRunLink({
            runId: run.runId,
            bindingId: registration.bindingId,
            provider: "github",
            installationId: registration.installationId,
            repositoryId: registration.repositoryId,
            repositoryOwner: registration.repositoryOwner,
            repositoryName: registration.repositoryName,
            workflowModulePath: registration.workflowModulePath,
            ref: registration.ref,
            branch: registration.branch,
            commitSha: registration.commitSha,
            deliveryId: registration.deliveryId,
            createdAt: now,
            updatedAt: now,
          })

          yield* runLinks.create(link)
          const initialCheckRunId = yield* ensureCheckRun(run, link)
          const currentRun = yield* engine.inspectRun(run.runId).pipe(Effect.catch(() => Effect.succeed(run)))

          if (currentRun.status === run.status) {
            return initialCheckRunId
          }

          return yield* ensureCheckRun(
            currentRun,
            new GitHubRunLink({
              ...link,
              ...(initialCheckRunId === undefined ? {} : { checkRunId: initialCheckRunId }),
              updatedAt: new Date(),
            }),
          )
        },
      )

      const syncRun = Effect.fn("GitHubCheckRuns.syncRun")(function* (runId: RunId) {
        const link = yield* runLinks.get(runId)
        if (link === undefined) {
          return
        }

        const run = yield* engine.inspectRun(runId)
        yield* ensureCheckRun(run, link)
      })

      const ensureCheckRun = (run: WorkflowRunState, link: GitHubRunLink) =>
        Effect.gen(function* () {
          const lifecycle = toGitHubCheckLifecycle(run)

          const checkRunId = yield* gitHubApi.upsertCheckRun({
            installationId: link.installationId,
            repositoryOwner: link.repositoryOwner,
            repositoryName: link.repositoryName,
            name: run.execution.plan.workflowName,
            headSha: link.commitSha,
            externalId: run.runId,
            status: lifecycle.status,
            title: lifecycle.title,
            summary: lifecycle.summary,
            ...(link.checkRunId === undefined ? {} : { checkRunId: link.checkRunId }),
            ...(buildDetailsUrl(config.publicBaseUrl, run.runId) === undefined
              ? {}
              : { detailsUrl: buildDetailsUrl(config.publicBaseUrl, run.runId)! }),
            ...(lifecycle.conclusion === undefined ? {} : { conclusion: lifecycle.conclusion }),
          })

          if (link.checkRunId !== checkRunId || lifecycle.status === "completed") {
            yield* runLinks.update(
              new GitHubRunLink({
                ...link,
                checkRunId,
                updatedAt: new Date(),
              }),
            )
          }

          return checkRunId
        })

      const watchRunUpdates = Stream.runForEach(runUpdates.stream(), (update: RunUpdate) =>
        syncRun(update.runId).pipe(Effect.catch(() => Effect.void)),
      )

      return {
        registerRun,
        syncRun,
        watchRunUpdates,
      }
    }),
  )
}

export const toGitHubCheckLifecycle = (run: WorkflowRunState): GitHubCheckLifecycle => {
  const failedUnit = run.units.find((unit) => unit.status === "failed")
  const interruptedUnit = run.units.find((unit) => unit.status === "interrupted")

  switch (run.status) {
    case "created":
      return {
        status: "queued",
        title: "Workflow queued",
        summary: `Run ${run.runId} is queued.`,
      }
    case "running":
    case "canceling":
      return {
        status: "in_progress",
        title: run.status === "canceling" ? "Workflow canceling" : "Workflow running",
        summary: renderRunSummary(run, failedUnit),
      }
    case "succeeded":
      return {
        status: "completed",
        conclusion: "success",
        title: "Workflow succeeded",
        summary: renderRunSummary(run, failedUnit),
      }
    case "failed":
      return {
        status: "completed",
        conclusion: inferFailureConclusion(run),
        title: "Workflow failed",
        summary: renderRunSummary(run, failedUnit),
      }
    case "timed_out":
      return {
        status: "completed",
        conclusion: "timed_out",
        title: "Workflow timed out",
        summary: renderRunSummary(run, failedUnit),
      }
    case "canceled":
      return {
        status: "completed",
        conclusion: "cancelled",
        title: "Workflow canceled",
        summary: renderRunSummary(run, failedUnit),
      }
    case "interrupted":
      return {
        status: "completed",
        conclusion: "neutral",
        title: "Workflow interrupted",
        summary: renderRunSummary(run, interruptedUnit ?? failedUnit),
      }
  }
}

const inferFailureConclusion = (run: WorkflowRunState) => {
  const message = run.failure?.message?.toLowerCase() ?? ""
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timed_out" as const
  }

  return "failure" as const
}

const renderRunSummary = (run: WorkflowRunState, failedUnit?: WorkflowRunState["units"][number]) => {
  const lines = [
    `Status: ${run.status}`,
    `Run: ${run.runId}`,
    `Progress: ${run.progress.completedUnits}/${run.progress.totalUnits} completed, ${run.progress.failedUnits} failed, ${run.progress.skippedUnits} skipped`,
  ]

  if (failedUnit !== undefined) {
    lines.push(`Failed unit: ${failedUnit.unitId}`)
    if (failedUnit.failure?.message !== undefined) {
      lines.push(`Failure: ${failedUnit.failure.message}`)
    }
  } else if (run.failure?.message !== undefined) {
    lines.push(`Failure: ${run.failure.message}`)
  }

  return lines.join("\n")
}

const buildDetailsUrl = (publicBaseUrl: string | undefined, runId: string) =>
  publicBaseUrl === undefined ? undefined : new URL(`/runs/${encodeURIComponent(runId)}`, ensureTrailingSlash(publicBaseUrl)).toString()

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)
