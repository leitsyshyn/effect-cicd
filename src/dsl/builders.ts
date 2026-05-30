import type {
  AuthoredCancellationPolicy,
  AuthoredContainerCommand,
  AuthoredNamedDeclaration,
  AuthoredRetryPolicy,
  AuthoredTimeoutPolicy,
  AuthoredUnit,
  AuthoredWorkflow,
} from "./authored-workflow.ts"

export const workflow = (definition: AuthoredWorkflow): AuthoredWorkflow => definition

export const unit = (definition: AuthoredUnit): AuthoredUnit => definition

export const containerCommand = (definition: Omit<AuthoredContainerCommand, "_tag">): AuthoredContainerCommand => ({
  _tag: "ContainerCommand",
  ...definition,
})

export const artifact = (definition: AuthoredNamedDeclaration): AuthoredNamedDeclaration => definition

export const input = (definition: AuthoredNamedDeclaration): AuthoredNamedDeclaration => definition

export const output = (definition: AuthoredNamedDeclaration): AuthoredNamedDeclaration => definition

export const report = (definition: AuthoredNamedDeclaration): AuthoredNamedDeclaration => definition

export const retry = (definition: Omit<AuthoredRetryPolicy, "_tag">): AuthoredRetryPolicy => ({
  _tag: "RetryPolicy",
  ...definition,
})

export const timeout = (definition: Omit<AuthoredTimeoutPolicy, "_tag">): AuthoredTimeoutPolicy => ({
  _tag: "TimeoutPolicy",
  ...definition,
})

export const cancellation = (
  definition: Omit<AuthoredCancellationPolicy, "_tag">,
): AuthoredCancellationPolicy => ({
  _tag: "CancellationPolicy",
  ...definition,
})
