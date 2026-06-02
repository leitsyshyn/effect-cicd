import { Activity, RefreshCcw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "./ui/button.tsx"

export function AppShell(props: {
  readonly children: ReactNode
  readonly serviceVersion?: string | undefined
  readonly onRefresh: () => void
}) {
  return (
    <div className="dashboard-backdrop min-h-screen text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1660px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="dashboard-topbar px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="text-sm font-semibold tracking-tight text-foreground">effect-cicd</div>
              <div className="hidden text-sm text-muted-foreground md:block">Self-hosted pipeline control and inspection</div>
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                <Activity className="size-3" />
                {props.serviceVersion === undefined ? "engine pending" : `engine ${props.serviceVersion}`}
              </span>
            </div>

            <Button variant="outline" size="sm" onClick={props.onRefresh}>
              <RefreshCcw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </header>

        <main className="grid min-h-0 gap-4">{props.children}</main>
      </div>
    </div>
  )
}
