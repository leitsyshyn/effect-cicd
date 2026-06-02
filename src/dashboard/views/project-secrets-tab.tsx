import { useEffect, useState } from "react"

import type { SecretSummaryDto, createDashboardApi } from "../api.ts"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { formatDateTime } from "../lib/format.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function ProjectSecretsTab(props: { readonly api: DashboardApi; readonly projectId: string }) {
  const [secrets, setSecrets] = useState<ReadonlyArray<SecretSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showForm, setShowForm] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [key, setKey] = useState("")
  const [value, setValue] = useState("")

  const load = async () => {
    setLoading(true)
    setError(undefined)

    try {
      setSecrets(await props.api.listSecrets(props.projectId))
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
    if (key.trim().length === 0) {
      setFormError("Key is required.")
      return
    }

    if (value.trim().length === 0) {
      setFormError("Value is required.")
      return
    }

    setPending(true)
    setFormError(undefined)

    try {
      await props.api.setSecret({ projectId: props.projectId, key: key.trim(), value })
      setKey("")
      setValue("")
      setShowForm(false)
      await load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  const removeSecret = async (secretKey: string) => {
    if (!window.confirm(`Delete secret ${secretKey}?`)) {
      return
    }

    try {
      await props.api.deleteSecret(props.projectId, secretKey)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex justify-end">
        <Button variant={showForm ? "secondary" : "default"} size="sm" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Close" : "Add Secret"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Secret</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm">
              <span>Key (use uppercase names)</span>
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm"
                placeholder="API_TOKEN"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Value</span>
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            {formError === undefined ? null : <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit()} disabled={pending}>
                {pending ? "Saving..." : "Save Secret"}
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

      {loading ? <p className="text-sm text-muted-foreground">Loading secrets...</p> : null}
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}

      {!loading && error === undefined && secrets.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">No secrets for this project.</CardContent>
        </Card>
      ) : null}

      {!loading && error === undefined && secrets.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow key={secret.key}>
                    <TableCell className="font-mono text-xs">{secret.key}</TableCell>
                    <TableCell>{formatDateTime(secret.createdAt)}</TableCell>
                    <TableCell>{formatDateTime(secret.updatedAt)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeSecret(secret.key)}>
                        Delete
                      </Button>
                    </TableCell>
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
