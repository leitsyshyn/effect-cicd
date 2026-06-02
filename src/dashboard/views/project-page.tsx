import { useQuery } from "@tanstack/react-query"
import { Link, useSearchParams, useParams } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { hrefForProjects, parseProjectPageView, type ProjectPageView } from "../lib/routing.ts"
import { ProjectBindingsTab } from "./project-bindings-tab.tsx"
import { ProjectSecretsTab } from "./project-secrets-tab.tsx"
import { projectLabel } from "./projects-page.tsx"
import { RunsTab } from "./runs-page.tsx"

export function ProjectPage() {
  const params = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectId = params.projectId

  if (projectId === undefined) {
    return null
  }

  const projectQuery = useQuery(dashboardQueries.project(projectId))
  const activeView: ProjectPageView = parseProjectPageView(searchParams.get("view")) ?? "runs"
  const label = projectQuery.data === null || projectQuery.data === undefined ? projectId : projectLabel(projectQuery.data)

  const setActiveView = (view: ProjectPageView) => {
    const nextParams = new URLSearchParams(searchParams)
    if (view === "runs") {
      nextParams.delete("view")
    } else {
      nextParams.set("view", view)
    }
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <section className="grid gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={hrefForProjects()}>Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {projectQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load project details</AlertTitle>
          <AlertDescription>{projectQuery.error.message}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeView} onValueChange={(value) => setActiveView(value as ProjectPageView)}>
        <TabsList className="grid w-full max-w-sm grid-cols-3">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <RunsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="bindings">
          <ProjectBindingsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="secrets">
          <ProjectSecretsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
