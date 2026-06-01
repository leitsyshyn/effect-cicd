import { createHmac, timingSafeEqual } from "node:crypto"
import { resolve as resolvePath } from "node:path"

import { Effect, Layer, Redacted, Schema } from "effect"
import * as Context from "effect/Context"

import {
  DomainError,
  GitHubBindingRejected,
  GitHubConfigMissing,
  GitHubWebhookUnauthorized,
  SourceAcquisitionFailed,
} from "../domain/errors.ts"
import {
  GitHubBinding,
  GitHubBindingCreateRequest,
  GitHubBindingSummary,
  GitHubInstallationRepositoriesWebhookPayload,
  GitHubInstallationWebhookPayload,
  GitHubPushWebhookPayload,
  GitHubTriggeredRun,
  GitHubTriggerResponse,
} from "../domain/github.ts"
import { BindingId } from "../domain/ids.ts"
import { NormalizedWorkflowDefinition, SourceMetadata } from "../domain/workflow-definition.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { Engine } from "../engine/interface.ts"
import { GitHubAppConfig } from "../runtime/config.ts"
import { GitHubApiClient } from "./api-client.ts"
import { GitHubBindingStore } from "./binding-store.ts"
import { GitHubCheckRuns } from "./check-runs.ts"
import { GitHubSourceSnapshots } from "./source-snapshots.ts"

export interface GitHubTriggerRequest {
  readonly event: string | null
  readonly signature: string | null
  readonly deliveryId?: string | null
  readonly rawBody: string
}

export class GitHubIntegration extends Context.Service<
  GitHubIntegration,
  {
    readonly addBinding: (request: GitHubBindingCreateRequest) => Effect.Effect<GitHubBindingSummary, DomainError>
    readonly listBindings: () => Effect.Effect<ReadonlyArray<GitHubBindingSummary>, DomainError>
    readonly handleWebhook: (request: GitHubTriggerRequest) => Effect.Effect<GitHubTriggerResponse, DomainError>
    readonly triggerPush: (request: GitHubTriggerRequest) => Effect.Effect<GitHubTriggerResponse, DomainError>
  }
>()("@effect-cicd/github/GitHubIntegration") {
  static readonly layer = Layer.effect(
    GitHubIntegration,
    Effect.gen(function* () {
      const bindingStore = yield* GitHubBindingStore
      const gitHubApi = yield* GitHubApiClient
      const gitHubChecks = yield* GitHubCheckRuns
      const sourceSnapshots = yield* GitHubSourceSnapshots
      const loader = yield* WorkflowModuleLoader
      const materializer = yield* DslMaterializer
      const engine = yield* Engine
      const appConfig = yield* GitHubAppConfig

      const addBinding = Effect.fn("GitHubIntegration.addBinding")(
        function* (request: GitHubBindingCreateRequest) {
          const { repositoryOwner, repositoryName } = yield* parseRepository(request.repository)
          const workflowModulePath = yield* normalizeRepositoryPath(request.workflowModulePath, "workflow module path")
          const workspaceSubdir = yield* normalizeOptionalRepositoryPath(request.workspaceSubdir, "workspace subdir")
          const repository = yield* gitHubApi.getRepository(request.installationId, repositoryOwner, repositoryName).pipe(
            Effect.catchTag(
              "GitHubApiFailed",
              (error) =>
                Effect.fail(
                  new GitHubBindingRejected({
                    message: `Failed to resolve ${request.repository} for installation ${request.installationId}: ${error.message}`,
                  }),
                ),
            ),
          )
          const now = new Date()

          const binding = new GitHubBinding({
            bindingId: BindingId.make(`binding:github:${crypto.randomUUID()}`),
            provider: "github",
            installationId: request.installationId,
            repositoryId: repository.id,
            repositoryOwner: repository.owner,
            repositoryName: repository.name,
            cloneUrl: repository.cloneUrl,
            sourceKind: "github-archive",
            branch: normalizeOptionalBranch(request.branch),
            workflowModulePath,
            workspaceSubdir,
            enabled: request.enabled ?? true,
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

      const handleWebhook = Effect.fn("GitHubIntegration.handleWebhook")(
        function* ({ event, signature, rawBody, deliveryId }: GitHubTriggerRequest) {
          yield* verifyWebhookRequest(appConfig, rawBody, signature)

          const payload = yield* parseWebhookBody(rawBody)
          switch (event) {
            case "push": {
              const push = yield* decodeWebhookPayload<GitHubPushWebhookPayload>(GitHubPushWebhookPayload, payload)
              return yield* handlePushEvent(
                push,
                deliveryId ?? null,
                bindingStore,
                gitHubChecks,
                sourceSnapshots,
                loader,
                materializer,
                engine,
              )
            }
            case "installation": {
              const installation = yield* decodeWebhookPayload<GitHubInstallationWebhookPayload>(GitHubInstallationWebhookPayload, payload)
              return new GitHubTriggerResponse({
                event,
                action: installation.action,
                installationId: installation.installation.id,
                repository: installation.repositories?.[0]?.full_name,
                matchedBindings: 0,
                triggeredRuns: [],
                ignoredReason: "Installation event acknowledged",
              })
            }
            case "installation_repositories": {
              const installationRepositories = yield* decodeWebhookPayload<GitHubInstallationRepositoriesWebhookPayload>(
                GitHubInstallationRepositoriesWebhookPayload,
                payload,
              )
              return new GitHubTriggerResponse({
                event,
                action: installationRepositories.action,
                installationId: installationRepositories.installation.id,
                repository:
                  installationRepositories.repositories_added?.[0]?.full_name ??
                  installationRepositories.repositories_removed?.[0]?.full_name,
                matchedBindings: 0,
                triggeredRuns: [],
                ignoredReason: "Installation repositories event acknowledged",
              })
            }
            default:
              return new GitHubTriggerResponse({
                event: event ?? "unknown",
                matchedBindings: 0,
                triggeredRuns: [],
                ignoredReason: `Unsupported GitHub event: ${event ?? "missing"}`,
              })
          }
        },
      )

      const triggerPush = Effect.fn("GitHubIntegration.triggerPush")((request: GitHubTriggerRequest) => handleWebhook(request))

      return { addBinding, listBindings, handleWebhook, triggerPush }
    }),
  )
}

const handlePushEvent = (
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  bindingStore: typeof GitHubBindingStore.Service,
  gitHubChecks: typeof GitHubCheckRuns.Service,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
) =>
  Effect.gen(function* () {
    const repository = payload.repository.full_name

    if (payload.deleted === true || isZeroSha(payload.after)) {
      return new GitHubTriggerResponse({
        event: "push",
        installationId: payload.installation.id,
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
        event: "push",
        installationId: payload.installation.id,
        repository,
        ref: payload.ref,
        commitSha: payload.after,
        matchedBindings: 0,
        triggeredRuns: [],
        ignoredReason: `Unsupported Git ref: ${payload.ref}`,
      })
    }

    const matchedBindings = (yield* bindingStore.listEnabledForPush(
      payload.installation.id,
      payload.repository.id,
      payload.repository.owner.login,
      payload.repository.name,
    )).filter((binding) => binding.branch === undefined || binding.branch === branch)

    if (matchedBindings.length === 0) {
      return new GitHubTriggerResponse({
        event: "push",
        installationId: payload.installation.id,
        repository,
        ref: payload.ref,
        commitSha: payload.after,
        matchedBindings: 0,
        triggeredRuns: [],
        ignoredReason: `No enabled binding matched ${repository} on branch ${branch}`,
      })
    }

    const triggeredRuns = yield* Effect.forEach(matchedBindings, (binding) =>
      triggerBinding(binding, payload, deliveryId, gitHubChecks, sourceSnapshots, loader, materializer, engine),
    )

    return new GitHubTriggerResponse({
      event: "push",
      installationId: payload.installation.id,
      repository,
      ref: payload.ref,
      commitSha: payload.after,
      matchedBindings: matchedBindings.length,
      triggeredRuns,
    })
  })

const triggerBinding = (
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  gitHubChecks: typeof GitHubCheckRuns.Service,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
) =>
  Effect.gen(function* () {
    if (binding.installationId === undefined || binding.repositoryId === undefined) {
      return yield* new GitHubBindingRejected({
        message: `Binding ${binding.bindingId} must be recreated with a GitHub App installation id`,
      })
    }

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

    const enrichedDefinition = annotateDefinition(definition, binding, payload, deliveryId, snapshot)
    const plan = yield* engine.plan(enrichedDefinition)
    const run = yield* engine.submitRun(plan, { workspacePath: snapshot.workspacePath })
    const checkRunId = yield* gitHubChecks.registerRun(run, {
      bindingId: binding.bindingId,
      installationId: binding.installationId,
      repositoryId: binding.repositoryId,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
      workflowModulePath: binding.workflowModulePath,
      ref: payload.ref,
      commitSha: payload.after,
      ...(branchNameFromRef(payload.ref) === undefined ? {} : { branch: branchNameFromRef(payload.ref)! }),
      ...(deliveryId === null || deliveryId === undefined ? {} : { deliveryId }),
    })

    return new GitHubTriggeredRun({
      bindingId: binding.bindingId,
      runId: run.runId,
      workflowId: run.workflowId,
      workflowName: run.execution.plan.workflowName,
      checkRunId,
      snapshotPath: snapshot.snapshotPath,
      workspacePath: snapshot.workspacePath,
    })
  })

const annotateDefinition = (
  definition: NormalizedWorkflowDefinition,
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  snapshot: { readonly snapshotPath: string; readonly workspacePath: string },
) =>
  new NormalizedWorkflowDefinition({
    ...definition,
    metadata: {
      ...definition.metadata,
      trigger: {
        provider: "github",
        bindingId: binding.bindingId,
        installationId: binding.installationId,
        repositoryId: binding.repositoryId,
        repository: payload.repository.full_name,
        ref: payload.ref,
        branch: branchNameFromRef(payload.ref),
        commitSha: payload.after,
        deliveryId: deliveryId ?? undefined,
      },
      sourceSnapshot: {
        cloneUrl: binding.cloneUrl,
        sourceKind: binding.sourceKind,
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
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    repository: `${binding.repositoryOwner}/${binding.repositoryName}`,
    cloneUrl: binding.cloneUrl,
    sourceKind: binding.sourceKind,
    branch: binding.branch,
    workflowModulePath: binding.workflowModulePath,
    workspaceSubdir: binding.workspaceSubdir,
    enabled: binding.enabled,
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

const parseWebhookBody = (rawBody: string) =>
  Effect.try({
    try: () => JSON.parse(rawBody) as unknown,
    catch: (error) =>
      new GitHubBindingRejected({
        message: error instanceof Error ? error.message : String(error),
      }),
  })

const decodeWebhookPayload = <A>(schema: any, value: unknown): Effect.Effect<A, GitHubBindingRejected> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value) as A,
    catch: (error) =>
      new GitHubBindingRejected({
        message: error instanceof Error ? error.message : String(error),
      }),
  })

const verifyWebhookRequest = (config: typeof GitHubAppConfig.Service, rawBody: string, signature: string | null) =>
  config.webhookSecret === undefined
    ? Effect.fail(
        new GitHubConfigMissing({
          setting: "GITHUB_WEBHOOK_SECRET",
          message: "GITHUB_WEBHOOK_SECRET must be configured to verify GitHub webhooks",
        }),
      )
    : verifyWebhookSignature(rawBody, signature, Redacted.value(config.webhookSecret))
      ? Effect.void
      : Effect.fail(
          new GitHubWebhookUnauthorized({
            repository: "unknown",
            message: "GitHub webhook signature verification failed",
          }),
        )

export const verifyWebhookSignature = (body: string, signature: string | null, secret: string) => {
  if (signature === null || !signature.startsWith("sha256=")) {
    return false
  }

  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export const branchNameFromRef = (ref: string) => (ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined)

const isZeroSha = (commitSha: string) => /^0+$/.test(commitSha)
