import { Activity, RefreshCcw } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "./ui/badge.tsx"
import { Button } from "./ui/button.tsx"
import { Separator } from "./ui/separator.tsx"

export function AppShell(props: {
  readonly children: ReactNode
  readonly serviceVersion?: string | undefined
  readonly onRefresh: () => void
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <a href="/" className="text-sm font-semibold tracking-tight hover:text-foreground/90">
                effect-cicd
              </a>
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                <Activity className="size-3" />
                {props.serviceVersion === undefined ? "engine pending" : `engine ${props.serviceVersion}`}
              </Badge>
            </div>

            <Button variant="outline" size="sm" onClick={props.onRefresh}>
              <RefreshCcw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
          <Separator />
        </header>

        <main className="grid min-h-0 gap-4">{props.children}</main>
      </div>
    </div>
  )
}
