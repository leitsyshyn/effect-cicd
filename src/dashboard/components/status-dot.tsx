import { dotClassForStatus } from "../lib/run-status.ts"

export function StatusDot({ status }: { readonly status: string }) {
  return <span className={`inline-flex size-2.5 rounded-full ${dotClassForStatus(status)}`} />
}
