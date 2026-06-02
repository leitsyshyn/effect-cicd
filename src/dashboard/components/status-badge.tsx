import { Badge } from "./ui/badge.tsx"
import { badgeVariantForStatus } from "../lib/run-status.ts"

export function StatusBadge({ status }: { readonly status: string }) {
  return <Badge variant={badgeVariantForStatus(status)}>{status.replaceAll("_", " ")}</Badge>
}
