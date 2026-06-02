export type ProjectPageView = "runs" | "bindings" | "secrets"
export type RunPageView = "workflow" | "timeline"
export type JobPageView = "overview" | "logs" | "artifacts" | "timeline"

export interface ProjectsRoute {
  readonly _tag: "ProjectsRoute"
}

export interface ProjectRoute {
  readonly _tag: "ProjectRoute"
  readonly projectId: string
  readonly view?: ProjectPageView
}

export interface RunRoute {
  readonly _tag: "RunRoute"
  readonly runId: string
  readonly view?: RunPageView
}

export interface JobRoute {
  readonly _tag: "JobRoute"
  readonly runId: string
  readonly unitId: string
  readonly view?: JobPageView
  readonly attempt?: number
}

export type DashboardRoute = ProjectsRoute | ProjectRoute | RunRoute | JobRoute

export const hrefForProjects = () => "/"

export const hrefForProject = (projectId: string, view?: ProjectPageView) => {
  const path = `/projects/${encodeURIComponent(projectId)}`
  if (view === undefined || view === "runs") {
    return path
  }

  const params = new URLSearchParams()
  if (view !== undefined) {
    params.set("view", view)
  }
  return `${path}?${params.toString()}`
}

export const hrefForRun = (runId: string, view?: RunPageView) => {
  const path = `/runs/${encodeURIComponent(runId)}`
  if (view === undefined || view === "workflow") {
    return path
  }

  const params = new URLSearchParams({ view })
  return `${path}?${params.toString()}`
}

export const hrefForJob = (runId: string, unitId: string, view?: JobPageView, attempt?: number) => {
  const path = `/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(unitId)}`
  if ((view === undefined || view === "overview") && attempt === undefined) {
    return path
  }

  const params = new URLSearchParams()
  if (view !== undefined) {
    params.set("view", view)
  }
  if (attempt !== undefined) {
    params.set("attempt", `${attempt}`)
  }

  return `${path}?${params.toString()}`
}

export const parseDashboardRoute = (pathname: string, search: string): DashboardRoute => {
  if (pathname === "/") {
    return { _tag: "ProjectsRoute" }
  }

  const params = new URLSearchParams(search)
  const segments = pathname.split("/").filter((segment) => segment.length > 0)

  if (segments[0] === "projects" && segments.length === 2) {
    const view = parseProjectPageView(params.get("view"))
    return {
      _tag: "ProjectRoute",
      projectId: decodeURIComponent(segments[1]!),
      ...(view === undefined ? {} : { view }),
    }
  }

  if (segments[0] === "runs" && segments.length === 2) {
    const view = parseRunPageView(params.get("view"))
    return {
      _tag: "RunRoute",
      runId: decodeURIComponent(segments[1]!),
      ...(view === undefined ? {} : { view }),
    }
  }

  if (segments[0] === "runs" && segments[2] === "jobs" && segments.length === 4) {
    const view = parseJobPageView(params.get("view"))
    const attempt = parseAttemptNumber(params.get("attempt"))

    return {
      _tag: "JobRoute",
      runId: decodeURIComponent(segments[1]!),
      unitId: decodeURIComponent(segments[3]!),
      ...(view === undefined ? {} : { view }),
      ...(attempt === undefined ? {} : { attempt }),
    }
  }

  return { _tag: "ProjectsRoute" }
}

export const parseProjectPageView = (value: string | null): ProjectPageView | undefined =>
  value === "runs" || value === "bindings" || value === "secrets" ? value : undefined

export const parseRunPageView = (value: string | null): RunPageView | undefined =>
  value === "workflow" || value === "timeline" ? value : undefined

export const parseJobPageView = (value: string | null): JobPageView | undefined =>
  value === "overview" || value === "logs" || value === "artifacts" || value === "timeline" ? value : undefined

export const parseAttemptNumber = (value: string | null) => {
  const attempt = Number(value)
  return Number.isInteger(attempt) && attempt > 0 ? attempt : undefined
}
