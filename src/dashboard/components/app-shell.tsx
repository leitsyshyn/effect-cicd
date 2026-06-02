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
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <header className="dashboard-panel relative overflow-hidden px-5 py-4 sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(162,204,255,0.06),transparent)]" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--dashboard-highlight)]">
                Self-hosted control surface
              </div>
              <div className="dashboard-title text-[30px] leading-none sm:text-[38px]">effect-cicd</div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>Persistent engine inspection and control</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-zinc-300">
                  <Activity className="size-3" />
                  {props.serviceVersion === undefined ? "engine link pending" : `engine ${props.serviceVersion}`}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={props.onRefresh}>
              <RefreshCcw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </header>

        <main className="grid min-h-0 gap-6">{props.children}</main>
      </div>
    </div>
  )
}
