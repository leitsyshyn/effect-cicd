import { Download } from "lucide-react"

import { formatAge, formatBytes, truncateMiddle } from "../lib/format.ts"
import type { PayloadMetadataDto } from "../types.ts"
import { EmptyState } from "./empty-state.tsx"
import { StatusBadge } from "./status-badge.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"

export function PayloadBrowser(props: {
  readonly kind: "log" | "artifact"
  readonly items: ReadonlyArray<PayloadMetadataDto>
  readonly selectedItem: PayloadMetadataDto | undefined
  readonly payload: string
  readonly payloadError?: string | undefined
  readonly loadingPayload: boolean
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly onSelect: (ref: string) => void
}) {
  if (props.items.length === 0) {
    return <EmptyState title={props.emptyTitle} description={props.emptyDescription} compact />
  }

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-auto border border-border bg-[var(--dashboard-panel-strong)]">
        {props.items.map((item) => (
          <button
            key={item.ref}
            type="button"
            onClick={() => props.onSelect(item.ref)}
            className={[
              "w-full border-b border-border px-3 py-3 text-left transition duration-150 last:border-b-0",
              props.selectedItem?.ref === item.ref ? "bg-[#2a2436]" : "hover:bg-[#272133]",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 grid gap-1">
                <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{truncateMiddle(item.ref, 48)}</div>
              </div>
              <StatusBadge status={item.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{item.category ?? props.kind}</span>
              <span>{formatBytes(item.sizeBytes)}</span>
              <span>{formatAge(item.ageMillis)}</span>
            </div>
          </button>
        ))}
      </div>

      <PayloadViewer kind={props.kind} item={props.selectedItem} payload={props.payload} {...(props.payloadError === undefined ? {} : { payloadError: props.payloadError })} loadingPayload={props.loadingPayload} />
    </div>
  )
}

function PayloadViewer(props: { readonly kind: "log" | "artifact"; readonly item: PayloadMetadataDto | undefined; readonly payload: string; readonly payloadError?: string | undefined; readonly loadingPayload: boolean }) {
  if (props.item === undefined) {
    return <EmptyState title={`No ${props.kind} selected`} description={`Select a ${props.kind} entry to inspect its payload`} compact />
  }

  const lines = props.payload.length === 0 ? [] : props.payload.replace(/\n$/, "").split("\n")

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-[var(--dashboard-console)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 grid gap-1">
          <div className="truncate font-mono text-[12px] text-zinc-100">{props.item.name}</div>
          <div className="truncate text-[11px] uppercase tracking-[0.18em] text-zinc-500">{props.item.category ?? props.kind}</div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={props.item.status} />
          <a href={props.kind === "log" ? `/api/logs/${encodeURIComponent(props.item.ref)}` : `/api/artifacts/${encodeURIComponent(props.item.ref)}`} className="inline-flex items-center gap-2 text-xs text-zinc-400 transition hover:text-zinc-100">
            <Download className="size-3" />
            Raw
          </a>
        </div>
      </div>

      <ScrollArea className="h-full">
        {props.loadingPayload ? (
          <div className="px-4 py-6 text-sm text-zinc-500">Loading payload...</div>
        ) : props.payloadError !== undefined ? (
          <div className="px-4 py-6 text-sm text-rose-200">{props.payloadError}</div>
        ) : lines.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">No payload content</div>
        ) : (
          <div className="font-mono text-[12px] leading-6 text-zinc-100">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-white/[0.03] last:border-b-0">
                <div className="select-none border-r border-white/[0.04] px-3 py-0.5 text-right text-zinc-500">{index + 1}</div>
                <div className="overflow-x-auto px-3 py-0.5 whitespace-pre">{line.length === 0 ? " " : line}</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
