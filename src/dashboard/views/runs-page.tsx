import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { Card, CardContent } from "../components/ui/card.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { formatDateTime, formatDuration } from "../lib/format.ts"
import { hrefForRun } from "../lib/routing.ts"

export function RunsTab(props: { readonly projectId: string }) {
  const runsQuery = useQuery(dashboardQueries.projectRuns(props.projectId))
  const runs = runsQuery.data ?? []

  return (
    <section className="grid gap-4">
      {runsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading runs...</p> : null}
      {runsQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load runs</AlertTitle>
          <AlertDescription>{runsQuery.error.message}</AlertDescription>
        </Alert>
      )}
      {!runsQuery.isPending && runsQuery.error === null && runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs for this project.</p> : null}

      {!runsQuery.isPending && runsQuery.error === null && runs.length > 0 ? (
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
                  <TableRow key={run.runId}>
                    <TableCell>
                      <Link to={hrefForRun(run.runId)} className="flex flex-col gap-1 hover:text-foreground">
                        <span className="font-medium text-foreground">{run.workflowName ?? run.workflowId}</span>
                        <span className="font-mono text-xs text-muted-foreground">{run.workflowId}</span>
                      </Link>
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
