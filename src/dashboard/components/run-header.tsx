import { ArrowLeft, DatabaseZap, RotateCcw, Square } from "lucide-react"

import { formatDateTime, formatDuration, truncateMiddle } from "../lib/format.ts"
import { hrefForRun, type DashboardNavigate } from "../lib/routing.ts"
import type { RunDetailDto } from "../types.ts"
import { InlineError } from "./inline-error.tsx"
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
    <div className="grid gap-4 border-b border-border/80 pb-4">
      <div className="flex flex-wrap items-center gap-3 text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
        <button type="button" onClick={() => props.navigate?.("/")} className="inline-flex items-center gap-2 transition hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Runs
        </button>
        <span>/</span>
        <span>{workflowLabel}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="dashboard-title text-[34px] leading-none">{workflowLabel}</h1>
            <StatusBadge status={props.detail.run.status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>Started {formatDateTime(props.detail.run.startedAt)}</span>
            <span>Finished {formatDateTime(props.detail.run.finishedAt)}</span>
            <span>Duration {formatDuration(props.detail.run.durationMs)}</span>
            <span className="font-mono text-[11px]">{truncateMiddle(props.detail.run.runId, 72)}</span>
            {props.detail.source.retriedFromRunId === undefined ? null : (
              <button
                type="button"
                onClick={() => props.navigate?.(hrefForRun(props.detail.source.retriedFromRunId!))}
                className="text-[var(--dashboard-highlight)] transition hover:text-[var(--dashboard-highlight-strong)]"
              >
                retried from {truncateMiddle(props.detail.source.retriedFromRunId, 36)}
              </button>
            )}
          </div>
          {props.detail.run.failureMessage === undefined ? null : <InlineError message={props.detail.run.failureMessage} compact />}
          {props.detail.run.cancellationReason === undefined ? null : <InlineError message={props.detail.run.cancellationReason} compact />}
          {props.actionError === undefined ? null : <InlineError message={props.actionError} compact />}
          {props.actionNotice === undefined ? null : <div className="text-sm text-[var(--dashboard-highlight)]">{props.actionNotice}</div>}
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
