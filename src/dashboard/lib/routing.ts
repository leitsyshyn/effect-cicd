export interface RunsRoute {
  readonly _tag: "RunsRoute"
}

export interface RunRoute {
  readonly _tag: "RunRoute"
  readonly runId: string
  readonly selectedUnitId?: string
  readonly view?: RunPageView
}

export type DashboardRoute = RunsRoute | RunRoute
export type RunPageView = "pipeline" | "jobs" | "summary" | "events"

export type DashboardNavigate = (href: string, options?: { readonly replace?: boolean }) => void

export const parseDashboardRoute = (pathname: string, search: string): DashboardRoute => {
  if (pathname === "/") {
    return { _tag: "RunsRoute" }
  }

  const runId = pathname.replace(/^\/runs\//, "")
  const params = new URLSearchParams(search)
  const selectedUnitId = params.get("unit") ?? undefined
  const rawView = params.get("view")
  const view = rawView === "pipeline" || rawView === "jobs" || rawView === "summary" || rawView === "events" ? rawView : undefined

  return {
    _tag: "RunRoute",
    runId: decodeURIComponent(runId),
    ...(selectedUnitId === undefined ? {} : { selectedUnitId }),
    ...(view === undefined ? {} : { view }),
  }
}

export const hrefForRun = (runId: string, unitId?: string, view?: RunPageView) => {
  const path = `/runs/${encodeURIComponent(runId)}`
  if (unitId === undefined && view === undefined) {
    return path
  }

  const params = new URLSearchParams()
  if (unitId !== undefined) {
    params.set("unit", unitId)
  }
  if (view !== undefined) {
    params.set("view", view)
  }
  return `${path}?${params.toString()}`
}
