import { Badge } from "./ui/badge.tsx"
import { badgeClassNameForStatus, badgeVariantForStatus, displayStatus } from "../lib/run-status.ts"

export function StatusBadge({ status, nextRetryAt }: { readonly status: string | null | undefined; readonly nextRetryAt?: string }) {
  if (typeof status !== "string" || status.trim().length === 0) {
    return null
  }

  const value = displayStatus(status, nextRetryAt)

  return (
    <Badge variant={badgeVariantForStatus(value)} className={badgeClassNameForStatus(value)}>
      {value.replaceAll("_", " ")}
    </Badge>
  )
}
