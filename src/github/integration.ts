import { createHmac, timingSafeEqual } from "node:crypto"
import { resolve as resolvePath } from "node:path"

import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { DomainError } from "../domain/errors.ts"
import { GitHubBindingRejected, GitHubWebhookUnauthorized, SourceAcquisitionFailed } from "../domain/errors.ts"
import {
  GitHubBinding,
  GitHubBindingCreateRequest,
  GitHubBindingSummary,
  GitHubPushWebhookPayload,
  GitHubTriggeredRun,
  GitHubTriggerResponse,
} from "../domain/github.ts"
import { BindingId } from "../domain/ids.ts"
import { NormalizedWorkflowDefinition, SourceMetadata } from "../domain/workflow-definition.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { Engine } from "../engine/interface.ts"
import { GitHubBindingStore } from "./binding-store.ts"
import { GitHubSourceSnapshots } from "./source-snapshots.ts"

export interface GitHubTriggerRequest {
  readonly event: string | null
  readonly signature: string | null
  readonly rawBody: string
  readonly payload: GitHubPushWebhookPayload
}

export class GitHubIntegration extends Context.Service<
  GitHubIntegration,
  {
    readonly addBinding: (request: GitHubBindingCreateRequest) => Effect.Effect<GitHubBindingSummary, DomainError>
    readonly listBindings: () => Effect.Effect<ReadonlyArray<GitHubBindingSummary>, DomainError>
    readonly triggerPush: (request: GitHubTriggerRequest) => Effect.Effect<GitHubTriggerResponse, DomainError>
  }
>()("@effect-cicd/github/GitHubIntegration") {
  static readonly layer = Layer.effect(
    GitHubIntegration,
    Effect.gen(function* () {
      const bindingStore = yield* GitHubBindingStore
      const sourceSnapshots = yield* GitHubSourceSnapshots
      const loader = yield* WorkflowModuleLoader
      const materializer = yield* DslMaterializer
      const engine = yield* Engine

      const addBinding = Effect.fn("GitHubIntegration.addBinding")(
        function* (request: GitHubBindingCreateRequest) {
          const { repositoryOwner, repositoryName } = yield* parseRepository(request.repository)
          const workflowModulePath = yield* normalizeRepositoryPath(request.workflowModulePath, "workflow module path")
          const workspaceSubdir = yield* normalizeOptionalRepositoryPath(request.workspaceSubdir, "workspace subdir")
          const now = new Date()

          const binding = new GitHubBinding({
            bindingId: BindingId.make(`binding:github:${crypto.randomUUID()}`),
            provider: "github",
            repositoryOwner,
            repositoryName,
            cloneUrl: normalizeCloneUrl(request.cloneUrl, repositoryOwner, repositoryName),
            branch: normalizeOptionalBranch(request.branch),
            workflowModulePath,
            workspaceSubdir,
            enabled: request.enabled ?? true,
            webhookSecret: normalizeOptionalText(request.webhookSecret),
            accessToken: normalizeOptionalText(request.accessToken),
            createdAt: now,
            updatedAt: now,
          })

          yield* bindingStore.create(binding)
          return toBindingSummary(binding)
        },
      )

      const listBindings = Effect.fn("GitHubIntegration.listBindings")(function* () {
        const bindings = yield* bindingStore.list()
        return bindings.map(toBindingSummary)
      })

      const triggerPush = Effect.fn("GitHubIntegration.triggerPush")(
        function* ({ event, signature, rawBody, payload }: GitHubTriggerRequest) {
          const repository = payload.repository.full_name

          if (event !== "push") {
            return new GitHubTriggerResponse({
              event: event ?? "unknown",
              repository,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: `Unsupported GitHub event: ${event ?? "missing"}`,
            })
          }

          if (payload.deleted === true || isZeroSha(payload.after)) {
            return new GitHubTriggerResponse({
              event,
              repository,
              ref: payload.ref,
              commitSha: payload.after,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: "Branch delete pushes are ignored",
            })
          }

          const branch = branchNameFromRef(payload.ref)
          if (branch === undefined) {
            return new GitHubTriggerResponse({
              event,
              repository,
              ref: payload.ref,
              commitSha: payload.after,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: `Unsupported Git ref: ${payload.ref}`,
            })
          }

          const matchedBindings = (yield* bindingStore.listEnabledForRepository(payload.repository.owner.login, payload.repository.name)).filter(
            (binding) => binding.branch === undefined || binding.branch === branch,
          )

          if (matchedBindings.length === 0) {
            return new GitHubTriggerResponse({
              event,
              repository,
              ref: payload.ref,
              commitSha: payload.after,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: `No enabled binding matched ${repository} on branch ${branch}`,
            })
          }

          const authorizedBindings = matchedBindings.filter(
            (binding) => binding.webhookSecret === undefined || verifySignature(rawBody, signature, binding.webhookSecret),
          )

          if (authorizedBindings.length === 0 && matchedBindings.some((binding) => binding.webhookSecret !== undefined)) {
            return yield* new GitHubWebhookUnauthorized({
              repository,
              message: `Webhook signature verification failed for ${repository}`,
            })
          }

          const triggeredRuns = yield* Effect.forEach(authorizedBindings, (binding) =>
            triggerBinding(binding, payload, sourceSnapshots, loader, materializer, engine),
          )

          return new GitHubTriggerResponse({
            event,
            repository,
            ref: payload.ref,
            commitSha: payload.after,
            matchedBindings: matchedBindings.length,
            triggeredRuns,
            ignoredReason:
              triggeredRuns.length === 0 ? `No binding was authorized for ${repository} on branch ${branch}` : undefined,
          })
        },
      )

      return { addBinding, listBindings, triggerPush }
    }),
  )
}

const triggerBinding = (
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
) =>
  Effect.gen(function* () {
    const snapshot = yield* sourceSnapshots.acquire(binding, payload.ref, payload.after)
    const workflowModulePath = resolvePath(snapshot.snapshotPath, binding.workflowModulePath)
    const repository = payload.repository.full_name

    const authored = yield* loader.load(workflowModulePath).pipe(
      Effect.mapError(
        (error) =>
          new SourceAcquisitionFailed({
            repository,
            ref: payload.ref,
            commitSha: payload.after,
            bindingId: binding.bindingId,
            message: `Failed to load workflow module ${binding.workflowModulePath}: ${error.message}`,
          }),
      ),
    )
    const definition = yield* materializer.materialize(authored).pipe(
      Effect.mapError(
        (error) =>
          new SourceAcquisitionFailed({
            repository,
            ref: payload.ref,
            commitSha: payload.after,
            bindingId: binding.bindingId,
            message: `Failed to materialize workflow module ${binding.workflowModulePath}: ${error.message}`,
          }),
      ),
    )
    const enrichedDefinition = annotateDefinition(definition, binding, payload, snapshot)
    const plan = yield* engine.plan(enrichedDefinition)
    const run = yield* engine.submitRun(plan, { workspacePath: snapshot.workspacePath })

    return new GitHubTriggeredRun({
      bindingId: binding.bindingId,
      runId: run.runId,
      workflowId: run.workflowId,
      workflowName: run.execution.plan.workflowName,
      snapshotPath: snapshot.snapshotPath,
      workspacePath: snapshot.workspacePath,
    })
  })

const annotateDefinition = (
  definition: NormalizedWorkflowDefinition,
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  snapshot: { readonly snapshotPath: string; readonly workspacePath: string },
) =>
  new NormalizedWorkflowDefinition({
    ...definition,
    metadata: {
      ...definition.metadata,
      trigger: {
        provider: "github",
        bindingId: binding.bindingId,
        repository: payload.repository.full_name,
        ref: payload.ref,
        branch: branchNameFromRef(payload.ref),
        commitSha: payload.after,
      },
      sourceSnapshot: {
        cloneUrl: binding.cloneUrl,
        workflowModulePath: binding.workflowModulePath,
        snapshotPath: snapshot.snapshotPath,
        workspacePath: snapshot.workspacePath,
      },
    },
    source: mergeSourceMetadata(definition.source, binding, payload),
  })

const mergeSourceMetadata = (
  source: SourceMetadata | undefined,
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
) =>
  new SourceMetadata({
    ...(source ?? {}),
    file: source?.file ?? binding.workflowModulePath,
    origin: `github:${payload.repository.full_name}@${payload.after}`,
  })

const toBindingSummary = (binding: GitHubBinding) =>
  new GitHubBindingSummary({
    bindingId: binding.bindingId,
    provider: binding.provider,
    repository: `${binding.repositoryOwner}/${binding.repositoryName}`,
    cloneUrl: binding.cloneUrl,
    branch: binding.branch,
    workflowModulePath: binding.workflowModulePath,
    workspaceSubdir: binding.workspaceSubdir,
    enabled: binding.enabled,
    hasWebhookSecret: binding.webhookSecret !== undefined,
    accessMode: binding.accessToken === undefined ? "anonymous" : "token",
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  })

const parseRepository = (repository: string) => {
  const trimmed = repository.trim()
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed)

  if (match === null) {
    return Effect.fail(
      new GitHubBindingRejected({
        message: `Repository must be in owner/name format: ${repository}`,
      }),
    )
  }

  return Effect.succeed({ repositoryOwner: match[1]!, repositoryName: match[2]! })
}

const normalizeRepositoryPath = (value: string, label: string) => {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return Effect.fail(new GitHubBindingRejected({ message: `${label} must be non-empty` }))
  }
  if (trimmed.startsWith("/") || trimmed.split("/").includes("..")) {
    return Effect.fail(new GitHubBindingRejected({ message: `${label} must stay inside the repository snapshot` }))
  }

  return Effect.succeed(trimmed.replace(/^\.\//, ""))
}

const normalizeOptionalRepositoryPath = (value: string | undefined, label: string) =>
  value === undefined ? Effect.sync((): string | undefined => undefined) : normalizeRepositoryPath(value, label)

const normalizeCloneUrl = (cloneUrl: string | undefined, repositoryOwner: string, repositoryName: string) =>
  normalizeOptionalText(cloneUrl) ?? `https://github.com/${repositoryOwner}/${repositoryName}.git`

const normalizeOptionalBranch = (branch: string | undefined) => {
  const normalized = normalizeOptionalText(branch)
  return normalized === undefined ? undefined : normalized.replace(/^refs\/heads\//, "")
}

const normalizeOptionalText = (value: string | undefined) => {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

const branchNameFromRef = (ref: string) => (ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined)

const verifySignature = (body: string, signature: string | null, secret: string) => {
  if (signature === null || !signature.startsWith("sha256=")) {
    return false
  }

  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const isZeroSha = (commitSha: string) => /^0+$/.test(commitSha)
