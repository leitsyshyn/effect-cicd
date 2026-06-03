import { formatDateTime } from "../lib/format.ts"
import type { TimelineEventDto } from "../types.ts"
import { ScrollArea } from "./ui/scroll-area.tsx"

export function TimelineEventList(props: { readonly events: ReadonlyArray<TimelineEventDto>; readonly heightClassName?: string }) {
  return (
    <ScrollArea className={props.heightClassName ?? "h-[70vh] min-h-[420px] rounded-lg border border-border/70 bg-card/70"}>
      <div className="grid">
        {props.events.map((event) => (
          <div
            key={event.eventId}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/70 px-4 py-3.5 last:border-b-0"
          >
            <span className={`mt-1 inline-flex size-2.5 rounded-full ${eventDotClass(event)}`} />
            <div className="grid min-w-0 gap-1.5">
              <p className="text-sm text-foreground">{event.message}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{event.type}</span>
                {event.unitId === undefined ? null : <span className="font-mono text-[11px]">{event.unitId}</span>}
              </div>
            </div>
            <div className="grid justify-items-end gap-1 text-right text-xs text-muted-foreground">
              <span>{formatDateTime(event.occurredAt)}</span>
              <span className="font-mono">#{event.sequence}</span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
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
