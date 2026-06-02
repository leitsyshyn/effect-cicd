import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { EmptyState } from "../components/empty-state.tsx"
import { InlineError } from "../components/inline-error.tsx"
import { MetricCard } from "../components/metric-card.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { formatDateTime, formatDuration, truncateMiddle } from "../lib/format.ts"
import { hrefForRun, type DashboardNavigate } from "../lib/routing.ts"
import type { RunSummaryDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

const statusFilters = ["all", "running", "failed", "succeeded"] as const

export function RunsPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate }) {
  const [runs, setRuns] = useState<ReadonlyArray<RunSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState<(typeof statusFilters)[number]>("all")

  const load = async () => {
    setLoading(true)
    setError(undefined)

    try {
      setRuns(await props.api.listRuns())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const source = new EventSource("/api/runs/stream")
    const reload = () => {
      void load()
    }

    source.addEventListener("run-update", reload)
    source.onerror = () => undefined

    return () => source.close()
  }, [])

  const filteredRuns = runs.filter((run) => (filter === "all" ? true : filter === "running" ? run.controls.canCancel : run.status === filter))
  const activeRuns = runs.filter((run) => run.controls.canCancel).length
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "timed_out" || run.status === "interrupted").length
  const latestRun = runs[0]

  return (
    <section className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="dashboard-panel lg:col-span-1">
          <CardHeader className="gap-2">
            <CardTitle className="text-[26px]">Runs</CardTitle>
            <CardDescription>Durable workflow executions exposed through the Engine inspection contract.</CardDescription>
          </CardHeader>
        </Card>
        <MetricCard label="Total runs" value={`${runs.length}`} detail="Persisted workflow history" />
        <MetricCard label="Active" value={`${activeRuns}`} detail="Currently queued, running, or canceling" />
        <MetricCard label="Needs attention" value={`${failedRuns}`} detail={latestRun === undefined ? "No runs yet" : `Latest ${latestRun.workflowName ?? latestRun.workflowId}`} />
      </div>

      <Card className="dashboard-panel overflow-hidden">
        <CardHeader className="gap-4 border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle className="text-[17px]">Run index</CardTitle>
              <CardDescription>Filterable operational index with durable progress and failure context.</CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {statusFilters.map((status) => (
                <Button key={status} variant={filter === status ? "default" : "outline"} size="sm" onClick={() => setFilter(status)}>
                  {status}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error === undefined ? null : <div className="p-4"><InlineError message={error} /></div>}
          {loading ? (
            <div className="p-4"><EmptyState title="Loading runs" description="Fetching persisted runs from the Engine service." compact /></div>
          ) : filteredRuns.length === 0 ? (
            <div className="p-4"><EmptyState title="No runs" description="Start a workflow and it will appear here for durable inspection." compact /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead>Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.map((run) => (
                  <TableRow key={run.runId} className="cursor-pointer" onClick={() => props.navigate(hrefForRun(run.runId))}>
                    <TableCell>
                      <div className="grid gap-1">
                        <div className="font-medium text-foreground">{run.workflowName ?? run.workflowId}</div>
                        <div className="text-xs text-muted-foreground">{run.workflowId}</div>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={run.status} /></TableCell>
                    <TableCell>{run.progress.completedUnits}/{run.progress.totalUnits}</TableCell>
                    <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                    <TableCell>{formatDuration(run.durationMs)}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">{run.failureMessage ?? "-"}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{truncateMiddle(run.runId, 52)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
