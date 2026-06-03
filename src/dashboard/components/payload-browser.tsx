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
  readonly itemsLabel?: string | undefined
  readonly selectedItem: PayloadBrowserItem | undefined
  readonly content?: PayloadBrowserContent | undefined
  readonly payloadError?: string | undefined
  readonly loadingPayload: boolean
  readonly emptyMessage: string
  readonly selectMessage: string
  readonly onSelect: (ref: string) => void
}) {
  if (props.items.length === 0) {
    return <div className="rounded-lg border border-border/70 bg-card/80 px-4 py-10 text-center text-sm text-muted-foreground">{props.emptyMessage}</div>
  }

  const itemsLabel = props.itemsLabel ?? "items"
  const itemsTitle = itemsLabel.charAt(0).toUpperCase() + itemsLabel.slice(1)

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-card/80">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid gap-0.5">
            <p className="text-sm font-medium text-foreground">{itemsTitle}</p>
            <p className="text-xs text-muted-foreground">Select an entry to inspect its payload.</p>
          </div>
          <Badge variant="secondary" className="min-w-10 justify-center border border-border/70 bg-background/60 text-xs text-muted-foreground">
            {props.items.length}
          </Badge>
        </div>
        <ScrollArea className="min-h-0">
          <div className="grid gap-2 p-2">
            {props.items.map((item) => (
              <button
                key={item.ref}
                type="button"
                onClick={() => props.onSelect(item.ref)}
                className={[
                  "grid min-h-[88px] content-start rounded-md border px-3 py-3 text-left transition-colors",
                  props.selectedItem?.ref === item.ref
                    ? "border-ring bg-accent/45 shadow-sm"
                    : "border-transparent bg-background/40 hover:border-border/70 hover:bg-accent/25",
                ].join(" ")}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0 grid gap-1.5">
                    <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                    {item.badges === undefined || item.badges.length === 0 ? null : (
                      <div className="flex min-h-6 flex-wrap items-center gap-2">
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
                <div className="mt-3 flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {item.meta.map((entry) => (
                    <span key={`${item.ref}-${entry}`}>{entry}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

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
    return <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-card/40 px-6 py-10 text-center text-sm text-muted-foreground">{props.selectMessage}</div>
  }

  const item = props.item
  const lines = props.content?.kind === "text" && props.content.text.length > 0 ? props.content.text.replace(/\n$/, "").split("\n") : []

  return (
    <div className="grid min-h-[360px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-card/80">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 grid gap-1.5">
          <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.badges?.map((badge) => (
              <Badge key={`${item.ref}-viewer-${badge.label}`} variant={badge.variant ?? "outline"}>
                {badge.label}
              </Badge>
            ))}
            {item.meta.map((entry) => (
              <span key={`${item.ref}-viewer-${entry}`}>{entry}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={item.status} />
          <a
            href={item.downloadHref}
            className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
          >
            <Download className="size-3" />
            Download raw
          </a>
        </div>
      </div>

      <ScrollArea className="h-full">
        {props.loadingPayload ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">Loading payload...</div>
        ) : props.payloadError !== undefined ? (
          <div className="px-4 py-8 text-sm text-destructive">{props.payloadError}</div>
        ) : props.content?.kind === "unavailable" ? (
          <div className="px-4 py-8 text-sm text-destructive">{props.content.note}</div>
        ) : props.content?.kind === "binary" ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">{props.content.note ?? "Binary payload. Download raw to inspect it."}</div>
        ) : lines.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">No payload content</div>
        ) : (
          <div className="bg-background/40 font-mono text-[12px] leading-6 text-foreground">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-border/50 last:border-b-0">
                <div className="select-none border-r border-border/60 bg-muted/30 px-3 py-0.5 text-right text-muted-foreground">{index + 1}</div>
                <div className="overflow-x-auto whitespace-pre px-3 py-0.5">{line.length === 0 ? " " : line}</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
