import { Clock3 } from "lucide-react"

import { formatDateTime } from "../lib/format.ts"
import { badgeClassNameForStatus, badgeVariantForStatus } from "../lib/run-status.ts"
import { Badge } from "./ui/badge.tsx"

export function StatusTimestampPill(props: { readonly timestamp?: string; readonly status?: string }) {
  if (props.timestamp === undefined || formatDateTime(props.timestamp) === "-") {
    return null
  }

  if (props.status !== undefined && props.status.trim().length > 0) {
    return (
      <span className="inline-flex items-center">
        <Badge variant="secondary" className={`gap-1.5 rounded-r-none border-r-0 bg-background/60 text-muted-foreground ${borderClassForStatus(props.status)}`}>
          <Clock3 className="size-3.5" />
          {formatDateTime(props.timestamp)}
        </Badge>
        <Badge variant={badgeVariantForStatus(props.status)} className={`rounded-l-none ${badgeClassNameForStatus(props.status) ?? ""}`}>
          {props.status.replaceAll("_", " ")}
        </Badge>
      </span>
    )
  }

  return (
    <Badge variant="secondary" className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground">
      <Clock3 className="size-3.5" />
      {formatDateTime(props.timestamp)}
    </Badge>
  )
}

const borderClassForStatus = (status: string) => {
  if (status === "succeeded") return "border-emerald-500/20"
  if (status === "failed" || status === "interrupted" || status === "timed_out" || status === "canceled") return "border-rose-500/20"
  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") return "border-sky-500/20"
  if (status === "retrying" || status === "skipped") return "border-amber-500/20"
  return "border-border/60"
}
