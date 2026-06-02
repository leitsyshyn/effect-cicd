import { Download } from "lucide-react"

import { StatusBadge } from "./status-badge.tsx"
import { type BadgeProps, Badge } from "./ui/badge.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"

export interface PayloadBrowserItem {
  readonly ref: string
  readonly name: string
  readonly status: string
  readonly meta: ReadonlyArray<string>
  readonly badges?: ReadonlyArray<{ readonly label: string; readonly variant?: BadgeProps["variant"] }>
  readonly downloadHref: string
}

export type PayloadBrowserContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly note?: string }
  | { readonly kind: "unavailable"; readonly note: string }

export function PayloadBrowser(props: {
  readonly items: ReadonlyArray<PayloadBrowserItem>
  readonly selectedItem: PayloadBrowserItem | undefined
  readonly content?: PayloadBrowserContent | undefined
  readonly payloadError?: string | undefined
  readonly loadingPayload: boolean
  readonly emptyMessage: string
  readonly selectMessage: string
  readonly onSelect: (ref: string) => void
}) {
  if (props.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ScrollArea className="min-h-0 rounded-md border">
        {props.items.map((item) => (
          <button
            key={item.ref}
            type="button"
            onClick={() => props.onSelect(item.ref)}
            className={[
              "w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0",
              props.selectedItem?.ref === item.ref ? "bg-accent/50" : "hover:bg-accent/30",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 grid gap-1">
                <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                {item.badges === undefined || item.badges.length === 0 ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    {item.badges.map((badge) => (
                      <Badge key={`${item.ref}-${badge.label}`} variant={badge.variant ?? "outline"}>
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <StatusBadge status={item.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {item.meta.map((entry) => (
                <span key={`${item.ref}-${entry}`}>{entry}</span>
              ))}
            </div>
          </button>
        ))}
      </ScrollArea>

      <PayloadViewer
        item={props.selectedItem}
        content={props.content}
        {...(props.payloadError === undefined ? {} : { payloadError: props.payloadError })}
        loadingPayload={props.loadingPayload}
        selectMessage={props.selectMessage}
      />
    </div>
  )
}

function PayloadViewer(props: {
  readonly item: PayloadBrowserItem | undefined
  readonly content?: PayloadBrowserContent | undefined
  readonly payloadError?: string | undefined
  readonly loadingPayload: boolean
  readonly selectMessage: string
}) {
  if (props.item === undefined) {
    return <p className="text-sm text-muted-foreground">{props.selectMessage}</p>
  }

  const lines = props.content?.kind === "text" && props.content.text.length > 0 ? props.content.text.replace(/\n$/, "").split("\n") : []

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 grid gap-1">
          <div className="truncate font-mono text-xs text-foreground">{props.item.name}</div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={props.item.status} />
          <a href={props.item.downloadHref} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <Download className="size-3" />
            Download raw
          </a>
        </div>
      </div>

      <ScrollArea className="h-full">
        {props.loadingPayload ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading payload...</div>
        ) : props.payloadError !== undefined ? (
          <div className="px-4 py-6 text-sm text-destructive">{props.payloadError}</div>
        ) : props.content?.kind === "unavailable" ? (
          <div className="px-4 py-6 text-sm text-destructive">{props.content.note}</div>
        ) : props.content?.kind === "binary" ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">{props.content.note ?? "Binary payload. Download raw to inspect it."}</div>
        ) : lines.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No payload content</div>
        ) : (
          <div className="font-mono text-[12px] leading-6 text-foreground">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-border/50 last:border-b-0">
                <div className="select-none border-r border-border/60 px-3 py-0.5 text-right text-muted-foreground">{index + 1}</div>
                <div className="overflow-x-auto whitespace-pre px-3 py-0.5">{line.length === 0 ? " " : line}</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
