import { type Pipeable, pipeArguments } from "effect/Pipeable"

import { SecretRef } from "./secrets.ts"
import type {
  AuthoredArtifactDeclaration,
  AuthoredCancellationPolicy,
  AuthoredCondition,
  AuthoredContainerCommand,
  AuthoredDataValueFormat,
  AuthoredMetadata,
  AuthoredOutputDeclaration,
  AuthoredReportDeclaration,
  AuthoredRetryPolicy,
  AuthoredSourceMetadata,
  AuthoredTimeoutPolicy,
  AuthoredTrigger,
  AuthoredUnit,
  AuthoredUnitInputDeclaration,
  AuthoredWorkflow,
  AuthoredWorkflowOutputDeclaration,
} from "./authored-workflow.ts"

const WorkflowDslTypeId = Symbol.for("@effect-cicd/dsl/Workflow")
const JobDslTypeId = Symbol.for("@effect-cicd/dsl/Job")

type JobCommand =
  | { readonly _tag: "ShellCommand"; readonly command: string }
  | { readonly _tag: "ArgvCommand"; readonly command: readonly [string, ...Array<string>] }

interface JobState {
  readonly jobId: string
  readonly name?: string
  readonly image?: string
  readonly command?: JobCommand
  readonly env?: Readonly<Record<string, string | SecretRef>>
  readonly workingDirectory?: string
  readonly dependsOn?: ReadonlyArray<string>
  readonly metadata?: AuthoredMetadata
  readonly inputs?: ReadonlyArray<AuthoredUnitInputDeclaration>
  readonly outputs?: ReadonlyArray<AuthoredOutputDeclaration>
  readonly reports?: ReadonlyArray<AuthoredReportDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly conditions?: ReadonlyArray<AuthoredCondition>
  readonly policies?: ReadonlyArray<AuthoredRetryPolicy | AuthoredCancellationPolicy | AuthoredTimeoutPolicy>
  readonly source?: AuthoredSourceMetadata
}

interface WorkflowState {
  readonly workflowId: string
  readonly name?: string
  readonly metadata?: AuthoredMetadata
  readonly triggers?: ReadonlyArray<AuthoredTrigger>
  readonly jobs?: ReadonlyArray<JobDsl>
  readonly inputs?: ReadonlyArray<{ readonly name: string; readonly metadata?: AuthoredMetadata; readonly source?: AuthoredSourceMetadata }>
  readonly outputs?: ReadonlyArray<AuthoredWorkflowOutputDeclaration>
  readonly artifacts?: ReadonlyArray<AuthoredArtifactDeclaration>
  readonly reports?: ReadonlyArray<{ readonly name: string; readonly metadata?: AuthoredMetadata; readonly source?: AuthoredSourceMetadata }>
  readonly source?: AuthoredSourceMetadata
}

export interface JobDsl extends Pipeable {
  readonly [JobDslTypeId]: JobState
}

export interface WorkflowDsl extends Pipeable {
  readonly [WorkflowDslTypeId]: WorkflowState
}

export type WorkflowAuthoring = AuthoredWorkflow | WorkflowDsl

type JobModifier = (job: JobDsl) => JobDsl
type WorkflowModifier = (workflow: WorkflowDsl) => WorkflowDsl

type NamedDeclarationSpec = {
  readonly name: string
  readonly metadata?: AuthoredMetadata
  readonly source?: AuthoredSourceMetadata
}

type ValueSource =
  | { readonly _tag: "WorkflowInputSource"; readonly inputName: string }
  | { readonly _tag: "UnitOutputSource"; readonly unitId: string; readonly outputName: string }

type EnvValues = Readonly<Record<string, string | SecretRef>>

const pipe = function(this: Pipeable) {
  return pipeArguments(this, arguments)
}

const makeJob = (state: JobState): JobDsl =>
  Object.assign(Object.create(null), {
    [JobDslTypeId]: state,
    pipe,
  }) as JobDsl

const makeWorkflow = (state: WorkflowState): WorkflowDsl =>
  Object.assign(Object.create(null), {
    [WorkflowDslTypeId]: state,
    pipe,
  }) as WorkflowDsl

const updateJob = (job: JobDsl, f: (state: JobState) => JobState): JobDsl => makeJob(f(job[JobDslTypeId]))

const updateWorkflow = (workflow: WorkflowDsl, f: (state: WorkflowState) => WorkflowState): WorkflowDsl =>
  makeWorkflow(f(workflow[WorkflowDslTypeId]))

const append = <A>(current: ReadonlyArray<A> | undefined, values: ReadonlyArray<A>): ReadonlyArray<A> => [...(current ?? []), ...values]

const mergeEnv = (current: EnvValues | undefined, incoming: EnvValues): EnvValues => ({ ...(current ?? {}), ...incoming })

const addOptional = <A extends object, K extends string, V>(target: A, key: K, value: V | undefined): A & { readonly [P in K]?: V } =>
  value === undefined ? target : Object.assign(target, { [key]: value })

const toCommand = (state: JobState): AuthoredContainerCommand => {
  if (state.image === undefined || state.image.trim().length === 0) {
    throw new Error(`Job ${state.jobId} must declare an image before it can be materialized`)
  }

  if (state.command === undefined) {
    throw new Error(`Job ${state.jobId} must declare a command before it can be materialized`)
  }

  const argv = state.command._tag === "ShellCommand" ? (["sh", "-lc", state.command.command] as const) : state.command.command

  const command: AuthoredContainerCommand = {
    _tag: "ContainerCommand",
    image: state.image,
    command: [...argv],
  }

  addOptional(command, "env", state.env === undefined ? undefined : { ...state.env })
  addOptional(command, "workingDirectory", state.workingDirectory)

  return command
}

const lowerJob = (job: JobDsl): AuthoredUnit => {
  const state = job[JobDslTypeId]

  const unit: AuthoredUnit = {
    unitId: state.jobId,
    name: state.name ?? state.jobId,
    command: toCommand(state),
  }

  addOptional(unit, "dependsOn", state.dependsOn === undefined ? undefined : [...state.dependsOn])
  addOptional(unit, "metadata", state.metadata === undefined ? undefined : { ...state.metadata })
  addOptional(unit, "inputs", state.inputs === undefined ? undefined : [...state.inputs])
  addOptional(unit, "outputs", state.outputs === undefined ? undefined : [...state.outputs])
  addOptional(unit, "reports", state.reports === undefined ? undefined : [...state.reports])
  addOptional(unit, "artifacts", state.artifacts === undefined ? undefined : [...state.artifacts])
  addOptional(unit, "conditions", state.conditions === undefined ? undefined : [...state.conditions])
  addOptional(unit, "policies", state.policies === undefined ? undefined : [...state.policies])
  addOptional(unit, "source", state.source)

  return unit
}

export const lowerWorkflowAuthoring = (workflow: WorkflowAuthoring): AuthoredWorkflow => {
  if (isWorkflowDsl(workflow)) {
    const state = workflow[WorkflowDslTypeId]

    const authored: AuthoredWorkflow = {
      workflowId: state.workflowId,
      name: state.name ?? state.workflowId,
      units: (state.jobs ?? []).map(lowerJob),
    }

    addOptional(authored, "metadata", state.metadata === undefined ? undefined : { ...state.metadata })
    addOptional(authored, "triggers", state.triggers === undefined ? undefined : [...state.triggers])
    addOptional(authored, "inputs", state.inputs === undefined ? undefined : state.inputs.map((input) => ({ ...input })))
    addOptional(authored, "outputs", state.outputs === undefined ? undefined : [...state.outputs])
    addOptional(authored, "artifacts", state.artifacts === undefined ? undefined : [...state.artifacts])
    addOptional(authored, "reports", state.reports === undefined ? undefined : state.reports.map((report) => ({ ...report })))
    addOptional(authored, "source", state.source)

    return authored
  }

  return workflow
}

export const isWorkflowDsl = (value: unknown): value is WorkflowDsl =>
  typeof value === "object" && value !== null && WorkflowDslTypeId in value

export const isWorkflowAuthoring = (value: unknown): value is WorkflowAuthoring => isWorkflowDsl(value) || isAuthoredWorkflow(value)

const isAuthoredWorkflow = (value: unknown): value is AuthoredWorkflow => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.workflowId === "string" && typeof record.name === "string" && Array.isArray(record.units)
}

const sourceFromWorkflowInput = (inputName: string): ValueSource => ({
  _tag: "WorkflowInputSource",
  inputName,
})

const sourceFromJobOutput = (jobId: string, outputName: string): ValueSource => ({
  _tag: "UnitOutputSource",
  unitId: jobId,
  outputName,
})

const publicInput = (name: string, from: ValueSource, metadata?: AuthoredMetadata): AuthoredUnitInputDeclaration => {
  const input: AuthoredUnitInputDeclaration = { name, from }
  addOptional(input, "metadata", metadata)
  return input
}

const publicOutput = (name: string, from: ValueSource, metadata?: AuthoredMetadata): AuthoredWorkflowOutputDeclaration => {
  const output: AuthoredWorkflowOutputDeclaration = { name, from }
  addOptional(output, "metadata", metadata)
  return output
}

export const Workflow = {
  make: (workflowId: string): WorkflowDsl =>
    makeWorkflow({
      workflowId,
    }),
  named: (name: string): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        name,
      })),
  metadata: (metadata: AuthoredMetadata): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        metadata: { ...(state.metadata ?? {}), ...metadata },
      })),
  on: (...triggers: Array<AuthoredTrigger>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        triggers: append(state.triggers, triggers),
      })),
  job: (...jobs: Array<JobDsl>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        jobs: append(state.jobs, jobs),
      })),
  input: (...inputs: Array<NamedDeclarationSpec>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        inputs: append(state.inputs, inputs),
      })),
  output: (...outputs: Array<AuthoredWorkflowOutputDeclaration>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        outputs: append(state.outputs, outputs),
      })),
  artifact: (...artifacts: Array<AuthoredArtifactDeclaration>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        artifacts: append(state.artifacts, artifacts),
      })),
  report: (...reports: Array<NamedDeclarationSpec>): WorkflowModifier =>
    (workflow) =>
      updateWorkflow(workflow, (state) => ({
        ...state,
        reports: append(state.reports, reports),
      })),
}

export const Job = {
  make: (jobId: string): JobDsl =>
    makeJob({
      jobId,
    }),
  named: (name: string): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        name,
      })),
  image: (image: string): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        image,
      })),
  exec: (command: JobCommand): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        command,
      })),
  run: (command: string): JobModifier => Job.exec(Command.shell(command)),
  dependsOn: (...jobIds: Array<string>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        dependsOn: append(state.dependsOn, jobIds),
      })),
  when: (...conditions: Array<AuthoredCondition>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        conditions: append(state.conditions, conditions),
      })),
  input: (...inputs: Array<AuthoredUnitInputDeclaration>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        inputs: append(state.inputs, inputs),
      })),
  output: (...outputs: Array<AuthoredOutputDeclaration>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        outputs: append(state.outputs, outputs),
      })),
  artifact: (...artifacts: Array<AuthoredArtifactDeclaration>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        artifacts: append(state.artifacts, artifacts),
      })),
  report: (...reports: Array<AuthoredReportDeclaration>): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        reports: append(state.reports, reports),
      })),
  retry: (policy: AuthoredRetryPolicy): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        policies: append(state.policies, [policy]),
      })),
  timeout: (policy: AuthoredTimeoutPolicy): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        policies: append(state.policies, [policy]),
      })),
  cancel: (policy: AuthoredCancellationPolicy): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        policies: append(state.policies, [policy]),
      })),
  env: (nameOrValues: string | EnvValues, value?: string): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        env: mergeEnv(
          state.env,
          typeof nameOrValues === "string" ? { [nameOrValues]: value ?? "" } : nameOrValues,
        ),
      })),
  secret: (name: string, key = name): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        env: mergeEnv(state.env, { [name]: new SecretRef({ key }) }),
      })),
  workingDirectory: (workingDirectory: string): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        workingDirectory,
      })),
  metadata: (metadata: AuthoredMetadata): JobModifier =>
    (job) =>
      updateJob(job, (state) => ({
        ...state,
        metadata: { ...(state.metadata ?? {}), ...metadata },
      })),
}

export const Trigger = {
  manual: (): AuthoredTrigger => ({ _tag: "ManualTrigger" }),
  githubPush: (options: { readonly branches?: ReadonlyArray<string>; readonly refs?: ReadonlyArray<string>; readonly tags?: ReadonlyArray<string> } = {}): AuthoredTrigger => ({
    _tag: "GitHubPushTrigger",
    ...options,
  }),
}

export const Condition = {
  event: (event: "manual" | "github.push"): AuthoredCondition => ({ _tag: "TriggerEventCondition", event }),
  manual: (): AuthoredCondition => Condition.event("manual"),
  githubPush: (): AuthoredCondition => Condition.event("github.push"),
  branch: (branch: string): AuthoredCondition => ({ _tag: "TriggerBranchCondition", branch }),
  ref: (ref: string): AuthoredCondition => ({ _tag: "TriggerRefCondition", ref }),
  tag: (tag: string): AuthoredCondition => ({ _tag: "TriggerTagCondition", tag }),
  inputEquals: (inputName: string, value: unknown): AuthoredCondition => ({ _tag: "WorkflowInputEqualsCondition", inputName, value }),
  upstreamStatus: (jobId: string, status: "succeeded" | "failed" | "timed_out" | "skipped" | "canceled"): AuthoredCondition => ({
    _tag: "UpstreamStatusCondition",
    unitId: jobId,
    status,
  }),
}

export const Command = {
  shell: (command: string): JobCommand => ({ _tag: "ShellCommand", command }),
  argv: (program: string, args: ReadonlyArray<string> = []): JobCommand => ({
    _tag: "ArgvCommand",
    command: [program, ...args],
  }),
}

export const Input = {
  make: (name: string, options: { readonly metadata?: AuthoredMetadata; readonly source?: AuthoredSourceMetadata } = {}): NamedDeclarationSpec => {
    const declaration: NamedDeclarationSpec = { name }
    addOptional(declaration, "metadata", options.metadata)
    addOptional(declaration, "source", options.source)
    return declaration
  },
  fromWorkflow: (name: string, inputName: string, metadata?: AuthoredMetadata): AuthoredUnitInputDeclaration =>
    publicInput(name, sourceFromWorkflowInput(inputName), metadata),
  fromJob: (name: string, unitId: string, outputName: string, metadata?: AuthoredMetadata): AuthoredUnitInputDeclaration =>
    publicInput(name, sourceFromJobOutput(unitId, outputName), metadata),
}

export const Output = {
  file: (name: string, path: string, options: { readonly format?: AuthoredDataValueFormat; readonly metadata?: AuthoredMetadata } = {}): AuthoredOutputDeclaration => {
    const output: AuthoredOutputDeclaration = { name, path }
    addOptional(output, "format", options.format)
    addOptional(output, "metadata", options.metadata)
    return output
  },
  fromWorkflow: (name: string, inputName: string, metadata?: AuthoredMetadata): AuthoredWorkflowOutputDeclaration =>
    publicOutput(name, sourceFromWorkflowInput(inputName), metadata),
  fromJob: (name: string, unitId: string, outputName: string, metadata?: AuthoredMetadata): AuthoredWorkflowOutputDeclaration =>
    publicOutput(name, sourceFromJobOutput(unitId, outputName), metadata),
}

export const Report = {
  file: (
    name: string,
    path: string,
    options: { readonly format?: AuthoredDataValueFormat; readonly contentType?: string; readonly metadata?: AuthoredMetadata } = {},
  ): AuthoredReportDeclaration => {
    const report: AuthoredReportDeclaration = { name, path }
    addOptional(report, "format", options.format)
    addOptional(report, "contentType", options.contentType)
    addOptional(report, "metadata", options.metadata)
    return report
  },
}

export const Artifact = {
  file: (name: string, path: string, options: { readonly contentType?: string; readonly metadata?: AuthoredMetadata } = {}): AuthoredArtifactDeclaration => {
    const artifact: AuthoredArtifactDeclaration = { name, kind: "file", path }
    addOptional(artifact, "contentType", options.contentType)
    addOptional(artifact, "metadata", options.metadata)
    return artifact
  },
}

export const Policy = {
  retry: (definition: Omit<AuthoredRetryPolicy, "_tag">): AuthoredRetryPolicy => ({
    _tag: "RetryPolicy",
    ...definition,
  }),
  timeout: (seconds: number): AuthoredTimeoutPolicy => ({
    _tag: "TimeoutPolicy",
    seconds,
  }),
  cancel: (mode: "best-effort" | "fail-fast"): AuthoredCancellationPolicy => ({
    _tag: "CancellationPolicy",
    mode,
  }),
}
