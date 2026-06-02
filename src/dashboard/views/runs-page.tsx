import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { StatusBadge } from "../components/status-badge.tsx"
import { Card, CardContent } from "../components/ui/card.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { formatDateTime, formatDuration } from "../lib/format.ts"
import { hrefForRun, type DashboardNavigate } from "../lib/routing.ts"
import type { RunSummaryDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function RunsTab(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate; readonly projectId: string }) {
  const [runs, setRuns] = useState<ReadonlyArray<RunSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const load = async () => {
    setLoading(true)
    setError(undefined)

    try {
      setRuns(await props.api.listRuns(props.projectId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void props.api.listRuns(props.projectId).then(setRuns).catch(() => undefined)
      }
    }, 10_000)

    return () => window.clearInterval(interval)
  }, [props.projectId])

  return (
    <section className="grid gap-4">
      {loading ? <p className="text-sm text-muted-foreground">Loading runs...</p> : null}
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
      {!loading && error === undefined && runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs for this project.</p> : null}

      {!loading && error === undefined && runs.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.runId} className="cursor-pointer" onClick={() => props.navigate(hrefForRun(run.runId))}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">{run.workflowName ?? run.workflowId}</span>
                        <span className="font-mono text-xs text-muted-foreground">{run.workflowId}</span>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={run.status} /></TableCell>
                    <TableCell>{formatDateTime(run.startedAt ?? run.createdAt)}</TableCell>
                    <TableCell>{formatDuration(run.durationMs)}</TableCell>
                    <TableCell>{run.progress.completedUnits}/{run.progress.totalUnits}</TableCell>
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
