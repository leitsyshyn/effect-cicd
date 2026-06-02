import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { z } from "zod"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
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
} from "../components/ui/alert-dialog.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb.tsx"
import { Button } from "../components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.tsx"
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx"
import { Input } from "../components/ui/input.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { dashboardApi, dashboardQueries, dashboardQueryKeys } from "../lib/dashboard-query.ts"
import { hrefForProject, hrefForProjects, parseProjectPageView, type ProjectPageView } from "../lib/routing.ts"
import { ProjectBindingsTab } from "./project-bindings-tab.tsx"
import { ProjectSecretsTab } from "./project-secrets-tab.tsx"
import { projectLabel } from "./projects-page.tsx"
import { RunsTab } from "./runs-page.tsx"

const editProjectSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
})

type EditProjectFormValues = z.infer<typeof editProjectSchema>

export function ProjectPage() {
  const params = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const projectId = params.projectId

  if (projectId === undefined) {
    return null
  }

  const projectQuery = useQuery(dashboardQueries.project(projectId))
  const activeView: ProjectPageView = parseProjectPageView(searchParams.get("view")) ?? "runs"
  const label = projectQuery.data === null || projectQuery.data === undefined ? projectId : projectLabel(projectQuery.data)
  const form = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: { projectId },
  })

  useEffect(() => {
    form.reset({ projectId })
  }, [form, projectId])

  const updateProjectMutation = useMutation({
    mutationFn: (values: EditProjectFormValues) => dashboardApi.updateProject(projectId, { projectId: values.projectId.trim() }),
    onSuccess: async (_, values) => {
      const nextProjectId = values.projectId.trim()
      setIsEditOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.bindings }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projectBindings(projectId) }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projectSecrets(projectId) }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projectRuns(projectId) }),
      ])
      form.reset({ projectId: nextProjectId })
      navigate(hrefForProject(nextProjectId, activeView === "runs" ? undefined : activeView), { replace: true })
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: () => dashboardApi.deleteProject(projectId),
    onSuccess: async () => {
      setIsDeleteOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.bindings }),
      ])
      navigate(hrefForProjects(), { replace: true })
    },
  })

  const submitEdit = form.handleSubmit(async (values) => {
    await updateProjectMutation.mutateAsync(values)
  })

  const setActiveView = (view: ProjectPageView) => {
    const nextParams = new URLSearchParams(searchParams)
    if (view === "runs") {
      nextParams.delete("view")
    } else {
      nextParams.set("view", view)
    }
    setSearchParams(nextParams, { replace: true })
  }

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
          <AlertDescription>{updateProjectMutation.error.message}</AlertDescription>
        </Alert>
      )}

      {deleteProjectMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to delete project</AlertTitle>
          <AlertDescription>{deleteProjectMutation.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Project</DialogTitle>
                <DialogDescription>Rename the project ID used by runs, bindings, and secrets.</DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => void submitEdit(event)}>
                <FieldGroup>
                  <Field data-invalid={form.formState.errors.projectId !== undefined}>
                    <FieldLabel htmlFor="project-id">Project ID</FieldLabel>
                    <Input
                      id="project-id"
                      className="font-mono"
                      aria-invalid={form.formState.errors.projectId !== undefined}
                      {...form.register("projectId")}
                    />
                    {form.formState.errors.projectId === undefined ? null : <FieldError>{form.formState.errors.projectId.message}</FieldError>}
                  </Field>
                </FieldGroup>
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={updateProjectMutation.isPending}>
                  Cancel
                </Button>
                <Button onClick={() => void submitEdit()} disabled={updateProjectMutation.isPending}>
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
                  This removes the project, its runs, bindings, secrets, and stored artifacts. Active or queued runs must finish first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button type="button" variant="outline" disabled={deleteProjectMutation.isPending}>
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={() => void deleteProjectMutation.mutateAsync()} disabled={deleteProjectMutation.isPending}>
                    {deleteProjectMutation.isPending ? "Deleting..." : "Delete Project"}
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs value={activeView} onValueChange={(value) => setActiveView(value as ProjectPageView)}>
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
  )
}
