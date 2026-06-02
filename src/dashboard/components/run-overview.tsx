import { AlertTriangle, Boxes, GitBranch, Package, Route } from "lucide-react"
import type { ReactNode } from "react"

import { formatDateTime, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import type { OutputValueDto, ReportDto, ResolvedValueDto, RunDetailDto } from "../types.ts"
import { StatusBadge } from "./status-badge.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx"

export function RunOverview(props: { readonly detail: RunDetailDto }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <Card className="dashboard-panel">
        <CardHeader className="gap-2 border-b border-border/70 pb-4">
          <CardTitle className="flex items-center gap-2 text-[17px]">
            <Route className="size-4 text-[var(--dashboard-highlight)]" />
            Run context
          </CardTitle>
          <CardDescription>Source and trigger context for this persisted execution.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ContextCell label="Project" value={props.detail.source.projectId} mono />
            <ContextCell label="Plan" value={props.detail.source.planId} mono />
            <ContextCell label="Workspace" value={props.detail.source.workspacePath ?? "Not recorded"} />
            <ContextCell label="Updated" value={formatDateTime(props.detail.run.updatedAt)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <InfoBlock title="Triggers" icon={<GitBranch className="size-4 text-[var(--dashboard-highlight)]" />}>
              {props.detail.source.triggers.length === 0 ? (
                <MutedLine>No trigger declarations recorded.</MutedLine>
              ) : (
                props.detail.source.triggers.map((trigger) => <TagLine key={`${trigger.type}-${trigger.summary}`} title={trigger.type} value={trigger.summary} />)
              )}
            </InfoBlock>

            <InfoBlock title="Workflow metadata" icon={<Boxes className="size-4 text-[var(--dashboard-highlight)]" />}>
              {props.detail.source.metadata.length === 0 ? (
                <MutedLine>No workflow metadata recorded.</MutedLine>
              ) : (
                props.detail.source.metadata.map((entry) => <TagLine key={entry.key} title={entry.key} value={entry.value} mono />)
              )}
            </InfoBlock>
          </div>
        </CardContent>
      </Card>

      <Card className="dashboard-panel">
        <CardHeader className="gap-2 border-b border-border/70 pb-4">
          <CardTitle className="flex items-center gap-2 text-[17px]">
            <AlertTriangle className="size-4 text-[var(--dashboard-highlight)]" />
            Planning diagnostics
          </CardTitle>
          <CardDescription>Planner-supplied diagnostics and retained source metadata.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5">
          {props.detail.source.diagnostics.length === 0 ? (
            <MutedLine>No planning diagnostics.</MutedLine>
          ) : (
            props.detail.source.diagnostics.map((diagnostic, index) => (
              <div key={`${diagnostic.message}-${index}`} className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{diagnostic.message}</div>
                  <StatusBadge status={diagnostic.severity} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {[diagnostic.unitId, formatSourceLocation(diagnostic.source)].filter(Boolean).join(" / ")}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ValuePanel title="Resolved inputs" icon={<Boxes className="size-4 text-[var(--dashboard-highlight)]" />} items={props.detail.inputs ?? []} empty="No workflow inputs were resolved for this run." />
      <ValuePanel title="Workflow outputs" icon={<Package className="size-4 text-[var(--dashboard-highlight)]" />} items={props.detail.outputs ?? []} empty="No workflow outputs were recorded for this run." />

      <ReportsPanel reports={props.detail.reports ?? []} />
      <Card className="dashboard-panel">
        <CardHeader className="gap-2 border-b border-border/70 pb-4">
          <CardTitle className="text-[17px]">Current payload inventory</CardTitle>
          <CardDescription>Persisted payload references owned by the Engine.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <ContextCell label="Logs" value={`${props.detail.logs.length}`} />
          <ContextCell label="Artifacts" value={`${props.detail.artifacts.length}`} />
          <ContextCell label="Reports" value={`${props.detail.reports?.length ?? 0}`} />
          <ContextCell label="Units" value={`${props.detail.units.length}`} />
        </CardContent>
      </Card>
    </div>
  )
}

function ValuePanel(props: {
  readonly title: string
  readonly icon: ReactNode
  readonly items: ReadonlyArray<ResolvedValueDto | OutputValueDto>
  readonly empty: string
}) {
  return (
    <Card className="dashboard-panel">
      <CardHeader className="gap-2 border-b border-border/70 pb-4">
        <CardTitle className="flex items-center gap-2 text-[17px]">{props.icon}{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-5">
        {props.items.length === 0 ? (
          <MutedLine>{props.empty}</MutedLine>
        ) : (
          props.items.map((item) => (
            <div key={`${item.name}-${JSON.stringify(item.value)}`} className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium text-foreground">{item.name}</div>
                {"format" in item && item.format !== undefined ? <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.format}</span> : null}
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-zinc-300">{formatValue(item.value)}</pre>
              {item.source === undefined ? null : <div className="mt-2 text-xs text-muted-foreground">source: {item.source}</div>}
              {"unitId" in item && item.unitId !== undefined ? <div className="mt-1 text-xs text-muted-foreground">unit: {item.unitId}</div> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function ReportsPanel(props: { readonly reports: ReadonlyArray<ReportDto> }) {
  return (
    <Card className="dashboard-panel">
      <CardHeader className="gap-2 border-b border-border/70 pb-4">
        <CardTitle className="text-[17px]">Workflow reports</CardTitle>
        <CardDescription>Outcome-shaped report payloads attached to the run.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-5">
        {props.reports.length === 0 ? (
          <MutedLine>No workflow reports recorded for this run.</MutedLine>
        ) : (
          props.reports.map((report) => (
            <div key={report.artifactRef} className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">{report.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">{truncateMiddle(report.artifactRef, 52)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{report.format}</span>
                  <StatusBadge status={report.status} />
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function InfoBlock(props: { readonly title: string; readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">{props.icon}{props.title}</div>
      <div className="grid gap-2">{props.children}</div>
    </div>
  )
}

function ContextCell(props: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</div>
      <div className={["mt-2 text-sm text-foreground", props.mono === true ? "font-mono" : ""].join(" ")}>{props.value}</div>
    </div>
  )
}

function TagLine(props: { readonly title: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border/70 pb-2 last:border-b-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.title}</div>
      <div className={["text-sm text-foreground", props.mono === true ? "font-mono" : ""].join(" ")}>{props.value}</div>
    </div>
  )
}

function MutedLine({ children }: { readonly children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>
}
