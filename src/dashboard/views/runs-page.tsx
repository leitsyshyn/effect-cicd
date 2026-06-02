import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { EmptyState } from "../components/empty-state.tsx"
import { InlineError } from "../components/inline-error.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { Button } from "../components/ui/button.tsx"
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

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void props.api.listRuns().then(setRuns).catch(() => undefined)
      }
    }, 10_000)

    return () => window.clearInterval(interval)
  }, [])

  const filteredRuns = runs.filter((run) => (filter === "all" ? true : filter === "running" ? run.controls.canCancel : run.status === filter))
  const activeRuns = runs.filter((run) => run.controls.canCancel).length
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "timed_out" || run.status === "interrupted").length
  const latestRun = runs[0]

  return (
    <section className="grid gap-4">
      <div className="dashboard-section overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div className="grid gap-2">
            <div className="text-[24px] font-semibold tracking-tight text-foreground">Runs</div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{runs.length} total</span>
              <span>{activeRuns} active</span>
              <span>{failedRuns} failed</span>
              {latestRun === undefined ? null : <span>latest {latestRun.workflowName ?? latestRun.workflowId}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {statusFilters.map((status) => (
              <Button key={status} variant={filter === status ? "default" : "outline"} size="sm" onClick={() => setFilter(status)}>
                {status}
              </Button>
            ))}
          </div>
        </div>

        <div className="p-0">
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
                  <TableRow key={run.runId} className="cursor-pointer" onClick={() => props.navigate(hrefForRun(run.runId, undefined, "pipeline"))}>
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
        </div>
      </div>
    </section>
  )
}
