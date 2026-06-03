import type { TimelineEventDto } from "../types.ts"
import { Card, CardContent } from "./ui/card.tsx"
import { TimelineEventList } from "./timeline-event-list.tsx"

export function RunTimeline(props: {
  readonly events: ReadonlyArray<TimelineEventDto>
  readonly emptyMessage?: string | undefined
  readonly heightClassName?: string | undefined
}) {
  if (props.events.length === 0) {
    return <p className="text-sm text-muted-foreground">{props.emptyMessage ?? "No events for this run."}</p>
  }

  return (
    <Card className="border-border/70 bg-card/80">
      <CardContent className="p-4">
        <TimelineEventList events={props.events} {...(props.heightClassName === undefined ? {} : { heightClassName: props.heightClassName })} />
      </CardContent>
    </Card>
  )
}
