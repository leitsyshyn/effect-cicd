import type { TimelineEventDto } from "../types.ts"
import { Card, CardContent } from "./ui/card.tsx"
import { TimelineEventList } from "./timeline-event-list.tsx"

export function RunTimeline(props: { readonly events: ReadonlyArray<TimelineEventDto> }) {
  if (props.events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events for this run.</p>
  }

  return (
    <Card>
      <CardContent className="p-4">
        <TimelineEventList events={props.events} />
      </CardContent>
    </Card>
  )
}
