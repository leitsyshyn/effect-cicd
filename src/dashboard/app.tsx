import { TooltipProvider } from "./components/ui/tooltip.tsx"
import { AppShell } from "./components/app-shell.tsx"
import { dashboardQueries } from "./lib/dashboard-query.ts"
import { JobPage } from "./views/job-page.tsx"
import { ProjectPage } from "./views/project-page.tsx"
import { ProjectsPage } from "./views/projects-page.tsx"
import { RunPage } from "./views/run-page.tsx"
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DashboardApp />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function DashboardApp() {
  const queryClient = useQueryClient()
  const serviceVersionQuery = useQuery(dashboardQueries.serviceVersion())

  useEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])

  return (
    <TooltipProvider>
      <AppShell
        {...(serviceVersionQuery.data === undefined ? {} : { serviceVersion: serviceVersionQuery.data })}
        onRefresh={() => void queryClient.invalidateQueries()}
      >
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/runs/:runId" element={<RunPage />} />
          <Route path="/runs/:runId/jobs/:unitId" element={<JobPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </TooltipProvider>
  )
}
