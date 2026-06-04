import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";

import type { GitHubBindingCreateRequestDto } from "../api.ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import {
  dashboardApi,
  dashboardQueries,
  dashboardQueryKeys,
} from "../lib/dashboard-query.ts";
import { formatDateTime } from "../lib/format.ts";

const bindingSchema = z.object({
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

type BindingFormValues = z.infer<typeof bindingSchema>;
type BindingFormInput = z.input<typeof bindingSchema>;

export function ProjectBindingsTab(props: { readonly projectId: string }) {
  const queryClient = useQueryClient();
  const bindingsQuery = useQuery(
    dashboardQueries.projectBindings(props.projectId),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const form = useForm<BindingFormInput, unknown, BindingFormValues>({
    resolver: zodResolver(bindingSchema),
    defaultValues: {
      repository: "",
      installationId: "" as unknown as number,
      workflowModulePath: "",
      branch: "",
      workspaceSubdir: "",
    },
  });
  const installationIdValue = useWatch({
    control: form.control,
    name: "installationId",
  });
  const repositoryValue = useWatch({
    control: form.control,
    name: "repository",
  });
  const branchValue = useWatch({ control: form.control, name: "branch" });
  const installationId = toPositiveInteger(installationIdValue);
  const repository =
    typeof repositoryValue === "string" ? repositoryValue.trim() : "";
  const branch = typeof branchValue === "string" ? branchValue.trim() : "";
  const repositoriesQuery = useQuery(
    dashboardQueries.githubRepositories(installationId),
  );
  const branchesQuery = useQuery(
    dashboardQueries.githubBranches(installationId, repository),
  );
  const workflowFilesQuery = useQuery(
    dashboardQueries.githubWorkflowFiles(
      installationId,
      repository,
      branch.length === 0 ? undefined : branch,
    ),
  );
  const selectedRepository = (repositoriesQuery.data ?? []).find(
    (item) => item.repository === repository,
  );

  const createBindingMutation = useMutation({
    mutationFn: async (values: BindingFormValues) => {
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
    onSuccess: async () => {
      form.reset();
      setDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.bindings,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.project(props.projectId),
        }),
      ]);
    },
  });

  const [deleteConfirmBindingId, setDeleteConfirmBindingId] = useState<string | null>(null);

  const deleteBindingMutation = useMutation({
    mutationFn: async (bindingId: string) => {
      await dashboardApi.deleteBinding(bindingId);
    },
    onSuccess: async () => {
      setDeleteConfirmBindingId(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.bindings,
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.project(props.projectId),
        }),
      ]);
    },
  });

  const submit = form.handleSubmit(async (values) => {
    await createBindingMutation.mutateAsync(values);
  });

  const bindings = bindingsQuery.data ?? [];

  return (
    <section className="grid gap-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Add Binding
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Binding</DialogTitle>
            </DialogHeader>
            <form onSubmit={(event) => void submit(event)}>
              <FieldGroup>
                <Field
                  data-invalid={form.formState.errors.repository !== undefined}
                >
                  <FieldLabel htmlFor="binding-repository">
                    Repository
                  </FieldLabel>
                  <Input
                    id="binding-repository"
                    list="binding-repository-options"
                    placeholder="owner/name"
                    aria-invalid={
                      form.formState.errors.repository !== undefined
                    }
                    {...form.register("repository")}
                  />
                  <datalist id="binding-repository-options">
                    {(repositoriesQuery.data ?? []).map((repository) => (
                      <option
                        key={`${repository.installationId}:${repository.repositoryId}`}
                        value={repository.repository}
                      />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {installationId <= 0
                      ? "Enter an installation ID to load repositories available to the GitHub App."
                      : repositoriesQuery.isPending
                        ? "Loading repositories for this installation..."
                        : repositoriesQuery.error !== null
                          ? repositoriesQuery.error.message
                          : repositoriesQuery.data !== undefined &&
                              repositoriesQuery.data.length > 0
                            ? "Select a repository available to this installation or type one manually."
                            : "No repositories were returned for this installation. You can still type owner/name manually."}
                  </FieldDescription>
                  {form.formState.errors.repository === undefined ? null : (
                    <FieldError>
                      {form.formState.errors.repository.message}
                    </FieldError>
                  )}
                </Field>

                <Field
                  data-invalid={
                    form.formState.errors.installationId !== undefined
                  }
                >
                  <FieldLabel htmlFor="binding-installation-id">
                    Installation ID
                  </FieldLabel>
                  <Input
                    id="binding-installation-id"
                    inputMode="numeric"
                    aria-invalid={
                      form.formState.errors.installationId !== undefined
                    }
                    {...form.register("installationId", {
                      setValueAs: (value) =>
                        typeof value === "string" && value.trim().length === 0
                          ? undefined
                          : Number(value),
                    })}
                  />
                  {form.formState.errors.installationId === undefined ? null : (
                    <FieldError>
                      {form.formState.errors.installationId.message}
                    </FieldError>
                  )}
                </Field>

                <Field
                  data-invalid={
                    form.formState.errors.workflowModulePath !== undefined
                  }
                >
                  <FieldLabel htmlFor="binding-workflow-module-path">
                    Workflow Module Path
                  </FieldLabel>
                  <Input
                    id="binding-workflow-module-path"
                    list="binding-workflow-file-options"
                    placeholder="workflows/build.ts"
                    aria-invalid={
                      form.formState.errors.workflowModulePath !== undefined
                    }
                    {...form.register("workflowModulePath")}
                  />
                  <datalist id="binding-workflow-file-options">
                    {(workflowFilesQuery.data ?? []).map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {installationId <= 0 || repository.length === 0
                      ? "Select a repository first to load workflow files from GitHub."
                      : workflowFilesQuery.isPending
                        ? "Loading workflow files from the repository..."
                        : workflowFilesQuery.error !== null
                          ? workflowFilesQuery.error.message
                          : workflowFilesQuery.data !== undefined &&
                              workflowFilesQuery.data.length > 0
                            ? "Select a discovered workflow file from the repository or type one manually."
                            : "No workflow files were discovered for the selected repository and branch."}
                  </FieldDescription>
                  {form.formState.errors.workflowModulePath ===
                  undefined ? null : (
                    <FieldError>
                      {form.formState.errors.workflowModulePath.message}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="binding-branch">Branch</FieldLabel>
                  <Input
                    id="binding-branch"
                    list="binding-branch-options"
                    placeholder={selectedRepository?.defaultBranch ?? "main"}
                    {...form.register("branch")}
                  />
                  <datalist id="binding-branch-options">
                    {(branchesQuery.data ?? []).map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                  <FieldDescription>
                    {installationId <= 0 || repository.length === 0
                      ? "Select a repository first to load available branches."
                      : branchesQuery.isPending
                        ? "Loading branches for this repository..."
                        : branchesQuery.error !== null
                          ? branchesQuery.error.message
                          : branchesQuery.data !== undefined &&
                              branchesQuery.data.length > 0
                            ? "Leave blank to use the repository default branch, or choose a discovered branch."
                            : "No branches were discovered. Leave blank to use the repository default branch."}
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="binding-workspace-subdir">
                    Workspace Subdir
                  </FieldLabel>
                  <Input
                    id="binding-workspace-subdir"
                    placeholder="packages/app"
                    {...form.register("workspaceSubdir")}
                  />
                  <FieldDescription>
                    Optional subdirectory inside the repository checkout.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              {createBindingMutation.error === null ? null : (
                <FieldError className="mt-4">
                  {createBindingMutation.error.message}
                </FieldError>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    form.reset();
                    setDialogOpen(false);
                  }}
                  disabled={createBindingMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={createBindingMutation.isPending}
                >
                  {createBindingMutation.isPending
                    ? "Saving..."
                    : "Save Binding"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {bindingsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading bindings...</p>
      ) : null}
      {bindingsQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load bindings</AlertTitle>
          <AlertDescription>{bindingsQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {!bindingsQuery.isPending &&
      bindingsQuery.error === null &&
      bindings.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            No bindings for this project.
          </CardContent>
        </Card>
      ) : null}

      {!bindingsQuery.isPending &&
      bindingsQuery.error === null &&
      bindings.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow Module Path</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Workspace Subdir</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bindings.map((binding) => (
                  <TableRow key={binding.bindingId}>
                    <TableCell className="font-mono text-xs">
                      {binding.workflowModulePath}
                    </TableCell>
                    <TableCell>{binding.branch ?? "*"}</TableCell>
                    <TableCell>{binding.workspaceSubdir ?? "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={binding.enabled ? "secondary" : "outline"}
                        className={
                          binding.enabled
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : undefined
                        }
                      >
                        {binding.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(binding.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteConfirmBindingId(binding.bindingId)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={deleteConfirmBindingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmBindingId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Binding</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this binding? This action cannot be undone.
          </p>
          {deleteBindingMutation.error === null ? null : (
            <FieldError>{deleteBindingMutation.error.message}</FieldError>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmBindingId(null)}
              disabled={deleteBindingMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteConfirmBindingId !== null) {
                  deleteBindingMutation.mutate(deleteConfirmBindingId);
                }
              }}
              disabled={deleteBindingMutation.isPending}
            >
              {deleteBindingMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
