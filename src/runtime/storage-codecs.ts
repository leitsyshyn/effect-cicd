import { Schema } from "effect"

import { ArtifactMetadata, LogMetadata } from "../domain/artifacts.ts"
import { WorkflowEvent } from "../domain/events.ts"
import { GitHubBinding, GitHubRunLink, GitHubTriggerDelivery } from "../domain/github.ts"
import { deriveGitHubProjectId } from "../domain/project.ts"
import { WorkflowRunState } from "../domain/runtime-state.ts"

const WorkflowRunStateJson = Schema.toCodecJson(WorkflowRunState)
const WorkflowEventJson = Schema.toCodecJson(WorkflowEvent)
const ArtifactMetadataJson = Schema.toCodecJson(ArtifactMetadata)
const LogMetadataJson = Schema.toCodecJson(LogMetadata)
const GitHubBindingJson = Schema.toCodecJson(GitHubBinding)
const GitHubRunLinkJson = Schema.toCodecJson(GitHubRunLink)
const GitHubTriggerDeliveryJson = Schema.toCodecJson(GitHubTriggerDelivery)

export const encodeWorkflowRunState = Schema.encodeSync(WorkflowRunStateJson)
export const encodeWorkflowEvent = Schema.encodeSync(WorkflowEventJson)
export const encodeArtifactMetadata = Schema.encodeSync(ArtifactMetadataJson)
export const encodeLogMetadata = Schema.encodeSync(LogMetadataJson)
export const encodeGitHubBinding = Schema.encodeSync(GitHubBindingJson)
export const encodeGitHubRunLink = Schema.encodeSync(GitHubRunLinkJson)
export const encodeGitHubTriggerDelivery = Schema.encodeSync(GitHubTriggerDeliveryJson)

export const decodeWorkflowRunState = (value: unknown) =>
  Schema.decodeUnknownSync(WorkflowRunStateJson)(upgradeLegacyWorkflowRunStateJson(normalizeJson(value)))

export const decodeWorkflowEvent = (value: unknown) => Schema.decodeUnknownSync(WorkflowEventJson)(normalizeJson(value))

export const decodeArtifactMetadata = (value: unknown) =>
  Schema.decodeUnknownSync(ArtifactMetadataJson)(normalizeJson(value))

export const decodeLogMetadata = (value: unknown) => Schema.decodeUnknownSync(LogMetadataJson)(normalizeJson(value))

export const decodeGitHubBinding = (value: unknown) =>
  Schema.decodeUnknownSync(GitHubBindingJson)(upgradeLegacyGitHubBindingJson(normalizeJson(value)))

export const decodeGitHubRunLink = (value: unknown) =>
  Schema.decodeUnknownSync(GitHubRunLinkJson)(upgradeLegacyGitHubRunLinkJson(normalizeJson(value)))

export const decodeGitHubTriggerDelivery = (value: unknown) =>
  Schema.decodeUnknownSync(GitHubTriggerDeliveryJson)(normalizeJson(value))

const normalizeJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value)
}

const upgradeLegacyWorkflowRunStateJson = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || !("runId" in value) || !("workflowId" in value) || !("planId" in value)) {
    return value
  }

  const record = value as {
    readonly workflowId: string
    readonly planId: string
    readonly createdAt?: string
    readonly status?: string
    readonly projectId?: string
    readonly execution?: { readonly plan?: { readonly metadata?: Record<string, unknown> } }
    readonly units?: ReadonlyArray<{
      readonly unitId: string
      readonly dependencies?: ReadonlyArray<string>
      readonly artifacts?: ReadonlyArray<unknown>
      readonly logs?: ReadonlyArray<unknown>
    }>
  }

  const projectId =
    record.projectId ??
    (typeof record.execution?.plan?.metadata?.projectId === "string" && record.execution.plan.metadata.projectId.trim().length > 0
      ? record.execution.plan.metadata.projectId
      : record.workflowId)

  if ("execution" in value) {
    return {
      ...record,
      projectId,
      status: record.status === "created" ? "queued" : record.status,
    }
  }

  const units = (record.units ?? []).map((unit) => ({
    unitId: unit.unitId,
    name: unit.unitId.replace(/^unit:/, ""),
    dependencies: [...(unit.dependencies ?? [])],
    payloadDescriptor: {
      _tag: "ContainerCommandDescriptor",
      image: "legacy/unknown",
      command: ["true"],
      env: {},
    },
    logExpectations: [{ name: "stdout", metadata: {} }],
    artifactExpectations: [],
    policies: [],
    diagnostics: [],
  }))

  const dependencies = units.flatMap((unit) =>
    unit.dependencies.map((dependency) => ({
      from: dependency,
      to: unit.unitId,
    })),
  )

  return {
    ...record,
    projectId,
    status: record.status === "created" || record.status === undefined ? "queued" : record.status,
    execution: {
      plan: {
        planId: record.planId,
        schemaVersion: "0.1.0",
        workflowId: record.workflowId,
        workflowName: record.workflowId.replace(/^workflow:/, ""),
        metadata: {},
        units,
        dependencies,
        diagnostics: [],
      },
      options: {},
      submittedAt: record.createdAt ?? new Date(0).toISOString(),
    },
  }
}

const upgradeLegacyGitHubBindingJson = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || !("bindingId" in value)) {
    return value
  }

  const record = value as Record<string, unknown>

  return {
    ...record,
    projectId:
      typeof record.projectId === "string" && record.projectId.trim().length > 0
        ? record.projectId
        : deriveGitHubProjectId(
            typeof record.repositoryId === "number" ? record.repositoryId : undefined,
            String(record.repositoryOwner ?? record.repoOwner ?? "unknown"),
            String(record.repositoryName ?? record.repoName ?? "unknown"),
          ),
    sourceKind: record.sourceKind ?? "github-archive",
  }
}

const upgradeLegacyGitHubRunLinkJson = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || !("runId" in value)) {
    return value
  }

  const record = value as Record<string, unknown>

  return {
    ...record,
    projectId:
      typeof record.projectId === "string" && record.projectId.trim().length > 0
        ? record.projectId
        : deriveGitHubProjectId(
            typeof record.repositoryId === "number" ? record.repositoryId : undefined,
            String(record.repositoryOwner ?? "unknown"),
            String(record.repositoryName ?? "unknown"),
          ),
  }
}
