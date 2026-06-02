import { queryOptions } from "@tanstack/react-query"

import { createDashboardApi } from "../api.ts"

export const dashboardApi = createDashboardApi()

export const dashboardQueryKeys = {
  serviceVersion: ["service-version"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  bindings: ["bindings"] as const,
  projectBindings: (projectId: string) => ["bindings", projectId] as const,
  projectSecrets: (projectId: string) => ["secrets", projectId] as const,
  projectRuns: (projectId: string) => ["runs", projectId] as const,
  runDetail: (runId: string) => ["runs", runId] as const,
  logPayload: (logRef: string) => ["logs", logRef] as const,
  artifactPayload: (artifactRef: string) => ["artifacts", artifactRef] as const,
}

export const dashboardQueries = {
  serviceVersion: () =>
    queryOptions({
      queryKey: dashboardQueryKeys.serviceVersion,
      queryFn: () => dashboardApi.getVersion(),
      retry: false,
    }),
  projects: () =>
    queryOptions({
      queryKey: dashboardQueryKeys.projects,
      queryFn: () => dashboardApi.listProjects(),
    }),
  project: (projectId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.project(projectId),
      queryFn: async () => {
        const projects = await dashboardApi.listProjects()
        return projects.find((project) => project.projectId === projectId) ?? null
      },
    }),
  projectBindings: (projectId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.projectBindings(projectId),
      queryFn: async () => {
        const bindings = await dashboardApi.listBindings()
        return bindings.filter((binding) => binding.projectId === projectId)
      },
    }),
  projectSecrets: (projectId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.projectSecrets(projectId),
      queryFn: () => dashboardApi.listSecrets(projectId),
    }),
  projectRuns: (projectId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.projectRuns(projectId),
      queryFn: () => dashboardApi.listRuns(projectId),
      refetchInterval: visibleRefetchInterval(10_000),
    }),
  runDetail: (runId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.runDetail(runId),
      queryFn: () => dashboardApi.inspectRun(runId),
      refetchInterval: visibleRefetchInterval(5_000),
    }),
  logPayload: (logRef: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.logPayload(logRef),
      queryFn: () => dashboardApi.readLogPayload(logRef),
    }),
  artifactPayload: (artifactRef: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.artifactPayload(artifactRef),
      queryFn: () => dashboardApi.readArtifactPayload(artifactRef),
    }),
}

function visibleRefetchInterval(intervalMs: number) {
  return () => (document.visibilityState === "visible" ? intervalMs : false)
}
