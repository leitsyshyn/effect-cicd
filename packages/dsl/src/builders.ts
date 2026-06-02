import { SecretRef } from "./secrets.ts"
import type {
  AuthoredArtifactDeclaration,
  AuthoredCancellationPolicy,
  AuthoredCondition,
  AuthoredContainerCommand,
  AuthoredGitHubPushTrigger,
  AuthoredManualTrigger,
  AuthoredOutputDeclaration,
  AuthoredReportDeclaration,
  AuthoredRetryPolicy,
  AuthoredTimeoutPolicy,
  AuthoredTrigger,
  AuthoredUnit,
  AuthoredUnitInputDeclaration,
  AuthoredUnitOutputSource,
  AuthoredUpstreamStatusCondition,
  AuthoredWorkflow,
  AuthoredWorkflowInputEqualsCondition,
  AuthoredWorkflowInputSource,
  AuthoredWorkflowOutputDeclaration,
} from "./authored-workflow.ts"

export const workflow = (definition: AuthoredWorkflow): AuthoredWorkflow => definition

export const unit = (definition: AuthoredUnit): AuthoredUnit => definition

export const containerCommand = (definition: Omit<AuthoredContainerCommand, "_tag">): AuthoredContainerCommand => ({
  _tag: "ContainerCommand",
  ...definition,
})

export const secret = (key: string) => new SecretRef({ key })

export const artifact = (definition: AuthoredArtifactDeclaration): AuthoredArtifactDeclaration => ({
  kind: "file",
  ...definition,
})

export const manualTrigger = (): AuthoredManualTrigger => ({
  _tag: "ManualTrigger",
})

export const githubPushTrigger = (definition: Omit<AuthoredGitHubPushTrigger, "_tag"> = {}): AuthoredGitHubPushTrigger => ({
  _tag: "GitHubPushTrigger",
  ...definition,
})

export const trigger = <A extends AuthoredTrigger>(definition: A): A => definition

export const workflowInput = (name: string): AuthoredWorkflowInputSource => ({
  _tag: "WorkflowInputSource",
  inputName: name,
})

export const unitOutput = (unitId: string, outputName: string): AuthoredUnitOutputSource => ({
  _tag: "UnitOutputSource",
  unitId,
  outputName,
})

export const input = (definition: AuthoredUnitInputDeclaration): AuthoredUnitInputDeclaration => definition

export const output = <A extends AuthoredOutputDeclaration | AuthoredWorkflowOutputDeclaration>(definition: A): A => definition

export const report = (definition: AuthoredReportDeclaration): AuthoredReportDeclaration => definition

export const whenTriggerEvent = (event: "manual" | "github.push"): AuthoredCondition => ({
  _tag: "TriggerEventCondition",
  event,
})

export const whenBranch = (branch: string): AuthoredCondition => ({
  _tag: "TriggerBranchCondition",
  branch,
})

export const whenRef = (ref: string): AuthoredCondition => ({
  _tag: "TriggerRefCondition",
  ref,
})

export const whenTag = (tag: string): AuthoredCondition => ({
  _tag: "TriggerTagCondition",
  tag,
})

export const whenInputEquals = (inputName: string, value: unknown): AuthoredWorkflowInputEqualsCondition => ({
  _tag: "WorkflowInputEqualsCondition",
  inputName,
  value,
})

export const whenUpstreamStatus = (
  unitId: string,
  status: AuthoredUpstreamStatusCondition["status"],
): AuthoredUpstreamStatusCondition => ({
  _tag: "UpstreamStatusCondition",
  unitId,
  status,
})

export const condition = <A extends AuthoredCondition>(definition: A): A => definition

export const retry = (definition: Omit<AuthoredRetryPolicy, "_tag">): AuthoredRetryPolicy => ({
  _tag: "RetryPolicy",
  ...definition,
})

export const timeout = (definition: Omit<AuthoredTimeoutPolicy, "_tag">): AuthoredTimeoutPolicy => ({
  _tag: "TimeoutPolicy",
  ...definition,
})

export const cancellation = (definition: Omit<AuthoredCancellationPolicy, "_tag">): AuthoredCancellationPolicy => ({
  _tag: "CancellationPolicy",
  ...definition,
})
