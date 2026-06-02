import { useQuery } from "@tanstack/react-query"
import { Activity, Clock3, Link2 } from "lucide-react"
import { Link } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { badgeVariantForStatus } from "../lib/run-status.ts"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { formatDateTime } from "../lib/format.ts"
import { hrefForProject } from "../lib/routing.ts"
import type { ProjectSummaryDto } from "../api.ts"

export function ProjectsPage() {
  const projectsQuery = useQuery(dashboardQueries.projects())
  const projects = projectsQuery.data ?? []

  if (projectsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading projects...</p>
  }

  if (projectsQuery.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load projects</AlertTitle>
        <AlertDescription>{projectsQuery.error.message}</AlertDescription>
      </Alert>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No projects</CardTitle>
            <CardDescription>No projects exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link
            key={project.projectId}
            to={hrefForProject(project.projectId)}
            className="block w-full text-left"
          >
            <Card className="h-full border-border/60 bg-card/80 transition-all hover:border-border hover:bg-accent/20">
              <CardHeader className="gap-3">
                <CardTitle className="min-w-0 truncate text-xl leading-tight">{projectLabel(project)}</CardTitle>
                <CardDescription className="truncate font-mono text-xs text-muted-foreground/80">
                  {project.projectId}
                </CardDescription>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground">
                    <Activity className="size-3.5" />
                    {formatCount(project.runCount, "run")}
                  </Badge>
                  <TimestampStatusPill project={project} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{project.provider}</Badge>
                  <Badge variant="secondary" className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground">
                    <Link2 className="size-3.5" />
                    {formatCount(project.bindingCount, "binding")}
                  </Badge>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}

function TimestampStatusPill({ project }: { readonly project: ProjectSummaryDto }) {
  const status = project.latestRunStatus
  const hasTimestamp = project.runCount > 0 && formatDateTime(project.latestRunAt) !== "-"

  if (!hasTimestamp) return null

  if (typeof status === "string" && status.trim().length > 0) {
    return (
      <span className="inline-flex items-center">
        <Badge variant="secondary" className={`gap-1.5 rounded-r-none border-r-0 bg-background/60 text-muted-foreground ${borderClassForStatus(status)}`}>
          <Clock3 className="size-3.5" />
          {formatDateTime(project.latestRunAt)}
        </Badge>
        <Badge variant={badgeVariantForStatus(status)} className="rounded-l-none">
          {status.replaceAll("_", " ")}
        </Badge>
      </span>
    )
  }

  return (
    <Badge variant="secondary" className="gap-1.5 border border-border/60 bg-background/60 text-muted-foreground">
      <Clock3 className="size-3.5" />
      {formatDateTime(project.latestRunAt)}
    </Badge>
  )
}

const borderClassForStatus = (status: string) => {
  if (status === "succeeded") return "border-emerald-500/20"
  if (status === "failed" || status === "interrupted" || status === "timed_out" || status === "canceled") return "border-rose-500/20"
  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") return "border-sky-500/20"
  if (status === "skipped") return "border-amber-500/20"
  return "border-border/60"
}

const formatCount = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`

export const projectLabel = (project: {
  readonly projectId: string
  readonly repositoryOwner?: string | null
  readonly repositoryName?: string | null
}) => {
  const repositoryOwner = typeof project.repositoryOwner === "string" ? project.repositoryOwner.trim() : ""
  const repositoryName = typeof project.repositoryName === "string" ? project.repositoryName.trim() : ""

  return repositoryOwner.length > 0 && repositoryName.length > 0
    ? `${repositoryOwner}/${repositoryName}`
    : project.projectId
}
