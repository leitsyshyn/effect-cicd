import { formatDateTime } from "../lib/format.ts"
import type { TimelineEventDto } from "../types.ts"
import { ScrollArea } from "./ui/scroll-area.tsx"

const legend = [
  { label: "Progress", className: "bg-sky-400" },
  { label: "Success", className: "bg-emerald-400" },
  { label: "Warning", className: "bg-amber-400" },
  { label: "Failure", className: "bg-rose-400" },
  { label: "Other", className: "bg-zinc-500" },
] as const

export function TimelineEventList(props: { readonly events: ReadonlyArray<TimelineEventDto>; readonly heightClassName?: string }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {legend.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2">
            <span className={`inline-flex size-2.5 rounded-full ${item.className}`} />
            {item.label}
          </span>
        ))}
      </div>

      <ScrollArea className={props.heightClassName ?? "h-[70vh] min-h-[420px] rounded-md border"}>
        <div className="grid">
          {props.events.map((event) => (
            <div key={event.eventId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <span className={`mt-1 inline-flex size-2.5 rounded-full ${eventDotClass(event)}`} />
              <div className="grid min-w-0 gap-1">
                <p className="text-sm text-foreground">{event.message}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{event.type}</span>
                  {event.unitId === undefined ? null : <span>{event.unitId}</span>}
                </div>
              </div>
              <div className="grid justify-items-end gap-1 text-xs text-muted-foreground">
                <span>{formatDateTime(event.occurredAt)}</span>
                <span>#{event.sequence}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export const eventDotClass = (event: TimelineEventDto) => {
  const type = event.type.toLowerCase()

  if (type.includes("succeeded") || type.includes("completed")) {
    return "bg-emerald-400"
  }

  if (type.includes("retry") || type.includes("skipped")) {
    return "bg-amber-400"
  }

  if (type.includes("failed") || type.includes("timedout") || type.includes("timed_out") || type.includes("canceled") || type.includes("interrupted")) {
    return "bg-rose-400"
  }

  if (type.includes("started") || type.includes("dispatched") || type.includes("ready") || type.includes("created") || type.includes("resumed")) {
    return "bg-sky-400"
  }

  return "bg-zinc-500"
}
