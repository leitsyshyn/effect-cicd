import { SecretRef } from "../domain/secrets.ts"
import type {
  AuthoredArtifactDeclaration,
  AuthoredCancellationPolicy,
  AuthoredContainerCommand,
  AuthoredOutputDeclaration,
  AuthoredReportDeclaration,
  AuthoredRetryPolicy,
  AuthoredTimeoutPolicy,
  AuthoredUnit,
  AuthoredUnitInputDeclaration,
  AuthoredUnitOutputSource,
  AuthoredWorkflow,
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
