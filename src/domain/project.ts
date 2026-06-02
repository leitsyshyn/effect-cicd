import { Schema } from "effect"

import { ProjectId } from "./ids.ts"
import { WorkflowRunState, WorkflowRunStatus } from "./runtime-state.ts"

export class ProjectSummary extends Schema.Class<ProjectSummary>("ProjectSummary")({
  projectId: ProjectId,
  provider: Schema.String,
  repositoryOwner: Schema.optional(Schema.String),
  repositoryName: Schema.optional(Schema.String),
  repositoryId: Schema.optional(Schema.Int),
  bindingCount: Schema.Int,
  runCount: Schema.Int,
  latestRunAt: Schema.optional(Schema.Date),
  latestRunStatus: Schema.optional(WorkflowRunStatus),
}) {}

export class LocalProject extends Schema.Class<LocalProject>("LocalProject")({
  projectId: ProjectId,
  provider: Schema.Literals(["local"]),
  workflowModulePath: Schema.String,
  workspacePath: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const deriveGitHubProjectId = (repositoryId: number | undefined, repositoryOwner: string, repositoryName: string) =>
  ProjectId.make(
    repositoryId === undefined
      ? `project:github:${repositoryOwner.trim().toLowerCase()}/${repositoryName.trim().toLowerCase()}`
      : `project:github:repo:${repositoryId}`,
  )

export const sanitizeProjectPathSegment = (projectId: string) => projectId.replace(/[^A-Za-z0-9._-]/g, "_")

export const projectIdForRunSummary = (run: WorkflowRunState) => {
  const metadata = asRecord(run.execution.plan.metadata)
  const explicitProjectId = asNonEmptyString(metadata?.projectId)
  const annotatedProjectId = asNonEmptyString(asRecord(metadata?.project)?.projectId)
  const triggerProjectId = asNonEmptyString(asRecord(metadata?.trigger)?.projectId)

  return explicitProjectId ?? annotatedProjectId ?? triggerProjectId ?? run.projectId
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const asNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined
