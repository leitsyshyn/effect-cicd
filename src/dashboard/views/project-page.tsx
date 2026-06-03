import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { z } from "zod";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../components/ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  dashboardApi,
  dashboardQueries,
  dashboardQueryKeys,
} from "../lib/dashboard-query.ts";
import {
  hrefForProject,
  hrefForProjects,
  hrefForRun,
  parseProjectPageView,
  type ProjectPageView,
} from "../lib/routing.ts";
import { ProjectBindingsTab } from "./project-bindings-tab.tsx";
import { ProjectSecretsTab } from "./project-secrets-tab.tsx";
import { projectLabel } from "./projects-page.tsx";
import { RunsTab } from "./runs-page.tsx";

const editProjectSchema = z.object({
  name: z.string().trim().optional(),
});

const runProjectSchema = z.object({
  inputValuesText: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Inputs must be a JSON object",
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inputs must be valid JSON",
      });
    }
  }),
});

type EditProjectFormValues = z.infer<typeof editProjectSchema>;
type RunProjectFormValues = z.infer<typeof runProjectSchema>;

export function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRunOpen, setIsRunOpen] = useState(false);
  const projectId = params.projectId;

  if (projectId === undefined) {
    return null;
  }

  const projectQuery = useQuery(dashboardQueries.project(projectId));
  const projectRunConfigQuery = useQuery(
    dashboardQueries.projectRunConfig(
      projectId,
      projectQuery.data?.provider === "local",
    ),
  );
  const activeView: ProjectPageView =
    parseProjectPageView(searchParams.get("view")) ?? "runs";
  const label =
    projectQuery.data === null || projectQuery.data === undefined
      ? projectId
      : projectLabel(projectQuery.data);
  const form = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: { name: projectQuery.data?.name ?? "" },
  });
  const runForm = useForm<RunProjectFormValues>({
    resolver: zodResolver(runProjectSchema),
    defaultValues: { inputValuesText: "" },
  });

  useEffect(() => {
    form.reset({ name: projectQuery.data?.name ?? "" });
  }, [form, projectQuery.data?.name]);

  const updateProjectMutation = useMutation({
    mutationFn: (values: EditProjectFormValues) =>
      dashboardApi.updateProject(
        projectId,
        values.name === undefined || values.name.trim().length === 0
          ? {}
          : { name: values.name.trim() },
      ),
    onSuccess: async (_, values) => {
      setIsEditOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projects,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.bindings,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.project(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projectBindings(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projectSecrets(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projectRuns(projectId),
        }),
      ]);
      form.reset({ name: values.name?.trim() ?? "" });
      navigate(
        hrefForProject(
          projectId,
          activeView === "runs" ? undefined : activeView,
        ),
        { replace: true },
      );
    },
  });

  const startRunMutation = useMutation({
    mutationFn: (request?: {
      readonly inputValues?: Record<string, unknown>;
    }) => dashboardApi.startProjectRun(projectId, request),
    onSuccess: async (run) => {
      setIsRunOpen(false);
      runForm.reset({ inputValuesText: "" });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projects,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projectRuns(projectId),
        }),
      ]);
      navigate(hrefForRun(run.runId));
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => dashboardApi.deleteProject(projectId),
    onSuccess: async () => {
      setIsDeleteOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projects,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.bindings,
        }),
      ]);
      navigate(hrefForProjects(), { replace: true });
    },
  });

  const submitEdit = form.handleSubmit(async (values) => {
    await updateProjectMutation.mutateAsync(values);
  });

  const submitRun = runForm.handleSubmit(async (values) => {
    await startRunMutation.mutateAsync(toProjectRunRequest(values));
  });

  const startProjectRun = async () => {
    const requiredInputs = projectRunConfigQuery.data?.requiredInputs ?? [];

    if (requiredInputs.length === 0) {
      await startRunMutation.mutateAsync(undefined);
      return;
    }

    setIsRunOpen(true);
  };

  const setActiveView = (view: ProjectPageView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (view === "runs") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", view);
    }
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <section className="grid gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={hrefForProjects()}>Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {projectQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load project details</AlertTitle>
          <AlertDescription>{projectQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {updateProjectMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to update project</AlertTitle>
          <AlertDescription>
            {updateProjectMutation.error.message}
          </AlertDescription>
        </Alert>
      )}

      {deleteProjectMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to delete project</AlertTitle>
          <AlertDescription>
            {deleteProjectMutation.error.message}
          </AlertDescription>
        </Alert>
      )}

      {startRunMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to start project run</AlertTitle>
          <AlertDescription>{startRunMutation.error.message}</AlertDescription>
        </Alert>
      )}

      {projectRunConfigQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load workflow input requirements</AlertTitle>
          <AlertDescription>
            {projectRunConfigQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{label}</h1>
          <p className="font-mono text-sm text-muted-foreground">{projectId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projectQuery.data?.provider === "local" ? (
            <Dialog open={isRunOpen} onOpenChange={setIsRunOpen}>
              <Button
                size="sm"
                onClick={() => void startProjectRun()}
                disabled={
                  startRunMutation.isPending ||
                  updateProjectMutation.isPending ||
                  deleteProjectMutation.isPending ||
                  projectRunConfigQuery.isPending
                }
              >
                <Play data-icon="inline-start" />
                {startRunMutation.isPending
                  ? "Starting..."
                  : projectRunConfigQuery.isPending
                    ? "Loading..."
                    : "Run Now"}
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Run Project</DialogTitle>
                  <DialogDescription>
                    Provide workflow input values as a JSON object.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={(event) => void submitRun(event)}>
                  <FieldGroup>
                    <Field
                      data-invalid={
                        runForm.formState.errors.inputValuesText !== undefined
                      }
                    >
                      <FieldLabel htmlFor="project-run-inputs">
                        Workflow Inputs
                      </FieldLabel>
                      <Textarea
                        id="project-run-inputs"
                        className="min-h-32 font-mono text-sm"
                        aria-invalid={
                          runForm.formState.errors.inputValuesText !== undefined
                        }
                        placeholder={'{"release":"1.2.3"}'}
                        {...runForm.register("inputValuesText")}
                      />
                      <FieldDescription>
                        Required inputs:{" "}
                        {(
                          projectRunConfigQuery.data?.requiredInputs ?? []
                        ).join(", ")}
                      </FieldDescription>
                      {runForm.formState.errors.inputValuesText ===
                      undefined ? null : (
                        <FieldError>
                          {runForm.formState.errors.inputValuesText.message}
                        </FieldError>
                      )}
                    </Field>
                  </FieldGroup>
                </form>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      runForm.reset({ inputValuesText: "" });
                      setIsRunOpen(false);
                    }}
                    disabled={startRunMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void submitRun()}
                    disabled={startRunMutation.isPending}
                  >
                    {startRunMutation.isPending ? "Starting..." : "Start Run"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Project Name</DialogTitle>
                <DialogDescription>
                  Set a display name for this project. Leave it blank to use the
                  default label.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => void submitEdit(event)}>
                <FieldGroup>
                  <Field
                    data-invalid={form.formState.errors.name !== undefined}
                  >
                    <FieldLabel htmlFor="project-name">Project Name</FieldLabel>
                    <Input
                      id="project-name"
                      aria-invalid={form.formState.errors.name !== undefined}
                      placeholder="Optional display name"
                      {...form.register("name")}
                    />
                    {form.formState.errors.name === undefined ? null : (
                      <FieldError>
                        {form.formState.errors.name.message}
                      </FieldError>
                    )}
                  </Field>
                </FieldGroup>
              </form>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditOpen(false)}
                  disabled={updateProjectMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitEdit()}
                  disabled={updateProjectMutation.isPending}
                >
                  {updateProjectMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Project</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the project, its runs, bindings, secrets, and
                  stored artifacts. Active or queued runs must finish first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleteProjectMutation.isPending}
                  >
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    variant="destructive"
                    onClick={() => void deleteProjectMutation.mutateAsync()}
                    disabled={deleteProjectMutation.isPending}
                  >
                    {deleteProjectMutation.isPending
                      ? "Deleting..."
                      : "Delete Project"}
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as ProjectPageView)}
      >
        <TabsList className="grid w-full max-w-sm grid-cols-3">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <RunsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="bindings">
          <ProjectBindingsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="secrets">
          <ProjectSecretsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

const toProjectRunRequest = (values: RunProjectFormValues) => {
  const trimmed = values.inputValuesText.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return {
    inputValues: JSON.parse(trimmed) as Record<string, unknown>,
  };
};
