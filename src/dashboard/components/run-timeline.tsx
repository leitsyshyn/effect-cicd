import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx"
import type { TimelineEventDto } from "../types.ts"
import { EmptyState } from "./empty-state.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"
import { formatDateTime, truncateMiddle } from "../lib/format.ts"

export function RunTimeline(props: { readonly events: ReadonlyArray<TimelineEventDto>; readonly selectedUnitId?: string | undefined }) {
  const events = props.selectedUnitId === undefined ? props.events : props.events.filter((event) => event.unitId === props.selectedUnitId)

  return (
    <Card className="dashboard-panel overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="text-[17px]">Execution timeline</CardTitle>
        <CardDescription>
          {props.selectedUnitId === undefined ? "Chronological Engine event history for this run." : `Scoped to ${props.selectedUnitId}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {events.length === 0 ? (
          <EmptyState title="No events" description="No workflow events matched the current selection." compact />
        ) : (
          <ScrollArea className="h-[360px] pr-3">
            <div className="grid gap-3">
              {events.map((event) => (
                <div key={event.eventId} className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{event.message}</div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">#{event.sequence}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{event.type}</span>
                    <span>{formatDateTime(event.occurredAt)}</span>
                    {event.unitId === undefined ? null : <span>{event.unitId}</span>}
                    {event.attemptId === undefined ? null : <span>{truncateMiddle(event.attemptId, 42)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
