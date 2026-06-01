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

export interface AuthoredUnit {
  readonly unitId: string
  readonly name: string
  readonly command: AuthoredContainerCommand
  readonly dependsOn?: ReadonlyArray<string>
  readonly metadata?: AuthoredMetadata
  readonly inputs?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly outputs?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly policies?: ReadonlyArray<AuthoredPolicy>
  readonly source?: AuthoredSourceMetadata
}

export interface AuthoredWorkflow {
  readonly workflowId: string
  readonly name: string
  readonly metadata?: AuthoredMetadata
  readonly units: ReadonlyArray<AuthoredUnit>
  readonly inputs?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly outputs?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly reports?: ReadonlyArray<AuthoredNamedDeclaration>
  readonly source?: AuthoredSourceMetadata
}
