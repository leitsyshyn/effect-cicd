import { Schema } from "effect"

import { BindingId, ProjectId, RunId, WorkflowId } from "./ids.ts"

const GitHubNumericId = Schema.Int

export class GitHubBinding extends Schema.Class<GitHubBinding>("GitHubBinding")({
  bindingId: BindingId,
  projectId: ProjectId,
  provider: Schema.Literals(["github"]),
  installationId: Schema.optional(GitHubNumericId),
  repositoryId: Schema.optional(GitHubNumericId),
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  cloneUrl: Schema.String,
  sourceKind: Schema.Literals(["github-archive"]),
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export class GitHubBindingCreateRequest extends Schema.Class<GitHubBindingCreateRequest>("GitHubBindingCreateRequest")({
  repository: Schema.String,
  installationId: GitHubNumericId,
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
}) {}

export class GitHubBindingSummary extends Schema.Class<GitHubBindingSummary>("GitHubBindingSummary")({
  bindingId: BindingId,
  projectId: ProjectId,
  provider: Schema.Literals(["github"]),
  installationId: Schema.optional(GitHubNumericId),
  repositoryId: Schema.optional(GitHubNumericId),
  repository: Schema.String,
  cloneUrl: Schema.String,
  sourceKind: Schema.Literals(["github-archive"]),
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export class GitHubTriggeredRun extends Schema.Class<GitHubTriggeredRun>("GitHubTriggeredRun")({
  bindingId: BindingId,
  projectId: ProjectId,
  runId: RunId,
  workflowId: WorkflowId,
  workflowName: Schema.String,
  checkRunId: Schema.optional(GitHubNumericId),
  deduped: Schema.optional(Schema.Boolean),
  snapshotPath: Schema.String,
  workspacePath: Schema.String,
}) {}

export class GitHubTriggerResponse extends Schema.Class<GitHubTriggerResponse>("GitHubTriggerResponse")({
  event: Schema.String,
  action: Schema.optional(Schema.String),
  installationId: Schema.optional(GitHubNumericId),
  repository: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  commitSha: Schema.optional(Schema.String),
  matchedBindings: Schema.Int,
  triggeredRuns: Schema.Array(GitHubTriggeredRun),
  ignoredReason: Schema.optional(Schema.String),
}) {}

export class GitHubRepositorySnapshot extends Schema.Class<GitHubRepositorySnapshot>("GitHubRepositorySnapshot")({
  projectId: ProjectId,
  repository: Schema.String,
  ref: Schema.String,
  commitSha: Schema.String,
  snapshotPath: Schema.String,
  workspacePath: Schema.String,
}) {}

export class GitHubRepositoryOwnerPayload extends Schema.Class<GitHubRepositoryOwnerPayload>("GitHubRepositoryOwnerPayload")({
  login: Schema.String,
}) {}

export class GitHubRepositoryPayload extends Schema.Class<GitHubRepositoryPayload>("GitHubRepositoryPayload")({
  id: GitHubNumericId,
  name: Schema.String,
  full_name: Schema.String,
  clone_url: Schema.String,
  default_branch: Schema.optional(Schema.String),
  owner: GitHubRepositoryOwnerPayload,
}) {}

export class GitHubInstallationPayload extends Schema.Class<GitHubInstallationPayload>("GitHubInstallationPayload")({
  id: GitHubNumericId,
}) {}

export class GitHubPushWebhookPayload extends Schema.Class<GitHubPushWebhookPayload>("GitHubPushWebhookPayload")({
  ref: Schema.String,
  after: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  installation: GitHubInstallationPayload,
  repository: GitHubRepositoryPayload,
}) {}

export class GitHubInstallationWebhookPayload extends Schema.Class<GitHubInstallationWebhookPayload>(
  "GitHubInstallationWebhookPayload",
)({
  action: Schema.String,
  installation: GitHubInstallationPayload,
  repositories: Schema.optional(Schema.Array(GitHubRepositoryPayload)),
}) {}

export class GitHubInstallationRepositoriesWebhookPayload extends Schema.Class<GitHubInstallationRepositoriesWebhookPayload>(
  "GitHubInstallationRepositoriesWebhookPayload",
)({
  action: Schema.String,
  installation: GitHubInstallationPayload,
  repositories_added: Schema.optional(Schema.Array(GitHubRepositoryPayload)),
  repositories_removed: Schema.optional(Schema.Array(GitHubRepositoryPayload)),
}) {}

export class GitHubRunLink extends Schema.Class<GitHubRunLink>("GitHubRunLink")({
  runId: RunId,
  bindingId: BindingId,
  projectId: ProjectId,
  provider: Schema.Literals(["github"]),
  installationId: GitHubNumericId,
  repositoryId: GitHubNumericId,
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  workflowModulePath: Schema.String,
  ref: Schema.String,
  branch: Schema.optional(Schema.String),
  commitSha: Schema.String,
  deliveryId: Schema.optional(Schema.String),
  checkRunId: Schema.optional(GitHubNumericId),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export class GitHubTriggerDelivery extends Schema.Class<GitHubTriggerDelivery>("GitHubTriggerDelivery")({
  idempotencyKey: Schema.String,
  bindingId: BindingId,
  projectId: ProjectId,
  provider: Schema.Literals(["github"]),
  event: Schema.String,
  repositoryId: GitHubNumericId,
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  ref: Schema.String,
  commitSha: Schema.String,
  deliveryId: Schema.optional(Schema.String),
  runId: RunId,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export interface GitHubWebhookEnvelope {
  readonly event: string | null
  readonly signature: string | null
  readonly deliveryId: string | null
  readonly body: string
}
