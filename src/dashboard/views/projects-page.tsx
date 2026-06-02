import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { formatDateTime } from "../lib/format.ts"
import { hrefForProject } from "../lib/routing.ts"

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
            <Card className="h-full transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{projectLabel(project)}</CardTitle>
                <CardDescription>
                  <Badge variant="outline">{project.provider}</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>Bindings: {project.bindingCount}</p>
                <p>Runs: {project.runCount}</p>
                <p>Latest Run: {project.latestRunAt === undefined ? "-" : formatDateTime(project.latestRunAt)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}

export const projectLabel = (project: { readonly projectId: string; readonly repositoryOwner?: string; readonly repositoryName?: string }) =>
  project.repositoryOwner !== undefined && project.repositoryName !== undefined
    ? `${project.repositoryOwner}/${project.repositoryName}`
    : project.projectId
