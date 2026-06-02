import { displayStatus, dotClassForStatus } from "../lib/run-status.ts"

export function StatusDot({ status, nextRetryAt }: { readonly status: string; readonly nextRetryAt?: string }) {
  return <span className={`inline-flex size-2.5 rounded-full ${dotClassForStatus(displayStatus(status, nextRetryAt))}`} />
}
