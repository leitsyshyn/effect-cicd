export interface RunsRoute {
  readonly _tag: "RunsRoute"
}

export interface RunRoute {
  readonly _tag: "RunRoute"
  readonly runId: string
  readonly selectedUnitId?: string
}

export type DashboardRoute = RunsRoute | RunRoute

export type DashboardNavigate = (href: string, options?: { readonly replace?: boolean }) => void

export const parseDashboardRoute = (pathname: string, search: string): DashboardRoute => {
  if (pathname === "/") {
    return { _tag: "RunsRoute" }
  }

  const runId = pathname.replace(/^\/runs\//, "")
  const params = new URLSearchParams(search)
  const selectedUnitId = params.get("unit") ?? undefined

  return {
    _tag: "RunRoute",
    runId: decodeURIComponent(runId),
    ...(selectedUnitId === undefined ? {} : { selectedUnitId }),
  }
}

export const hrefForRun = (runId: string, unitId?: string) => {
  const path = `/runs/${encodeURIComponent(runId)}`
  if (unitId === undefined) {
    return path
  }

  const params = new URLSearchParams({ unit: unitId })
  return `${path}?${params.toString()}`
}
