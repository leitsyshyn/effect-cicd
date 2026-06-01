import { Effect, Layer } from "effect"
import * as Context from "effect/Context"

import { DslMaterializationFailed } from "../domain/errors.ts"
import { UnitId, WorkflowId } from "../domain/ids.ts"
import { isSecretRef } from "../domain/secrets.ts"
import {
  ArtifactDeclaration,
  CancellationPolicyDeclaration,
  ContainerCommandDeclaration,
  DependencyDeclaration,
  NamedDeclaration,
  OutputDeclaration,
  ReportDeclaration,
  RetryPolicyDeclaration,
  SourceMetadata,
  TimeoutPolicyDeclaration,
  UnitDeclaration,
  UnitInputDeclaration,
  UnitOutputSourceDeclaration,
  WorkflowInputSourceDeclaration,
  WorkflowOutputDeclaration,
} from "../domain/workflow-definition.ts"
import { NormalizedWorkflowDefinition } from "../domain/workflow-definition.ts"
import type {
  AuthoredArtifactDeclaration,
  AuthoredContainerCommand,
  AuthoredNamedDeclaration,
  AuthoredOutputDeclaration,
  AuthoredPolicy,
  AuthoredReportDeclaration,
  AuthoredSourceMetadata,
  AuthoredUnit,
  AuthoredUnitInputDeclaration,
  AuthoredValueSource,
  AuthoredWorkflow,
  AuthoredWorkflowOutputDeclaration,
} from "./authored-workflow.ts"

export class DslMaterializer extends Context.Service<
  DslMaterializer,
  {
    readonly materialize: (authored: AuthoredWorkflow) => Effect.Effect<NormalizedWorkflowDefinition, DslMaterializationFailed>
  }
>()("@effect-cicd/dsl/DslMaterializer") {
  static readonly layer = Layer.succeed(DslMaterializer, {
    materialize: Effect.fn("DslMaterializer.materialize")((authored: AuthoredWorkflow) => materialize(authored)),
  })
}

const schemaVersion = "0.1.0"

const materialize = Effect.fn("dsl.materialize")(function* (authored: AuthoredWorkflow) {
  if (authored.workflowId.trim().length === 0) {
    return yield* fail("Workflow id is required")
  }

  if (authored.name.trim().length === 0) {
    return yield* fail("Workflow name must be non-empty")
  }

  if (authored.units.length === 0) {
    return yield* fail("Workflow must declare at least one unit")
  }

  const unitIds = new Set<string>()
  for (const authoredUnit of authored.units) {
    if (unitIds.has(authoredUnit.unitId)) {
      return yield* fail(`Duplicate unit id: ${authoredUnit.unitId}`)
    }

    unitIds.add(authoredUnit.unitId)

    if (authoredUnit.name.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} name must be non-empty`)
    }

      yield* validateCommand(authoredUnit)
      yield* validateArtifacts(authoredUnit)
      yield* validateInputs(authoredUnit)
      yield* validateOutputs(authoredUnit)
      yield* validateReports(authoredUnit)
      yield* validatePolicies(authoredUnit)
    }

  const dependencies = new Array<DependencyDeclaration>()
  const dependencyIds = new Set<string>()

  for (const authoredUnit of authored.units) {
    for (const dependencyTarget of authoredUnit.dependsOn ?? []) {
      if (!unitIds.has(dependencyTarget)) {
        return yield* fail(`Dependency target does not reference an existing unit: ${dependencyTarget}`)
      }

      if (dependencyTarget === authoredUnit.unitId) {
        return yield* fail(`Unit ${authoredUnit.unitId} cannot depend on itself`)
      }

      const dependencyId = dependencyKey(authoredUnit.unitId, dependencyTarget)
      if (dependencyIds.has(dependencyId)) {
        return yield* fail(`Duplicate dependency: ${authoredUnit.unitId} -> ${dependencyTarget}`)
      }

      dependencyIds.add(dependencyId)
      dependencies.push(
        new DependencyDeclaration({
          from: UnitId.make(dependencyTarget),
          to: UnitId.make(authoredUnit.unitId),
          metadata: {},
        }),
      )
    }
  }

  return new NormalizedWorkflowDefinition({
    schemaVersion,
    workflowId: WorkflowId.make(authored.workflowId),
    name: authored.name,
    metadata: toMetadata(authored.metadata),
    units: authored.units.map(toUnitDeclaration),
    dependencies,
    inputs: toNamedDeclarations(authored.inputs),
    outputs: toWorkflowOutputDeclarations(authored.outputs),
    artifacts: toArtifactDeclarations(authored.artifacts),
    reports: toNamedDeclarations(authored.reports),
    source: toSourceMetadata(authored.source),
  })
})

const validateCommand = (authoredUnit: AuthoredUnit) => {
  if (authoredUnit.command._tag !== "ContainerCommand") {
    return fail(`Unit ${authoredUnit.unitId} uses an unsupported command declaration`)
  }

  for (const [name, value] of Object.entries(authoredUnit.command.env ?? {})) {
    if (name.trim().length === 0) {
      return fail(`Unit ${authoredUnit.unitId} env name must be non-empty`)
    }

    if (isSecretRef(value) && value.key.trim().length === 0) {
      return fail(`Unit ${authoredUnit.unitId} secret env ${name} must reference a non-empty key`)
    }
  }

  return Effect.void
}

const validatePolicies = Effect.fn("dsl.validatePolicies")(function* (authoredUnit: AuthoredUnit) {
  for (const policy of authoredUnit.policies ?? []) {
    switch (policy._tag) {
      case "RetryPolicy":
      case "TimeoutPolicy":
      case "CancellationPolicy":
        break
      default:
        return yield* fail(`Unit ${authoredUnit.unitId} uses an unsupported policy declaration`)
    }
  }
})

const validateArtifacts = Effect.fn("dsl.validateArtifacts")(function* (authoredUnit: AuthoredUnit) {
  for (const artifact of authoredUnit.artifacts ?? []) {
    if (artifact.name.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} artifact name must be non-empty`)
    }

    if (artifact.path.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} artifact ${artifact.name} path must be non-empty`)
    }
  }
})

const validateInputs = Effect.fn("dsl.validateInputs")(function* (authoredUnit: AuthoredUnit) {
  for (const input of authoredUnit.inputs ?? []) {
    if (input.name.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} input name must be non-empty`)
    }
  }
})

const validateOutputs = Effect.fn("dsl.validateOutputs")(function* (authoredUnit: AuthoredUnit) {
  for (const output of authoredUnit.outputs ?? []) {
    if (output.name.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} output name must be non-empty`)
    }

    if (output.path.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} output ${output.name} path must be non-empty`)
    }
  }
})

const validateReports = Effect.fn("dsl.validateReports")(function* (authoredUnit: AuthoredUnit) {
  for (const report of authoredUnit.reports ?? []) {
    if (report.name.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} report name must be non-empty`)
    }

    if (report.path.trim().length === 0) {
      return yield* fail(`Unit ${authoredUnit.unitId} report ${report.name} path must be non-empty`)
    }
  }
})

const toUnitDeclaration = (authoredUnit: AuthoredUnit) =>
  new UnitDeclaration({
    unitId: UnitId.make(authoredUnit.unitId),
    name: authoredUnit.name,
    payloadDeclaration: toCommandDeclaration(authoredUnit.command),
    metadata: toMetadata(authoredUnit.metadata),
    inputs: toUnitInputDeclarations(authoredUnit.inputs),
    outputs: toOutputDeclarations(authoredUnit.outputs),
    reports: toReportDeclarations(authoredUnit.reports),
    artifacts: toArtifactDeclarations(authoredUnit.artifacts),
    policies: toPolicyDeclarations(authoredUnit.policies),
    source: toSourceMetadata(authoredUnit.source),
  })

const toCommandDeclaration = (command: AuthoredContainerCommand) =>
  new ContainerCommandDeclaration({
    image: command.image,
    command: [...command.command],
    env: command.env === undefined ? undefined : { ...command.env },
    workingDirectory: command.workingDirectory,
  })

const toNamedDeclarations = (declarations: ReadonlyArray<AuthoredNamedDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new NamedDeclaration({
        name: declaration.name,
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toUnitInputDeclarations = (declarations: ReadonlyArray<AuthoredUnitInputDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new UnitInputDeclaration({
        name: declaration.name,
        from: toValueSourceDeclaration(declaration.from),
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toOutputDeclarations = (declarations: ReadonlyArray<AuthoredOutputDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new OutputDeclaration({
        name: declaration.name,
        path: declaration.path,
        format: declaration.format ?? "json",
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toReportDeclarations = (declarations: ReadonlyArray<AuthoredReportDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new ReportDeclaration({
        name: declaration.name,
        path: declaration.path,
        format: declaration.format ?? "text",
        contentType: declaration.contentType,
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toWorkflowOutputDeclarations = (declarations: ReadonlyArray<AuthoredWorkflowOutputDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new WorkflowOutputDeclaration({
        name: declaration.name,
        from: toValueSourceDeclaration(declaration.from),
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toArtifactDeclarations = (declarations: ReadonlyArray<AuthoredArtifactDeclaration> | undefined) =>
  (declarations ?? []).map(
    (declaration) =>
      new ArtifactDeclaration({
        name: declaration.name,
        kind: declaration.kind ?? "file",
        path: declaration.path,
        contentType: declaration.contentType,
        metadata: toMetadata(declaration.metadata),
        source: toSourceMetadata(declaration.source),
      }),
  )

const toPolicyDeclarations = (policies: ReadonlyArray<AuthoredPolicy> | undefined) =>
  (policies ?? []).map((policy) => {
    switch (policy._tag) {
      case "RetryPolicy":
        return new RetryPolicyDeclaration({ maxAttempts: policy.maxAttempts })
      case "TimeoutPolicy":
        return new TimeoutPolicyDeclaration({ seconds: policy.seconds })
      case "CancellationPolicy":
        return new CancellationPolicyDeclaration({ mode: policy.mode })
      }
  })

const toValueSourceDeclaration = (source: AuthoredValueSource) => {
  switch (source._tag) {
    case "WorkflowInputSource":
      return new WorkflowInputSourceDeclaration({ inputName: source.inputName })
    case "UnitOutputSource":
      return new UnitOutputSourceDeclaration({
        unitId: UnitId.make(source.unitId),
        outputName: source.outputName,
      })
  }
}

const toMetadata = (metadata: Readonly<Record<string, unknown>> | undefined) => ({ ...(metadata ?? {}) })

const toSourceMetadata = (source: AuthoredSourceMetadata | undefined) =>
  source === undefined
    ? undefined
    : new SourceMetadata({
        file: source.file,
        line: source.line,
        column: source.column,
        origin: source.origin,
      })

const fail = (message: string) => Effect.fail(new DslMaterializationFailed({ message }))

const dependencyKey = (from: string, to: string) => `${from}\u0000${to}`
