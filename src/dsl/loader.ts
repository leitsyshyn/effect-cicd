import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { AuthoredWorkflow } from "./authored-workflow.ts";

export class WorkflowModuleNotFound extends Schema.TaggedErrorClass<WorkflowModuleNotFound>()(
  "WorkflowModuleNotFound",
  {
    modulePath: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowModuleImportFailed extends Schema.TaggedErrorClass<WorkflowModuleImportFailed>()(
  "WorkflowModuleImportFailed",
  {
    modulePath: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowModuleMissingExport extends Schema.TaggedErrorClass<WorkflowModuleMissingExport>()(
  "WorkflowModuleMissingExport",
  {
    modulePath: Schema.String,
    exportName: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export class WorkflowModuleInvalidExport extends Schema.TaggedErrorClass<WorkflowModuleInvalidExport>()(
  "WorkflowModuleInvalidExport",
  {
    modulePath: Schema.String,
    exportName: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export type WorkflowModuleLoaderError =
  | WorkflowModuleNotFound
  | WorkflowModuleImportFailed
  | WorkflowModuleMissingExport
  | WorkflowModuleInvalidExport;

export interface WorkflowModuleLoadOptions {
  readonly exportName?: string;
}

export class WorkflowModuleLoader extends Context.Service<
  WorkflowModuleLoader,
  {
    readonly resolve: (modulePath: string) => Effect.Effect<string, WorkflowModuleNotFound>;
    readonly load: (
      modulePath: string,
      options?: WorkflowModuleLoadOptions,
    ) => Effect.Effect<AuthoredWorkflow, WorkflowModuleLoaderError>;
  }
>()("@effect-cicd/dsl/WorkflowModuleLoader") {
  static readonly layer = Layer.succeed(WorkflowModuleLoader, {
    resolve: Effect.fn("WorkflowModuleLoader.resolve")((modulePath: string) => resolveWorkflowModulePath(modulePath)),
    load: Effect.fn("WorkflowModuleLoader.load")(
      (modulePath: string, options?: WorkflowModuleLoadOptions) =>
        loadWorkflowModule(modulePath, options),
    ),
  });
}

const loadWorkflowModule = Effect.fn("dsl.loadWorkflowModule")(function* (
  modulePath: string,
  options?: WorkflowModuleLoadOptions,
) {
  const resolved = yield* resolveWorkflowModulePath(modulePath);
  const moduleUrl = Bun.pathToFileURL(resolved).href;

  const moduleNamespace = yield* Effect.tryPromise({
    try: () => import(moduleUrl),
    catch: (error) =>
      new WorkflowModuleImportFailed({
        modulePath,
        message: `Failed to import workflow module: ${toErrorMessage(error)}`,
      }),
  });

  const exportName = options?.exportName;
  if (exportName !== undefined) {
    return yield* extractExport(modulePath, moduleNamespace, exportName);
  }

  if ("default" in moduleNamespace) {
    const candidate = (moduleNamespace as Record<string, unknown>).default;
    if (isAuthoredWorkflow(candidate)) {
      return candidate;
    }
    if (candidate !== undefined) {
      return yield* new WorkflowModuleInvalidExport({
        modulePath,
        exportName: "default",
        message: "Default export is not an authored workflow",
      });
    }
  }

  if ("workflow" in moduleNamespace) {
    return yield* extractExport(modulePath, moduleNamespace, "workflow");
  }

  return yield* new WorkflowModuleMissingExport({
    modulePath,
    exportName: undefined,
    message:
      "Expected a workflow export (default export or named export `workflow`)",
  });
});

const resolveWorkflowModulePath = (modulePath: string) =>
  Effect.try({
    try: () => {
      if (isAbsolute(modulePath)) {
        if (!existsSync(modulePath)) {
          throw new Error(`Module path does not exist: ${modulePath}`);
        }

        return modulePath;
      }

      return Bun.resolveSync(modulePath, process.cwd());
    },
    catch: (error) =>
      new WorkflowModuleNotFound({
        modulePath,
        message: `Failed to resolve workflow module path: ${toErrorMessage(error)}`,
      }),
  });

const extractExport = (
  modulePath: string,
  moduleNamespace: unknown,
  exportName: string,
) => {
  const namespace = moduleNamespace as Record<string, unknown>;

  if (!(exportName in namespace)) {
    return Effect.fail(
      new WorkflowModuleMissingExport({
        modulePath,
        exportName,
        message: `Missing export: ${exportName}`,
      }),
    );
  }

  const value = namespace[exportName];
  if (!isAuthoredWorkflow(value)) {
    return Effect.fail(
      new WorkflowModuleInvalidExport({
        modulePath,
        exportName,
        message: `Export ${exportName} is not an authored workflow`,
      }),
    );
  }

  return Effect.succeed(value);
};

const isAuthoredWorkflow = (value: unknown): value is AuthoredWorkflow => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.workflowId !== "string" ||
    record.workflowId.trim().length === 0
  ) {
    return false;
  }
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(record.units) || record.units.length === 0) {
    return false;
  }

  for (const unit of record.units) {
    if (typeof unit !== "object" || unit === null) {
      return false;
    }
    const unitRecord = unit as Record<string, unknown>;
    if (
      typeof unitRecord.unitId !== "string" ||
      unitRecord.unitId.trim().length === 0
    ) {
      return false;
    }
    if (
      typeof unitRecord.name !== "string" ||
      unitRecord.name.trim().length === 0
    ) {
      return false;
    }
    if (typeof unitRecord.command !== "object" || unitRecord.command === null) {
      return false;
    }
    const command = unitRecord.command as Record<string, unknown>;
    if (command._tag !== "ContainerCommand") {
      return false;
    }
    if (
      typeof command.image !== "string" ||
      command.image.trim().length === 0
    ) {
      return false;
    }
    if (!Array.isArray(command.command) || command.command.length === 0) {
      return false;
    }
    if (
      typeof command.command[0] !== "string" ||
      (command.command[0] as string).trim().length === 0
    ) {
      return false;
    }
  }

  return true;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
};
