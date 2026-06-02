import { DatabaseZap, RotateCcw, Square } from "lucide-react"

import { formatDateTime, formatDuration, truncateMiddle } from "../lib/format.ts"
import { hrefForProject, hrefForProjects, hrefForRun, type DashboardNavigate } from "../lib/routing.ts"
import type { RunDetailDto } from "../types.ts"
import { StatusBadge } from "./status-badge.tsx"
import { Button } from "./ui/button.tsx"

export function RunHeader(props: {
  readonly detail: RunDetailDto
  readonly navigate?: DashboardNavigate | undefined
  readonly actionPending?: string | undefined
  readonly actionNotice?: string | undefined
  readonly actionError?: string | undefined
  readonly onCancel: () => void
  readonly onRetry: () => void
  readonly onGc: () => void
}) {
  const workflowLabel = props.detail.run.workflowName ?? props.detail.run.workflowId

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button type="button" onClick={() => props.navigate?.(hrefForProjects())} className="hover:text-foreground">
          Projects
        </button>
        <span>/</span>
        <button type="button" onClick={() => props.navigate?.(hrefForProject(props.detail.run.projectId))} className="hover:text-foreground">
          {props.detail.run.projectId}
        </button>
        <span>/</span>
        <span className="text-foreground">{workflowLabel}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{workflowLabel}</h1>
            <StatusBadge status={props.detail.run.status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Started {formatDateTime(props.detail.run.startedAt)}</span>
            <span>Duration {formatDuration(props.detail.run.durationMs)}</span>
            <span className="font-mono text-[12px]">{truncateMiddle(props.detail.run.runId, 72)}</span>
            {props.detail.source.retriedFromRunId === undefined ? null : (
              <button
                type="button"
                onClick={() => props.navigate?.(hrefForRun(props.detail.source.retriedFromRunId!))}
                className="hover:text-foreground"
              >
                retried from {truncateMiddle(props.detail.source.retriedFromRunId, 36)}
              </button>
            )}
          </div>
          {props.detail.run.failureMessage === undefined ? null : <p className="text-sm text-destructive">{props.detail.run.failureMessage}</p>}
          {props.detail.run.cancellationReason === undefined ? null : <p className="text-sm text-destructive">{props.detail.run.cancellationReason}</p>}
          {props.actionError === undefined ? null : <p className="text-sm text-destructive">{props.actionError}</p>}
          {props.actionNotice === undefined ? null : <p className="text-sm text-muted-foreground">{props.actionNotice}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {props.detail.run.controls.canGc ? (
            <Button variant="outline" size="sm" onClick={props.onGc} disabled={props.actionPending !== undefined}>
              <DatabaseZap data-icon="inline-start" />
              {props.actionPending === "gc" ? "Collecting..." : "Collect Payloads"}
            </Button>
          ) : null}
          {props.detail.run.controls.canRetry ? (
            <Button variant="outline" size="sm" onClick={props.onRetry} disabled={props.actionPending !== undefined}>
              <RotateCcw data-icon="inline-start" />
              {props.actionPending === "retry" ? "Retrying..." : "Retry Run"}
            </Button>
          ) : null}
          {props.detail.run.controls.canCancel ? (
            <Button size="sm" onClick={props.onCancel} disabled={props.actionPending !== undefined}>
              <Square data-icon="inline-start" />
              {props.actionPending === "cancel" ? "Canceling..." : "Cancel Run"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
