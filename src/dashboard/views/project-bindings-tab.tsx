import { useEffect, useState } from "react"

import type { GitHubBindingCreateRequestDto, GitHubBindingSummaryDto, createDashboardApi } from "../api.ts"
import { Badge } from "../components/ui/badge.tsx"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { formatDateTime } from "../lib/format.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function ProjectBindingsTab(props: { readonly api: DashboardApi; readonly projectId: string }) {
  const [bindings, setBindings] = useState<ReadonlyArray<GitHubBindingSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showForm, setShowForm] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [repository, setRepository] = useState("")
  const [installationId, setInstallationId] = useState("")
  const [workflowModulePath, setWorkflowModulePath] = useState("")
  const [branch, setBranch] = useState("")
  const [workspaceSubdir, setWorkspaceSubdir] = useState("")

  const load = async () => {
    setLoading(true)
    setError(undefined)

    try {
      const nextBindings = await props.api.listBindings()
      setBindings(nextBindings.filter((binding) => binding.projectId === props.projectId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.projectId])

  const submit = async () => {
    const parsedInstallationId = Number(installationId)

    if (!/^[^/\s]+\/[^/\s]+$/.test(repository.trim())) {
      setFormError("Repository must use owner/name.")
      return
    }

    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      setFormError("Installation ID must be a positive number.")
      return
    }

    if (workflowModulePath.trim().length === 0) {
      setFormError("Workflow module path is required.")
      return
    }

    const payload: GitHubBindingCreateRequestDto = {
      repository: repository.trim(),
      installationId: parsedInstallationId,
      workflowModulePath: workflowModulePath.trim(),
      enabled: true,
      ...(branch.trim().length === 0 ? {} : { branch: branch.trim() }),
      ...(workspaceSubdir.trim().length === 0 ? {} : { workspaceSubdir: workspaceSubdir.trim() }),
    }

    setPending(true)
    setFormError(undefined)

    try {
      await props.api.createBinding(payload)
      setRepository("")
      setInstallationId("")
      setWorkflowModulePath("")
      setBranch("")
      setWorkspaceSubdir("")
      setShowForm(false)
      await load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex justify-end">
        <Button variant={showForm ? "secondary" : "default"} size="sm" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Close" : "Add Binding"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Binding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm">
              <span>Repository</span>
              <input
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="owner/name"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Installation ID</span>
              <input
                value={installationId}
                onChange={(event) => setInstallationId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                inputMode="numeric"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Workflow Module Path</span>
              <input
                value={workflowModulePath}
                onChange={(event) => setWorkflowModulePath(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="workflows/build.ts"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="main"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Workspace Subdir</span>
              <input
                value={workspaceSubdir}
                onChange={(event) => setWorkspaceSubdir(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="packages/app"
              />
            </label>
            {formError === undefined ? null : <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit()} disabled={pending}>
                {pending ? "Saving..." : "Save Binding"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowForm(false)
                  setFormError(undefined)
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading bindings...</p> : null}
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}

      {!loading && error === undefined && bindings.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">No bindings for this project.</CardContent>
        </Card>
      ) : null}

      {!loading && error === undefined && bindings.length > 0 ? (
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
