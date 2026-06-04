import { createHmac, timingSafeEqual } from "node:crypto"
import { resolve as resolvePath } from "node:path"

import { Effect, Fiber, Layer, Redacted, Schema } from "effect"
import * as Context from "effect/Context"

import {
  DomainError,
  GitHubBindingNotFound,
  GitHubBindingRejected,
  GitHubConfigMissing,
  GitHubWebhookUnauthorized,
  SourceAcquisitionFailed,
} from "../domain/errors.ts"
import {
  GitHubBinding,
  GitHubBindingCreateRequest,
  GitHubBindingSummary,
  GitHubInstallationRepository,
  GitHubInstallationRepositoriesWebhookPayload,
  GitHubInstallationWebhookPayload,
  GitHubPushWebhookPayload,
  GitHubTriggeredRun,
  GitHubTriggerResponse,
  GitHubTriggerDelivery,
} from "../domain/github.ts"
import { BindingId } from "../domain/ids.ts"
import { ProjectSummary, deriveGitHubProjectId } from "../domain/project.ts"
import { GitHubPushTriggerDeclaration, NormalizedWorkflowDefinition, SourceMetadata } from "../domain/workflow-definition.ts"
import { DslMaterializer, WorkflowModuleLoader } from "../dsl/index.ts"
import { Engine } from "../engine/interface.ts"
import { GitHubAppConfig } from "../runtime/config.ts"
import { GitHubApiClient } from "./api-client.ts"
import { GitHubBindingStore } from "./binding-store.ts"
import { GitHubCheckRuns } from "./check-runs.ts"
import { GitHubRunLinkStore } from "./run-link-store.ts"
import { GitHubSourceSnapshots } from "./source-snapshots.ts"
import { GitHubTriggerDeliveryStore } from "./trigger-delivery-store.ts"

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
    readonly deleteBinding: (bindingId: string) => Effect.Effect<void, DomainError>
    readonly listBindings: () => Effect.Effect<ReadonlyArray<GitHubBindingSummary>, DomainError>
    readonly listInstallationRepositories: (installationId: number) => Effect.Effect<ReadonlyArray<GitHubInstallationRepository>, DomainError>
    readonly listRepositoryBranches: (installationId: number, repository: string) => Effect.Effect<ReadonlyArray<string>, DomainError>
    readonly listRepositoryWorkflowFiles: (installationId: number, repository: string, ref?: string) => Effect.Effect<ReadonlyArray<string>, DomainError>
    readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectSummary>, DomainError>
    readonly acceptWebhook: (request: GitHubTriggerRequest) => Effect.Effect<GitHubTriggerResponse, DomainError>
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
      const runLinkStore = yield* GitHubRunLinkStore
      const triggerDeliveryStore = yield* GitHubTriggerDeliveryStore
      const inflightTriggers = new Map<string, Fiber.Fiber<GitHubTriggeredRun | undefined, DomainError>>()

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
          const projectId = deriveGitHubProjectId(repository.id, repository.owner, repository.name)
          const existingProjectName = (yield* bindingStore.list()).find((binding) => binding.projectId === projectId)?.name
          const name = existingProjectName?.trim().length ? existingProjectName.trim() : repository.fullName

          const binding = new GitHubBinding({
            bindingId: BindingId.make(`binding:github:${crypto.randomUUID()}`),
            projectId,
            name,
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

      const deleteBinding = Effect.fn("GitHubIntegration.deleteBinding")(function* (bindingId: string) {
        const bindings = yield* bindingStore.list()
        const binding = bindings.find((b) => b.bindingId === bindingId)
        if (binding === undefined) {
          return yield* new GitHubBindingNotFound({ bindingId: BindingId.make(bindingId) })
        }
        yield* bindingStore.delete(bindingId)
      })

      const listBindings = Effect.fn("GitHubIntegration.listBindings")(function* () {
        const bindings = yield* bindingStore.list()
        return bindings.map(toBindingSummary)
      })

      const listInstallationRepositories = Effect.fn("GitHubIntegration.listInstallationRepositories")(function* (installationId: number) {
        const repositories = yield* gitHubApi.listInstallationRepositories(installationId)

        return repositories
          .map(
            (repository) =>
              new GitHubInstallationRepository({
                installationId,
                repositoryId: repository.id,
                repositoryOwner: repository.owner,
                repositoryName: repository.name,
                repository: repository.fullName,
                cloneUrl: repository.cloneUrl,
                defaultBranch: repository.defaultBranch,
              }),
          )
          .sort((left, right) => (left.repository < right.repository ? -1 : left.repository > right.repository ? 1 : 0))
      })

      const listRepositoryBranches = Effect.fn("GitHubIntegration.listRepositoryBranches")(
        function* (installationId: number, repository: string) {
          const { repositoryOwner, repositoryName } = yield* parseRepository(repository)
          return yield* gitHubApi.listRepositoryBranches(installationId, repositoryOwner, repositoryName)
        },
      )

      const listRepositoryWorkflowFiles = Effect.fn("GitHubIntegration.listRepositoryWorkflowFiles")(
        function* (installationId: number, repository: string, ref?: string) {
          const { repositoryOwner, repositoryName } = yield* parseRepository(repository)
          return yield* gitHubApi.listRepositoryWorkflowFiles(installationId, repositoryOwner, repositoryName, ref)
        },
      )

      const listProjects = Effect.fn("GitHubIntegration.listProjects")(() => bindingStore.listProjects())

      const processWebhook = Effect.fn("GitHubIntegration.processWebhook")(
        function* (event: string | null, payload: unknown, deliveryId: string | null) {
          switch (event) {
            case "push": {
              const push = yield* decodeWebhookPayload<GitHubPushWebhookPayload>(GitHubPushWebhookPayload, payload)
              return yield* handlePushEvent(
                push,
                deliveryId,
                bindingStore,
                gitHubChecks,
                runLinkStore,
                sourceSnapshots,
                loader,
                materializer,
                engine,
                triggerDeliveryStore,
                inflightTriggers,
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

      const handleWebhook = Effect.fn("GitHubIntegration.handleWebhook")(
        function* ({ event, signature, rawBody, deliveryId }: GitHubTriggerRequest) {
          yield* verifyWebhookRequest(appConfig, rawBody, signature)

          const payload = yield* parseWebhookBody(rawBody)
          return yield* processWebhook(event, payload, deliveryId ?? null)
        },
      )

      const acceptWebhook = Effect.fn("GitHubIntegration.acceptWebhook")(
        function* ({ event, signature, rawBody, deliveryId }: GitHubTriggerRequest) {
          yield* verifyWebhookRequest(appConfig, rawBody, signature)

          const payload = yield* parseWebhookBody(rawBody)
          return yield* acceptedWebhookResponse(event, payload)
        },
      )

      const triggerPush = Effect.fn("GitHubIntegration.triggerPush")((request: GitHubTriggerRequest) => handleWebhook(request))

      return {
        addBinding,
        deleteBinding,
        listBindings,
        listInstallationRepositories,
        listRepositoryBranches,
        listRepositoryWorkflowFiles,
        listProjects,
        acceptWebhook,
        handleWebhook,
        triggerPush,
      }
    }),
  )
}

const acceptedWebhookResponse = (
  event: string | null,
  payload: unknown,
): Effect.Effect<GitHubTriggerResponse, GitHubBindingRejected, never> => {
  switch (event) {
    case "push":
      return decodeWebhookPayload<GitHubPushWebhookPayload>(GitHubPushWebhookPayload, payload).pipe(
        Effect.map(
          (push) =>
            new GitHubTriggerResponse({
              event: "push",
              installationId: push.installation.id,
              repository: push.repository.full_name,
              ref: push.ref,
              commitSha: push.after,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: "Webhook accepted for asynchronous processing",
            }),
        ),
      )
    case "installation":
      return decodeWebhookPayload<GitHubInstallationWebhookPayload>(GitHubInstallationWebhookPayload, payload).pipe(
        Effect.map(
          (installation) =>
            new GitHubTriggerResponse({
              event,
              action: installation.action,
              installationId: installation.installation.id,
              repository: installation.repositories?.[0]?.full_name,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: "Webhook accepted for asynchronous processing",
            }),
        ),
      )
    case "installation_repositories":
      return decodeWebhookPayload<GitHubInstallationRepositoriesWebhookPayload>(GitHubInstallationRepositoriesWebhookPayload, payload).pipe(
        Effect.map(
          (installationRepositories) =>
            new GitHubTriggerResponse({
              event,
              action: installationRepositories.action,
              installationId: installationRepositories.installation.id,
              repository:
                installationRepositories.repositories_added?.[0]?.full_name ??
                installationRepositories.repositories_removed?.[0]?.full_name,
              matchedBindings: 0,
              triggeredRuns: [],
              ignoredReason: "Webhook accepted for asynchronous processing",
            }),
        ),
      )
    default:
      return Effect.succeed(
        new GitHubTriggerResponse({
          event: event ?? "unknown",
          matchedBindings: 0,
          triggeredRuns: [],
          ignoredReason: `Unsupported GitHub event: ${event ?? "missing"}`,
        }),
      )
  }
}

const handlePushEvent = (
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  bindingStore: typeof GitHubBindingStore.Service,
  gitHubChecks: typeof GitHubCheckRuns.Service,
  runLinkStore: typeof GitHubRunLinkStore.Service,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
  triggerDeliveryStore: typeof GitHubTriggerDeliveryStore.Service,
  inflightTriggers: Map<string, Fiber.Fiber<GitHubTriggeredRun | undefined, DomainError>>,
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
      triggerBinding(
        binding,
        payload,
        deliveryId,
        gitHubChecks,
        runLinkStore,
        sourceSnapshots,
        loader,
        materializer,
        engine,
        triggerDeliveryStore,
        inflightTriggers,
      ),
    ).pipe(Effect.map((runs) => runs.filter((run): run is GitHubTriggeredRun => run !== undefined)))

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
  runLinkStore: typeof GitHubRunLinkStore.Service,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
  triggerDeliveryStore: typeof GitHubTriggerDeliveryStore.Service,
  inflightTriggers: Map<string, Fiber.Fiber<GitHubTriggeredRun | undefined, DomainError>>,
) =>
  Effect.gen(function* () {
    if (binding.installationId === undefined || binding.repositoryId === undefined) {
      return yield* new GitHubBindingRejected({
        message: `Binding ${binding.bindingId} must be recreated with a GitHub App installation id`,
      })
    }

    const idempotencyKey = gitHubIdempotencyKey(binding, payload, deliveryId)
    const existingDelivery = yield* triggerDeliveryStore.get(idempotencyKey)
    if (existingDelivery !== undefined) {
      return yield* hydrateTriggeredRun(existingDelivery.runId, true, engine, runLinkStore)
    }

    const inflight = inflightTriggers.get(idempotencyKey)
    if (inflight !== undefined && inflight.pollUnsafe() === undefined) {
      const triggered = yield* Fiber.join(inflight)
      return triggered === undefined ? undefined : new GitHubTriggeredRun({ ...triggered, deduped: true })
    }

    const fiber = yield* executeTriggeredBinding(
      binding,
      payload,
      deliveryId,
      gitHubChecks,
      sourceSnapshots,
      loader,
      materializer,
      engine,
      triggerDeliveryStore,
      idempotencyKey,
    ).pipe(Effect.forkChild({ startImmediately: true }))
    inflightTriggers.set(idempotencyKey, fiber)
    fiber.addObserver(() => {
      inflightTriggers.delete(idempotencyKey)
    })

    return yield* Fiber.join(fiber)
  })

const executeTriggeredBinding = (
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  gitHubChecks: typeof GitHubCheckRuns.Service,
  sourceSnapshots: typeof GitHubSourceSnapshots.Service,
  loader: typeof WorkflowModuleLoader.Service,
  materializer: typeof DslMaterializer.Service,
  engine: typeof Engine.Service,
  triggerDeliveryStore: typeof GitHubTriggerDeliveryStore.Service,
  idempotencyKey: string,
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

    if (!supportsGitHubPushTrigger(definition, payload.ref)) {
      return undefined
    }

    const enrichedDefinition = annotateDefinition(definition, binding, payload, deliveryId, snapshot)
    const plan = yield* engine.plan(enrichedDefinition)
    const run = yield* engine.submitRun(plan, { workspacePath: snapshot.workspacePath })
    const now = new Date()

    yield* triggerDeliveryStore.create(
      new GitHubTriggerDelivery({
        idempotencyKey,
        bindingId: binding.bindingId,
        projectId: binding.projectId,
        provider: binding.provider,
        event: "push",
        repositoryId: binding.repositoryId!,
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        ref: payload.ref,
        commitSha: payload.after,
        deliveryId: deliveryId ?? undefined,
        runId: run.runId,
        createdAt: now,
        updatedAt: now,
      }),
    )

    const checkRunId = yield* gitHubChecks.registerRun(run, {
      bindingId: binding.bindingId,
      projectId: binding.projectId,
      installationId: binding.installationId!,
      repositoryId: binding.repositoryId!,
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
      projectId: binding.projectId,
      runId: run.runId,
      workflowId: run.workflowId,
      workflowName: run.execution.plan.workflowName,
      checkRunId,
      deduped: false,
      snapshotPath: snapshot.snapshotPath,
      workspacePath: snapshot.workspacePath,
    })
  })

const annotateDefinition = (
  definition: NormalizedWorkflowDefinition,
  binding: GitHubBinding,
  payload: GitHubPushWebhookPayload,
  deliveryId: string | null,
  snapshot: { readonly projectId: string; readonly snapshotPath: string; readonly workspacePath: string },
) =>
  new NormalizedWorkflowDefinition({
    ...definition,
    metadata: {
      ...definition.metadata,
      projectId: binding.projectId,
      trigger: {
        provider: "github",
        event: "github.push",
        projectId: binding.projectId,
        bindingId: binding.bindingId,
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        repository: payload.repository.full_name,
        ref: payload.ref,
        commitSha: payload.after,
        ...(binding.installationId === undefined ? {} : { installationId: binding.installationId }),
        ...(binding.repositoryId === undefined ? {} : { repositoryId: binding.repositoryId }),
        ...(branchNameFromRef(payload.ref) === undefined ? {} : { branch: branchNameFromRef(payload.ref)! }),
        ...(tagNameFromRef(payload.ref) === undefined ? {} : { tag: tagNameFromRef(payload.ref)! }),
        ...(deliveryId === null || deliveryId === undefined ? {} : { deliveryId }),
      },
      project: {
        provider: binding.provider,
        projectId: binding.projectId,
        ...(binding.name === undefined ? {} : { name: binding.name }),
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        ...(binding.repositoryId === undefined ? {} : { repositoryId: binding.repositoryId }),
      },
      sourceSnapshot: {
        projectId: snapshot.projectId,
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
    projectId: binding.projectId,
    ...(binding.name === undefined ? {} : { name: binding.name }),
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

const gitHubIdempotencyKey = (binding: GitHubBinding, payload: GitHubPushWebhookPayload, deliveryId: string | null) =>
  deliveryId === null || deliveryId.trim().length === 0
    ? `github:${binding.bindingId}:push:${payload.repository.id}:${payload.ref}:${payload.after}`
    : `github:${binding.bindingId}:delivery:${deliveryId}`

const hydrateTriggeredRun = (
  runId: string,
  deduped: boolean,
  engine: typeof Engine.Service,
  runLinkStore: typeof GitHubRunLinkStore.Service,
) =>
  Effect.gen(function* () {
    const [run, link] = yield* Effect.all([engine.inspectRun(runId as any), runLinkStore.get(runId as any)])
    const metadata = run.execution.plan.metadata as Record<string, unknown>
    const sourceSnapshot = asRecord(metadata.sourceSnapshot)

    return new GitHubTriggeredRun({
      bindingId: link?.bindingId ?? BindingId.make(String(asRecord(metadata.trigger)?.bindingId ?? "binding:unknown")),
      projectId: run.projectId,
      runId: run.runId,
      workflowId: run.workflowId,
      workflowName: run.execution.plan.workflowName,
      checkRunId: link?.checkRunId,
      deduped,
      snapshotPath: String(sourceSnapshot?.snapshotPath ?? run.execution.options.workspacePath ?? "-"),
      workspacePath: String(sourceSnapshot?.workspacePath ?? run.execution.options.workspacePath ?? "-"),
    })
  })

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

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

export const tagNameFromRef = (ref: string) => (ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : undefined)

const isZeroSha = (commitSha: string) => /^0+$/.test(commitSha)

const supportsGitHubPushTrigger = (definition: NormalizedWorkflowDefinition, ref: string) => {
  const pushTrigger = (definition.triggers ?? []).find((trigger) => trigger._tag === "GitHubPushTriggerDeclaration") as
    | GitHubPushTriggerDeclaration
    | undefined

  if (pushTrigger === undefined) {
    return false
  }

  const branch = branchNameFromRef(ref)
  const tag = tagNameFromRef(ref)

  return matchesOptionalSet(pushTrigger.refs, ref) &&
    matchesOptionalSet(pushTrigger.branches, branch) &&
    matchesOptionalSet(pushTrigger.tags, tag)
}

const matchesOptionalSet = (values: ReadonlyArray<string> | undefined, candidate: string | undefined) =>
  values === undefined || values.length === 0 ? true : candidate !== undefined && values.includes(candidate)
