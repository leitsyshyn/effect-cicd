import type { ReactNode } from "react"

export function MetricCard(props: { readonly label: string; readonly value: string; readonly detail?: string; readonly accent?: ReactNode }) {
  return (
    <div className="dashboard-panel grid gap-2 px-4 py-4">
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>{props.label}</span>
        {props.accent}
      </div>
      <div className="dashboard-title text-[24px] leading-none">{props.value}</div>
      {props.detail === undefined ? null : <div className="text-sm text-muted-foreground">{props.detail}</div>}
    </div>
  )
}
