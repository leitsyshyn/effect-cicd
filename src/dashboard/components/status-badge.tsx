import { Badge } from "./ui/badge.tsx"
import { badgeClassNameForStatus, badgeVariantForStatus } from "../lib/run-status.ts"

export function StatusBadge({ status }: { readonly status: string | null | undefined }) {
  if (typeof status !== "string" || status.trim().length === 0) {
    return null
  }

  return (
    <Badge variant={badgeVariantForStatus(status)} className={badgeClassNameForStatus(status)}>
      {status.replaceAll("_", " ")}
    </Badge>
  )
}
