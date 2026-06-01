import { Schema } from "effect"

import { BindingId, RunId, WorkflowId } from "./ids.ts"

export class GitHubBinding extends Schema.Class<GitHubBinding>("GitHubBinding")({
  bindingId: BindingId,
  provider: Schema.Literals(["github"]),
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  cloneUrl: Schema.String,
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  webhookSecret: Schema.optional(Schema.String),
  accessToken: Schema.optional(Schema.String),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export class GitHubBindingCreateRequest extends Schema.Class<GitHubBindingCreateRequest>("GitHubBindingCreateRequest")({
  repository: Schema.String,
  cloneUrl: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  webhookSecret: Schema.optional(Schema.String),
  accessToken: Schema.optional(Schema.String),
}) {}

export class GitHubBindingSummary extends Schema.Class<GitHubBindingSummary>("GitHubBindingSummary")({
  bindingId: BindingId,
  provider: Schema.Literals(["github"]),
  repository: Schema.String,
  cloneUrl: Schema.String,
  branch: Schema.optional(Schema.String),
  workflowModulePath: Schema.String,
  workspaceSubdir: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  hasWebhookSecret: Schema.Boolean,
  accessMode: Schema.Literals(["anonymous", "token"]),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export class GitHubTriggeredRun extends Schema.Class<GitHubTriggeredRun>("GitHubTriggeredRun")({
  bindingId: BindingId,
  runId: RunId,
  workflowId: WorkflowId,
  workflowName: Schema.String,
  snapshotPath: Schema.String,
  workspacePath: Schema.String,
}) {}

export class GitHubTriggerResponse extends Schema.Class<GitHubTriggerResponse>("GitHubTriggerResponse")({
  event: Schema.String,
  repository: Schema.String,
  ref: Schema.optional(Schema.String),
  commitSha: Schema.optional(Schema.String),
  matchedBindings: Schema.Int,
  triggeredRuns: Schema.Array(GitHubTriggeredRun),
  ignoredReason: Schema.optional(Schema.String),
}) {}

export class GitHubRepositorySnapshot extends Schema.Class<GitHubRepositorySnapshot>("GitHubRepositorySnapshot")({
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
  name: Schema.String,
  full_name: Schema.String,
  clone_url: Schema.String,
  default_branch: Schema.optional(Schema.String),
  owner: GitHubRepositoryOwnerPayload,
}) {}

export class GitHubPushWebhookPayload extends Schema.Class<GitHubPushWebhookPayload>("GitHubPushWebhookPayload")({
  ref: Schema.String,
  after: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  repository: GitHubRepositoryPayload,
}) {}

export interface GitHubWebhookEnvelope {
  readonly event: string | null
  readonly signature: string | null
  readonly body: string
}
