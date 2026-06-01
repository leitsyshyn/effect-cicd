import type { SecretRef } from "../domain/secrets.ts"

export type AuthoredMetadata = Readonly<Record<string, unknown>>

export interface AuthoredSourceMetadata {
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly origin?: string
}

export interface AuthoredNamedDeclaration {
  readonly name: string
  readonly metadata?: AuthoredMetadata
  readonly source?: AuthoredSourceMetadata
}

export type AuthoredDataValueFormat = "json" | "text"

export interface AuthoredManualTrigger {
  readonly _tag: "ManualTrigger"
}

export interface AuthoredGitHubPushTrigger {
  readonly _tag: "GitHubPushTrigger"
  readonly branches?: ReadonlyArray<string>
  readonly refs?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
}

export type AuthoredTrigger = AuthoredManualTrigger | AuthoredGitHubPushTrigger

export interface AuthoredWorkflowInputSource {
  readonly _tag: "WorkflowInputSource"
  readonly inputName: string
}

export interface AuthoredUnitOutputSource {
  readonly _tag: "UnitOutputSource"
  readonly unitId: string
  readonly outputName: string
}

export type AuthoredValueSource = AuthoredWorkflowInputSource | AuthoredUnitOutputSource

export interface AuthoredUnitInputDeclaration extends AuthoredNamedDeclaration {
  readonly from: AuthoredValueSource
}

export interface AuthoredOutputDeclaration extends AuthoredNamedDeclaration {
  readonly path: string
  readonly format?: AuthoredDataValueFormat
}

export interface AuthoredWorkflowOutputDeclaration extends AuthoredNamedDeclaration {
  readonly from: AuthoredValueSource
}

export interface AuthoredReportDeclaration extends AuthoredNamedDeclaration {
  readonly path: string
  readonly format?: AuthoredDataValueFormat
  readonly contentType?: string
}

export interface AuthoredArtifactDeclaration extends AuthoredNamedDeclaration {
  readonly kind?: "file"
  readonly path: string
  readonly contentType?: string
}

export interface AuthoredContainerCommand {
  readonly _tag: "ContainerCommand"
  readonly image: string
  readonly command: readonly [string, ...Array<string>]
  readonly env?: Readonly<Record<string, string | SecretRef>>
  readonly workingDirectory?: string
}

export interface AuthoredRetryPolicy {
  readonly _tag: "RetryPolicy"
  readonly maxAttempts: number
  readonly exponent?: number
  readonly baseDelayMillis?: number
  readonly maxDelayMillis?: number
  readonly jitter?: "none" | "full" | "half"
}

export interface AuthoredTimeoutPolicy {
  readonly _tag: "TimeoutPolicy"
  readonly seconds: number
}

export interface AuthoredCancellationPolicy {
  readonly _tag: "CancellationPolicy"
  readonly mode: "best-effort" | "fail-fast"
}

export type AuthoredPolicy = AuthoredRetryPolicy | AuthoredTimeoutPolicy | AuthoredCancellationPolicy

export interface AuthoredTriggerEventCondition {
  readonly _tag: "TriggerEventCondition"
  readonly event: "manual" | "github.push"
}

export interface AuthoredTriggerBranchCondition {
  readonly _tag: "TriggerBranchCondition"
  readonly branch: string
}

export interface AuthoredTriggerRefCondition {
  readonly _tag: "TriggerRefCondition"
  readonly ref: string
}

export interface AuthoredTriggerTagCondition {
  readonly _tag: "TriggerTagCondition"
  readonly tag: string
}

export interface AuthoredWorkflowInputEqualsCondition {
  readonly _tag: "WorkflowInputEqualsCondition"
  readonly inputName: string
  readonly value: unknown
}

export interface AuthoredUpstreamStatusCondition {
  readonly _tag: "UpstreamStatusCondition"
  readonly unitId: string
  readonly status: "succeeded" | "failed" | "timed_out" | "skipped" | "canceled"
}

export type AuthoredCondition =
  | AuthoredTriggerEventCondition
  | AuthoredTriggerBranchCondition
  | AuthoredTriggerRefCondition
  | AuthoredTriggerTagCondition
  | AuthoredWorkflowInputEqualsCondition
  | AuthoredUpstreamStatusCondition

export interface AuthoredUnit {
  readonly unitId: string
  readonly name: string
  readonly command: AuthoredContainerCommand
  readonly dependsOn?: ReadonlyArray<string>
  readonly metadata?: AuthoredMetadata
  readonly inputs?: ReadonlyArray<AuthoredUnitInputDeclaration>
  readonly outputs?: ReadonlyArray<AuthoredOutputDeclaration>
  readonly reports?: ReadonlyArray<AuthoredReportDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly conditions?: ReadonlyArray<AuthoredCondition>
  readonly policies?: ReadonlyArray<AuthoredPolicy>
  readonly source?: AuthoredSourceMetadata
}

export interface AuthoredWorkflow {
  readonly workflowId: string
  readonly name: string
  readonly metadata?: AuthoredMetadata
  readonly triggers?: ReadonlyArray<AuthoredTrigger>
  readonly units: ReadonlyArray<AuthoredUnit>
  readonly inputs?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly outputs?: ReadonlyArray<AuthoredWorkflowOutputDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly reports?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly source?: AuthoredSourceMetadata
}
