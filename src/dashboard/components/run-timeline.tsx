import { formatDateTime } from "../lib/format.ts"
import type { TimelineEventDto } from "../types.ts"
import { Card, CardContent } from "./ui/card.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"

export function RunTimeline(props: { readonly events: ReadonlyArray<TimelineEventDto> }) {
  if (props.events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events for this run.</p>
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="h-[70vh] min-h-[420px]">
          <div className="grid">
            {props.events.map((event) => (
              <div key={event.eventId} className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-medium text-foreground">{event.message}</p>
                  <span className="text-xs text-muted-foreground">#{event.sequence}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{event.type}</span>
                  <span>{formatDateTime(event.occurredAt)}</span>
                  {event.unitId === undefined ? null : <span>{event.unitId}</span>}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
