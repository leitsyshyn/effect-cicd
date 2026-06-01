import { Schema } from "effect"

import { ProjectId } from "./ids.ts"

export class ProjectSummary extends Schema.Class<ProjectSummary>("ProjectSummary")({
  projectId: ProjectId,
  provider: Schema.String,
  repositoryOwner: Schema.optional(Schema.String),
  repositoryName: Schema.optional(Schema.String),
  repositoryId: Schema.optional(Schema.Int),
  bindingCount: Schema.Int,
  runCount: Schema.Int,
  latestRunAt: Schema.optional(Schema.Date),
}) {}

export const deriveGitHubProjectId = (repositoryId: number | undefined, repositoryOwner: string, repositoryName: string) =>
  ProjectId.make(
    repositoryId === undefined
      ? `project:github:${repositoryOwner.trim().toLowerCase()}/${repositoryName.trim().toLowerCase()}`
      : `project:github:repo:${repositoryId}`,
  )

export const sanitizeProjectPathSegment = (projectId: string) => projectId.replace(/[^A-Za-z0-9._-]/g, "_")
