import { useEffect, useState } from "react"

import type { ProjectSummaryDto, createDashboardApi } from "../api.ts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { hrefForProject, hrefForProjects, type DashboardNavigate, type ProjectPageView, type ProjectRoute } from "../lib/routing.ts"
import { ProjectBindingsTab } from "./project-bindings-tab.tsx"
import { ProjectSecretsTab } from "./project-secrets-tab.tsx"
import { projectLabel } from "./projects-page.tsx"
import { RunsTab } from "./runs-page.tsx"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function ProjectPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate; readonly route: ProjectRoute }) {
  const [project, setProject] = useState<ProjectSummaryDto>()

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const projects = await props.api.listProjects()
        if (!cancelled) {
          setProject(projects.find((entry) => entry.projectId === props.route.projectId))
        }
      } catch {
        if (!cancelled) {
          setProject(undefined)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [props.api, props.route.projectId])

  const activeView: ProjectPageView = props.route.view ?? "runs"
  const label = project === undefined ? props.route.projectId : projectLabel(project)

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button type="button" onClick={() => props.navigate(hrefForProjects())} className="hover:text-foreground">
          Projects
        </button>
        <span>/</span>
        <span className="text-foreground">{label}</span>
      </div>

      <Tabs value={activeView} onValueChange={(value) => props.navigate(hrefForProject(props.route.projectId, value as ProjectPageView), { replace: true })}>
        <TabsList className="grid w-full max-w-sm grid-cols-3">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <RunsTab api={props.api} navigate={props.navigate} projectId={props.route.projectId} />
        </TabsContent>
        <TabsContent value="bindings">
          <ProjectBindingsTab api={props.api} projectId={props.route.projectId} />
        </TabsContent>
        <TabsContent value="secrets">
          <ProjectSecretsTab api={props.api} projectId={props.route.projectId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
