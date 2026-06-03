import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Link2, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import type {
  GitHubBindingCreateRequestDto,
  LocalProjectCreateRequestDto,
} from "../api.ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
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
import {
  dashboardApi,
  dashboardQueries,
  dashboardQueryKeys,
} from "../lib/dashboard-query.ts";
import { StatusTimestampPill } from "../components/status-timestamp-pill.tsx";
import { hrefForProject } from "../lib/routing.ts";
import { useStreamQueryRefresh } from "../lib/use-stream-query-refresh.ts";

const localProjectSchema = z.object({
  workflowModulePath: z.string().trim().min(1, "Workflow file is required."),
  workspacePath: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
});

const gitHubProjectSchema = z.object({
  repository: z
    .string()
    .trim()
    .regex(/^[^/\s]+\/[^/\s]+$/, "Repository must use owner/name."),
  installationId: z.coerce
    .number()
    .int()
    .positive("Installation ID must be a positive number."),
  workflowModulePath: z
    .string()
    .trim()
    .min(1, "Workflow module path is required."),
  branch: z.string().trim().optional(),
  workspaceSubdir: z.string().trim().optional(),
});

type LocalProjectFormValues = z.infer<typeof localProjectSchema>;
type LocalProjectFormInput = z.input<typeof localProjectSchema>;
type GitHubProjectFormValues = z.infer<typeof gitHubProjectSchema>;
type GitHubProjectFormInput = z.input<typeof gitHubProjectSchema>;

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery(dashboardQueries.projects());
  const workflowFilesQuery = useQuery(dashboardQueries.workflowFiles());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const projects = projectsQuery.data ?? [];

  useStreamQueryRefresh("/api/runs/stream", dashboardQueries.projects().queryKey, "run-update")

  const localForm = useForm<
    LocalProjectFormInput,
    unknown,
    LocalProjectFormValues
  >({
    resolver: zodResolver(localProjectSchema),
    defaultValues: { workflowModulePath: "", workspacePath: "", projectId: "" },
  });

  const gitHubForm = useForm<
    GitHubProjectFormInput,
    unknown,
    GitHubProjectFormValues
  >({
    resolver: zodResolver(gitHubProjectSchema),
    defaultValues: {
      repository: "",
      installationId: "",
      workflowModulePath: "",
      branch: "",
      workspaceSubdir: "",
    },
  });
  const gitHubInstallationIdValue = useWatch({
    control: gitHubForm.control,
    name: "installationId",
  });
  const gitHubRepositoryValue = useWatch({
    control: gitHubForm.control,
    name: "repository",
  });
  const gitHubBranchValue = useWatch({
    control: gitHubForm.control,
    name: "branch",
  });
  const gitHubInstallationId = toPositiveInteger(gitHubInstallationIdValue);
  const gitHubRepository =
    typeof gitHubRepositoryValue === "string"
      ? gitHubRepositoryValue.trim()
      : "";
  const gitHubBranch =
    typeof gitHubBranchValue === "string" ? gitHubBranchValue.trim() : "";
  const gitHubRepositoriesQuery = useQuery(
    dashboardQueries.githubRepositories(gitHubInstallationId),
  );
  const gitHubBranchesQuery = useQuery(
    dashboardQueries.githubBranches(gitHubInstallationId, gitHubRepository),
  );
  const gitHubWorkflowFilesQuery = useQuery(
    dashboardQueries.githubWorkflowFiles(
      gitHubInstallationId,
      gitHubRepository,
      gitHubBranch.length === 0 ? undefined : gitHubBranch,
    ),
  );
  const selectedGitHubRepository = (gitHubRepositoriesQuery.data ?? []).find(
    (repository) => repository.repository === gitHubRepository,
  );

  const createLocalProjectMutation = useMutation({
    mutationFn: (values: LocalProjectFormValues) => {
      const payload: LocalProjectCreateRequestDto = {
        workflowModulePath: values.workflowModulePath.trim(),
        ...(values.workspacePath === undefined ||
        values.workspacePath.length === 0
          ? {}
          : { workspacePath: values.workspacePath }),
        ...(values.projectId === undefined || values.projectId.length === 0
          ? {}
          : { projectId: values.projectId }),
      };
      return dashboardApi.createLocalProject(payload);
    },
    onSuccess: async (project) => {
      setIsCreateOpen(false);
      localForm.reset();
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.projects,
      });
      navigate(hrefForProject(project.projectId));
    },
  });

  const createGitHubProjectMutation = useMutation({
    mutationFn: (values: GitHubProjectFormValues) => {
      const payload: GitHubBindingCreateRequestDto = {
        repository: values.repository.trim(),
        installationId: values.installationId,
        workflowModulePath: values.workflowModulePath.trim(),
        enabled: true,
        ...(values.branch === undefined || values.branch.length === 0
          ? {}
          : { branch: values.branch }),
        ...(values.workspaceSubdir === undefined ||
        values.workspaceSubdir.length === 0
          ? {}
          : { workspaceSubdir: values.workspaceSubdir }),
      };
      return dashboardApi.createBinding(payload);
    },
    onSuccess: async (binding) => {
      setIsCreateOpen(false);
      gitHubForm.reset();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.projects,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.bindings,
        }),
      ]);
      navigate(hrefForProject(binding.projectId));
    },
  });

  const submitLocalProject = localForm.handleSubmit(async (values) => {
    await createLocalProjectMutation.mutateAsync(values);
  });

  const submitGitHubProject = gitHubForm.handleSubmit(async (values) => {
    await createGitHubProjectMutation.mutateAsync(values);
  });

  const createProjectDialog = (
    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a local project from a workflow file or connect a GitHub
            repository.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="local">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local">Local</TabsTrigger>
            <TabsTrigger value="github">GitHub</TabsTrigger>
          </TabsList>

          <TabsContent value="local">
            <form
              onSubmit={(event) => void submitLocalProject(event)}
              className="grid gap-4"
            >
              <FieldGroup>
                <Field
                  data-invalid={
                    localForm.formState.errors.workflowModulePath !== undefined
                  }
                >
                  <FieldLabel htmlFor="local-workflow-module-path">
                    Workflow File
                  </FieldLabel>
                  <Input
                    id="local-workflow-module-path"
                    list="workflow-file-options"
                    placeholder="workflows/build.ts"
                    aria-invalid={
                      localForm.formState.errors.workflowModulePath !==
                      undefined
                    }
                    {...localForm.register("workflowModulePath")}
                  />
                  <datalist id="workflow-file-options">
                    {(workflowFilesQuery.data ?? []).map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {workflowFilesQuery.data === undefined ||
                    workflowFilesQuery.data.length === 0
                      ? "Type a workflow module path relative to the workspace."
                      : "Select a discovered workflow file or type a path manually."}
                  </FieldDescription>
                  {localForm.formState.errors.workflowModulePath ===
                  undefined ? null : (
                    <FieldError>
                      {localForm.formState.errors.workflowModulePath.message}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="local-project-id">Project ID</FieldLabel>
                  <Input
                    id="local-project-id"
                    placeholder="Optional. Defaults to the workflow ID."
                    {...localForm.register("projectId")}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="local-workspace-path">
                    Workspace Path
                  </FieldLabel>
                  <Input
                    id="local-workspace-path"
                    placeholder="Optional. Defaults to the workflow file directory."
                    {...localForm.register("workspacePath")}
                  />
                </Field>
              </FieldGroup>
            </form>

            {createLocalProjectMutation.error === null ? null : (
              <FieldError className="mt-4 block">
                {createLocalProjectMutation.error.message}
              </FieldError>
            )}

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={createLocalProjectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitLocalProject()}
                disabled={createLocalProjectMutation.isPending}
              >
                {createLocalProjectMutation.isPending
                  ? "Creating..."
                  : "Create Local Project"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="github">
            <form
              onSubmit={(event) => void submitGitHubProject(event)}
              className="grid gap-4"
            >
              <FieldGroup>
                <Field
                  data-invalid={
                    gitHubForm.formState.errors.repository !== undefined
                  }
                >
                  <FieldLabel htmlFor="github-repository">
                    Repository
                  </FieldLabel>
                  <Input
                    id="github-repository"
                    list="github-project-repository-options"
                    placeholder="owner/name"
                    aria-invalid={
                      gitHubForm.formState.errors.repository !== undefined
                    }
                    {...gitHubForm.register("repository")}
                  />
                  <datalist id="github-project-repository-options">
                    {(gitHubRepositoriesQuery.data ?? []).map((repository) => (
                      <option
                        key={`${repository.installationId}:${repository.repositoryId}`}
                        value={repository.repository}
                      />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {gitHubInstallationId <= 0
                      ? "Enter an installation ID to load repositories available to the GitHub App."
                      : gitHubRepositoriesQuery.isPending
                        ? "Loading repositories for this installation..."
                        : gitHubRepositoriesQuery.error !== null
                          ? gitHubRepositoriesQuery.error.message
                          : gitHubRepositoriesQuery.data !== undefined &&
                              gitHubRepositoriesQuery.data.length > 0
                            ? "Select a repository available to this GitHub App installation or type one manually."
                            : "No repositories were returned for this installation. You can still type owner/name manually."}
                  </FieldDescription>
                  {gitHubForm.formState.errors.repository ===
                  undefined ? null : (
                    <FieldError>
                      {gitHubForm.formState.errors.repository.message}
                    </FieldError>
                  )}
                </Field>

                <Field
                  data-invalid={
                    gitHubForm.formState.errors.installationId !== undefined
                  }
                >
                  <FieldLabel htmlFor="github-installation-id">
                    Installation ID
                  </FieldLabel>
                  <Input
                    id="github-installation-id"
                    inputMode="numeric"
                    aria-invalid={
                      gitHubForm.formState.errors.installationId !== undefined
                    }
                    {...gitHubForm.register("installationId", {
                      setValueAs: (value) =>
                        typeof value === "string" && value.trim().length === 0
                          ? undefined
                          : Number(value),
                    })}
                  />
                  {gitHubForm.formState.errors.installationId ===
                  undefined ? null : (
                    <FieldError>
                      {gitHubForm.formState.errors.installationId.message}
                    </FieldError>
                  )}
                </Field>

                <Field
                  data-invalid={
                    gitHubForm.formState.errors.workflowModulePath !== undefined
                  }
                >
                  <FieldLabel htmlFor="github-workflow-module-path">
                    Workflow Module Path
                  </FieldLabel>
                  <Input
                    id="github-workflow-module-path"
                    list="github-workflow-file-options"
                    placeholder="workflows/build.ts"
                    aria-invalid={
                      gitHubForm.formState.errors.workflowModulePath !==
                      undefined
                    }
                    {...gitHubForm.register("workflowModulePath")}
                  />
                  <datalist id="github-workflow-file-options">
                    {(gitHubWorkflowFilesQuery.data ?? []).map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {gitHubInstallationId <= 0 || gitHubRepository.length === 0
                      ? "Select a repository first to load workflow files from GitHub."
                      : gitHubWorkflowFilesQuery.isPending
                        ? "Loading workflow files from the repository..."
                        : gitHubWorkflowFilesQuery.error !== null
                          ? gitHubWorkflowFilesQuery.error.message
                          : gitHubWorkflowFilesQuery.data !== undefined &&
                              gitHubWorkflowFilesQuery.data.length > 0
                            ? "Select a discovered workflow file from the repository or type one manually."
                            : "No workflow files were discovered for the selected repository and branch."}
                  </FieldDescription>
                  {gitHubForm.formState.errors.workflowModulePath ===
                  undefined ? null : (
                    <FieldError>
                      {gitHubForm.formState.errors.workflowModulePath.message}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="github-branch">Branch</FieldLabel>
                  <Input
                    id="github-branch"
                    list="github-branch-options"
                    placeholder={
                      selectedGitHubRepository?.defaultBranch ?? "main"
                    }
                    {...gitHubForm.register("branch")}
                  />
                  <datalist id="github-branch-options">
                    {(gitHubBranchesQuery.data ?? []).map((branch) => (
                      <option key={branch} value={branch} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {gitHubInstallationId <= 0 || gitHubRepository.length === 0
                      ? "Select a repository first to load available branches."
                      : gitHubBranchesQuery.isPending
                        ? "Loading branches for this repository..."
                        : gitHubBranchesQuery.error !== null
                          ? gitHubBranchesQuery.error.message
                          : gitHubBranchesQuery.data !== undefined &&
                              gitHubBranchesQuery.data.length > 0
                            ? "Leave blank to use the repository default branch, or choose a discovered branch."
                            : "No branches were discovered. Leave blank to use the repository default branch."}
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="github-workspace-subdir">
                    Workspace Subdir
                  </FieldLabel>
                  <Input
                    id="github-workspace-subdir"
                    placeholder="packages/app"
                    {...gitHubForm.register("workspaceSubdir")}
                  />
                </Field>
              </FieldGroup>
            </form>

            {createGitHubProjectMutation.error === null ? null : (
              <FieldError className="mt-4 block">
                {createGitHubProjectMutation.error.message}
              </FieldError>
            )}

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={createGitHubProjectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitGitHubProject()}
                disabled={createGitHubProjectMutation.isPending}
              >
                {createGitHubProjectMutation.isPending
                  ? "Creating..."
                  : "Create GitHub Project"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );

  if (projectsQuery.isPending) {
    return (
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          </div>
          {createProjectDialog}
        </div>
        <p className="text-sm text-muted-foreground">Loading projects...</p>
      </section>
    );
  }

  if (projectsQuery.error !== null && projectsQuery.data === undefined) {
    return (
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          </div>
          {createProjectDialog}
        </div>
        <Alert variant="destructive">
          <AlertTitle>Failed to load projects</AlertTitle>
          <AlertDescription>{projectsQuery.error.message}</AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage local or GitHub-backed projects.
          </p>
        </div>
        {createProjectDialog}
      </div>

      {workflowFilesQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to discover local workflow files</AlertTitle>
          <AlertDescription>
            {workflowFilesQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      {projects.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>No projects</CardTitle>
              <CardDescription>
                Create a local project from a workflow file or connect a GitHub
                repository.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.projectId}
              to={hrefForProject(project.projectId)}
              className="block w-full text-left"
            >
              <Card className="h-full border-border/60 bg-card/80 transition-all hover:border-border hover:bg-accent/20">
                <CardHeader className="gap-3">
                  <CardTitle className="min-w-0 truncate text-xl leading-tight">
                    {projectLabel(project)}
                  </CardTitle>
                  <CardDescription className="truncate font-mono text-xs text-muted-foreground/80">
                    {project.projectId}
                  </CardDescription>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{project.provider}</Badge>
                    <Badge
                      variant="secondary"
                      className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground"
                    >
                      <Link2 className="size-3.5" />
                      {formatCount(project.bindingCount, "binding")}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground"
                    >
                      <Activity className="size-3.5" />
                      {formatCount(project.runCount, "run")}
                    </Badge>
                  </div>
                  {project.latestRunAt && (
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusTimestampPill
                        {...(project.latestRunAt == null
                          ? {}
                          : { timestamp: project.latestRunAt })}
                        {...(project.latestRunStatus == null
                          ? {}
                          : { status: project.latestRunStatus })}
                      />
                    </div>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const toPositiveInteger = (value: unknown) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const formatCount = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export const projectLabel = (project: {
  readonly projectId: string;
  readonly name?: string | null;
  readonly repositoryOwner?: string | null;
  readonly repositoryName?: string | null;
}) => {
  const name = typeof project.name === "string" ? project.name.trim() : "";
  const repositoryOwner =
    typeof project.repositoryOwner === "string"
      ? project.repositoryOwner.trim()
      : "";
  const repositoryName =
    typeof project.repositoryName === "string"
      ? project.repositoryName.trim()
      : "";

  return name.length > 0
    ? name
    : repositoryOwner.length > 0 && repositoryName.length > 0
      ? `${repositoryOwner}/${repositoryName}`
      : project.projectId;
};
