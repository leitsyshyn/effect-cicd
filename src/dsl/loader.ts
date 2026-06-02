import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isWorkflowAuthoring, type WorkflowAuthoring } from "./public.ts";

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
      ) => Effect.Effect<WorkflowAuthoring, WorkflowModuleLoaderError>;
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
  const moduleNamespace = yield* importWorkflowModule(resolved, modulePath);

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

const importWorkflowModule = (resolvedModulePath: string, modulePath: string) => {
  const importOnce = (cacheKey: string) =>
    Effect.tryPromise({
      try: () => import(`${Bun.pathToFileURL(resolvedModulePath).href}?effect-cicd-load=${cacheKey}`),
      catch: (error) =>
        new WorkflowModuleImportFailed({
          modulePath,
          message: `Failed to import workflow module: ${toErrorMessage(error)}`,
        }),
    });

  return importOnce("initial").pipe(
    Effect.catch((error) =>
      missingBundledDslImport(error)
        ? Effect.try({
            try: () => ensureBundledDslPackage(resolvedModulePath),
            catch: (shimError) =>
              new WorkflowModuleImportFailed({
                modulePath,
                message: `Failed to prepare @effect-cicd/dsl for workflow import: ${toErrorMessage(shimError)}`,
              }),
          }).pipe(
            Effect.flatMap(() => importOnce(`shim-${Date.now()}`)),
          )
        : Effect.fail(error),
    ),
  );
};

const bundledDslPackagePath = fileURLToPath(new URL("../../packages/dsl", import.meta.url));

const ensureBundledDslPackage = (resolvedModulePath: string) => {
  const packageRoot = findNearestPackageRoot(dirname(resolvedModulePath)) ?? dirname(resolvedModulePath);
  const scopedPackageRoot = join(packageRoot, "node_modules", "@effect-cicd");
  const linkPath = join(scopedPackageRoot, "dsl");

  if (existsSync(linkPath)) {
    return;
  }

  mkdirSync(scopedPackageRoot, { recursive: true });

  try {
    symlinkSync(bundledDslPackagePath, linkPath, "dir");
  } catch (error) {
    if (!existsSync(linkPath)) {
      throw error;
    }
  }
};

const findNearestPackageRoot = (start: string): string | undefined => {
  let current = start;

  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};

const missingBundledDslImport = (error: unknown) => {
  const message = toErrorMessage(error);
  return message.includes("@effect-cicd/dsl") && message.includes("Cannot find module");
};

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

const isAuthoredWorkflow = isWorkflowAuthoring;

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
};
