import { AlertTriangle, Boxes, GitBranch, Package, Route } from "lucide-react"
import type { ReactNode } from "react"

import { formatDateTime, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import type { OutputValueDto, ReportDto, ResolvedValueDto, RunDetailDto } from "../types.ts"
import { StatusBadge } from "./status-badge.tsx"

export function RunOverview(props: { readonly detail: RunDetailDto }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <section className="dashboard-section overflow-hidden">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Route className="size-4 text-[var(--dashboard-highlight)]" />Run context</div>
        </header>
        <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
          <CompactList title="Run" items={[["Project", props.detail.source.projectId], ["Plan", props.detail.source.planId], ["Workspace", props.detail.source.workspacePath ?? "Not recorded"], ["Updated", formatDateTime(props.detail.run.updatedAt)]]} />
          <CompactList title="Payloads" items={[["Units", `${props.detail.units.length}`], ["Logs", `${props.detail.logs.length}`], ["Artifacts", `${props.detail.artifacts.length}`], ["Reports", `${props.detail.reports?.length ?? 0}`]]} />
          <CompactTextBlock title="Triggers" icon={<GitBranch className="size-4 text-[var(--dashboard-highlight)]" />}>
            {props.detail.source.triggers.length === 0 ? "No trigger declarations recorded." : props.detail.source.triggers.map((trigger) => `${trigger.type}: ${trigger.summary}`).join("\n")}
          </CompactTextBlock>
          <CompactTextBlock title="Workflow metadata" icon={<Boxes className="size-4 text-[var(--dashboard-highlight)]" />}>
            {props.detail.source.metadata.length === 0 ? "No workflow metadata recorded." : props.detail.source.metadata.map((entry) => `${entry.key}: ${entry.value}`).join("\n")}
          </CompactTextBlock>
        </div>
      </section>

      <section className="dashboard-section overflow-hidden">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="size-4 text-[var(--dashboard-highlight)]" />Planning diagnostics</div>
        </header>
        <div className="grid gap-3 px-4 py-4 sm:px-5">
          {props.detail.source.diagnostics.length === 0 ? (
            <MutedLine>No planning diagnostics.</MutedLine>
          ) : (
            props.detail.source.diagnostics.map((diagnostic, index) => (
              <div key={`${diagnostic.message}-${index}`} className="dashboard-subsection px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-foreground">{diagnostic.message}</div>
                  <StatusBadge status={diagnostic.severity} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{[diagnostic.unitId, formatSourceLocation(diagnostic.source)].filter(Boolean).join(" / ")}</div>
              </div>
            ))
          )}
        </div>
      </section>

      <ValuePanel title="Resolved inputs" icon={<Boxes className="size-4 text-[var(--dashboard-highlight)]" />} items={props.detail.inputs ?? []} empty="No workflow inputs were resolved for this run." />
      <ValuePanel title="Workflow outputs" icon={<Package className="size-4 text-[var(--dashboard-highlight)]" />} items={props.detail.outputs ?? []} empty="No workflow outputs were recorded for this run." />
      <ReportsPanel reports={props.detail.reports ?? []} />
    </div>
  )
}

function ValuePanel(props: { readonly title: string; readonly icon: ReactNode; readonly items: ReadonlyArray<ResolvedValueDto | OutputValueDto>; readonly empty: string }) {
  return (
    <section className="dashboard-section overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">{props.icon}{props.title}</div>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        {props.items.length === 0 ? (
          <MutedLine>{props.empty}</MutedLine>
        ) : (
          props.items.map((item) => (
            <div key={`${item.name}-${JSON.stringify(item.value)}`} className="dashboard-subsection px-3 py-3">
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
      </div>
    </section>
  )
}

function ReportsPanel(props: { readonly reports: ReadonlyArray<ReportDto> }) {
  return (
    <section className="dashboard-section overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <div className="text-sm font-semibold text-foreground">Workflow reports</div>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        {props.reports.length === 0 ? (
          <MutedLine>No workflow reports recorded for this run.</MutedLine>
        ) : (
          props.reports.map((report) => (
            <div key={report.artifactRef} className="dashboard-subsection px-3 py-3">
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
      </div>
    </section>
  )
}

function CompactList(props: { readonly title: string; readonly items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="dashboard-subsection px-4 py-4">
      <div className="mb-3 text-sm font-medium text-foreground">{props.title}</div>
      <dl className="dashboard-key-value grid gap-3 sm:grid-cols-2">
        {props.items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label === "Plan" || label === "Project" ? "font-mono" : ""}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function CompactTextBlock(props: { readonly title: string; readonly icon: ReactNode; readonly children: string }) {
  return (
    <div className="dashboard-subsection px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">{props.icon}{props.title}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-6 text-zinc-300">{props.children}</pre>
    </div>
  )
}

function MutedLine({ children }: { readonly children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>
}
