import { queryOptions } from "@tanstack/react-query"

import { createDashboardApi } from "../api.ts"

export const dashboardApi = createDashboardApi()

export const dashboardQueryKeys = {
  serviceVersion: ["service-version"] as const,
  projects: ["projects"] as const,
  githubRepositories: (installationId: number) => ["github-repositories", installationId] as const,
  githubBranches: (installationId: number, repository: string) => ["github-branches", installationId, repository] as const,
  githubWorkflowFiles: (installationId: number, repository: string, ref: string) => ["github-workflow-files", installationId, repository, ref] as const,
  workflowFiles: ["workflow-files"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  projectRunConfig: (projectId: string) => ["project-run-config", projectId] as const,
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
  githubRepositories: (installationId: number) =>
    queryOptions({
      queryKey: dashboardQueryKeys.githubRepositories(installationId),
      queryFn: () => dashboardApi.listGitHubInstallationRepositories(installationId),
      enabled: installationId > 0,
    }),
  githubBranches: (installationId: number, repository: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.githubBranches(installationId, repository),
      queryFn: () => dashboardApi.listGitHubRepositoryBranches(installationId, repository),
      enabled: installationId > 0 && repository.trim().length > 0,
    }),
  githubWorkflowFiles: (installationId: number, repository: string, ref?: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.githubWorkflowFiles(installationId, repository, ref ?? ""),
      queryFn: () => dashboardApi.listGitHubRepositoryWorkflowFiles(installationId, repository, ref),
      enabled: installationId > 0 && repository.trim().length > 0,
    }),
  workflowFiles: () =>
    queryOptions({
      queryKey: dashboardQueryKeys.workflowFiles,
      queryFn: () => dashboardApi.listWorkflowFiles(),
    }),
  project: (projectId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.project(projectId),
      queryFn: async () => {
        const projects = await dashboardApi.listProjects()
        return projects.find((project) => project.projectId === projectId) ?? null
      },
    }),
  projectRunConfig: (projectId: string, enabled = true) =>
    queryOptions({
      queryKey: dashboardQueryKeys.projectRunConfig(projectId),
      queryFn: () => dashboardApi.getProjectRunConfig(projectId),
      enabled,
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
    }),
  runDetail: (runId: string) =>
    queryOptions({
      queryKey: dashboardQueryKeys.runDetail(runId),
      queryFn: () => dashboardApi.inspectRun(runId),
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
