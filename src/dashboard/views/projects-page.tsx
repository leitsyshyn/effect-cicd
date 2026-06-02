import { useEffect, useState } from "react"

import type { ProjectSummaryDto, createDashboardApi } from "../api.ts"
import { Badge } from "../components/ui/badge.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { formatDateTime } from "../lib/format.ts"
import { hrefForProject, type DashboardNavigate } from "../lib/routing.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function ProjectsPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate }) {
  const [projects, setProjects] = useState<ReadonlyArray<ProjectSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(undefined)

      try {
        const nextProjects = await props.api.listProjects()
        if (!cancelled) {
          setProjects(nextProjects)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [props.api])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading projects...</p>
  }

  if (error !== undefined) {
    return <p className="text-sm text-destructive">{error}</p>
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
          <button
            key={project.projectId}
            type="button"
            className="w-full text-left"
            onClick={() => props.navigate(hrefForProject(project.projectId))}
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
          </button>
        ))}
      </div>
    </section>
  )
}

export const projectLabel = (project: { readonly projectId: string; readonly repositoryOwner?: string; readonly repositoryName?: string }) =>
  project.repositoryOwner !== undefined && project.repositoryName !== undefined
    ? `${project.repositoryOwner}/${project.repositoryName}`
    : project.projectId
