import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Plus } from "lucide-react"
import { z } from "zod"

import type { GitHubBindingCreateRequestDto } from "../api.ts"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent } from "../components/ui/card.tsx"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog.tsx"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx"
import { Input } from "../components/ui/input.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { dashboardApi, dashboardQueries, dashboardQueryKeys } from "../lib/dashboard-query.ts"
import { formatDateTime } from "../lib/format.ts"

const bindingSchema = z.object({
  repository: z.string().trim().regex(/^[^/\s]+\/[^/\s]+$/, "Repository must use owner/name."),
  installationId: z.coerce.number().int().positive("Installation ID must be a positive number."),
  workflowModulePath: z.string().trim().min(1, "Workflow module path is required."),
  branch: z.string().trim().optional(),
  workspaceSubdir: z.string().trim().optional(),
})

type BindingFormValues = z.infer<typeof bindingSchema>
type BindingFormInput = z.input<typeof bindingSchema>

export function ProjectBindingsTab(props: { readonly projectId: string }) {
  const queryClient = useQueryClient()
  const bindingsQuery = useQuery(dashboardQueries.projectBindings(props.projectId))
  const [dialogOpen, setDialogOpen] = useState(false)
  const form = useForm<BindingFormInput, unknown, BindingFormValues>({
    resolver: zodResolver(bindingSchema),
    defaultValues: {
      repository: "",
      installationId: "" as unknown as number,
      workflowModulePath: "",
      branch: "",
      workspaceSubdir: "",
    },
  })

  const createBindingMutation = useMutation({
    mutationFn: async (values: BindingFormValues) => {
      const payload: GitHubBindingCreateRequestDto = {
        repository: values.repository.trim(),
        installationId: values.installationId,
        workflowModulePath: values.workflowModulePath.trim(),
        enabled: true,
        ...(values.branch === undefined || values.branch.length === 0 ? {} : { branch: values.branch }),
        ...(values.workspaceSubdir === undefined || values.workspaceSubdir.length === 0 ? {} : { workspaceSubdir: values.workspaceSubdir }),
      }

      return dashboardApi.createBinding(payload)
    },
    onSuccess: async () => {
      form.reset()
      setDialogOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.bindings }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.project(props.projectId) }),
      ])
    },
  })

  const submit = form.handleSubmit(async (values) => {
    await createBindingMutation.mutateAsync(values)
  })

  const bindings = bindingsQuery.data ?? []

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
                <Field data-invalid={form.formState.errors.repository !== undefined}>
                  <FieldLabel htmlFor="binding-repository">Repository</FieldLabel>
                  <Input id="binding-repository" placeholder="owner/name" aria-invalid={form.formState.errors.repository !== undefined} {...form.register("repository")} />
                  {form.formState.errors.repository === undefined ? null : <FieldError>{form.formState.errors.repository.message}</FieldError>}
                </Field>

                <Field data-invalid={form.formState.errors.installationId !== undefined}>
                  <FieldLabel htmlFor="binding-installation-id">Installation ID</FieldLabel>
                  <Input id="binding-installation-id" inputMode="numeric" aria-invalid={form.formState.errors.installationId !== undefined} {...form.register("installationId")} />
                  {form.formState.errors.installationId === undefined ? null : <FieldError>{form.formState.errors.installationId.message}</FieldError>}
                </Field>

                <Field data-invalid={form.formState.errors.workflowModulePath !== undefined}>
                  <FieldLabel htmlFor="binding-workflow-module-path">Workflow Module Path</FieldLabel>
                  <Input id="binding-workflow-module-path" placeholder="workflows/build.ts" aria-invalid={form.formState.errors.workflowModulePath !== undefined} {...form.register("workflowModulePath")} />
                  {form.formState.errors.workflowModulePath === undefined ? null : <FieldError>{form.formState.errors.workflowModulePath.message}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="binding-branch">Branch</FieldLabel>
                  <Input id="binding-branch" placeholder="main" {...form.register("branch")} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="binding-workspace-subdir">Workspace Subdir</FieldLabel>
                  <Input id="binding-workspace-subdir" placeholder="packages/app" {...form.register("workspaceSubdir")} />
                  <FieldDescription>Optional subdirectory inside the repository checkout.</FieldDescription>
                </Field>
              </FieldGroup>
              {createBindingMutation.error === null ? null : (
                <FieldError className="mt-4">{createBindingMutation.error.message}</FieldError>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { form.reset(); setDialogOpen(false) }} disabled={createBindingMutation.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void submit()} disabled={createBindingMutation.isPending}>
                  {createBindingMutation.isPending ? "Saving..." : "Save Binding"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {bindingsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading bindings...</p> : null}
      {bindingsQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load bindings</AlertTitle>
          <AlertDescription>{bindingsQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {!bindingsQuery.isPending && bindingsQuery.error === null && bindings.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">No bindings for this project.</CardContent>
        </Card>
      ) : null}

      {!bindingsQuery.isPending && bindingsQuery.error === null && bindings.length > 0 ? (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {bindings.map((binding) => (
                  <TableRow key={binding.bindingId}>
                    <TableCell className="font-mono text-xs">{binding.workflowModulePath}</TableCell>
                    <TableCell>{binding.branch ?? "*"}</TableCell>
                    <TableCell>{binding.workspaceSubdir ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={binding.enabled ? "success" : "secondary"}>{binding.enabled ? "enabled" : "disabled"}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(binding.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
