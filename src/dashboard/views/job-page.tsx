import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { Link, useSearchParams, useParams } from "react-router-dom"

import type { ArtifactPayloadDto } from "../api.ts"
import { PayloadBrowser, type PayloadBrowserContent, type PayloadBrowserItem } from "../components/payload-browser.tsx"
import { RunTimeline } from "../components/run-timeline.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { StatusTimestampPill } from "../components/status-timestamp-pill.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb.tsx"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { formatAge, formatBytes, formatDateTime, formatDuration, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import { hrefForJob, hrefForProject, hrefForProjects, hrefForRun, parseAttemptNumber, parseJobPageView, type JobPageView } from "../lib/routing.ts"
import { useStreamQueryRefresh } from "../lib/use-stream-query-refresh.ts"
import type { PayloadMetadataDto } from "../types.ts"

export function JobPage() {
  const params = useParams<{ runId: string; unitId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const runId = params.runId
  const unitId = params.unitId

  const [showAllLogs, setShowAllLogs] = useState(false)
  const [showAllArtifacts, setShowAllArtifacts] = useState(false)
  const [selectedLogRef, setSelectedLogRef] = useState<string>()
  const [selectedArtifactRef, setSelectedArtifactRef] = useState<string>()

  if (runId === undefined || unitId === undefined) {
    return null
  }

  const activeView: JobPageView = parseJobPageView(searchParams.get("view")) ?? "overview"
  const routeAttempt = parseAttemptNumber(searchParams.get("attempt"))
  const detailQuery = useQuery(dashboardQueries.runDetail(runId))

  useStreamQueryRefresh(
    "/api/runs/stream",
    dashboardQueries.runDetail(runId).queryKey,
    "run-update",
    (event) => eventDataHasRunId(event, runId),
  )

  const detail = detailQuery.data
  const unit = detail?.units.find((entry) => entry.unitId === unitId)
  const attempts = unit === undefined ? [] : [...unit.attempts].sort((left, right) => left.attemptNumber - right.attemptNumber)
  const selectedAttempt = attempts.find((attempt) => attempt.attemptNumber === routeAttempt) ?? attempts[attempts.length - 1]
  const logs = detail?.logs.filter((log) => log.unitId === unitId) ?? []
  const artifacts = detail?.artifacts.filter((artifact) => artifact.unitId === unitId) ?? []
  const logScope = showAllLogs || selectedAttempt === undefined ? logs : logs.filter((log) => log.attemptId === selectedAttempt.attemptId)
  const artifactScope = showAllArtifacts || selectedAttempt === undefined ? artifacts : artifacts.filter((artifact) => artifact.attemptId === selectedAttempt.attemptId)
  const attemptNumbers = new Map(attempts.map((attempt) => [attempt.attemptId, attempt.attemptNumber] as const))
  const reportFormats = new Map((unit?.reports ?? []).map((report) => [report.artifactRef, report.format] as const))
  const selectedLog = logScope.find((log) => log.ref === selectedLogRef)
  const selectedArtifact = artifactScope.find((artifact) => artifact.ref === selectedArtifactRef)
  const jobEvents =
    selectedAttempt === undefined || detail === null || detail === undefined || unit === undefined
      ? []
      : detail.events.filter((event) => event.unitId === unit.unitId && event.attemptId === selectedAttempt.attemptId)

  const logPayloadQuery = useQuery({
    ...dashboardQueries.logPayload(selectedLog?.ref ?? ""),
    enabled: selectedLog !== undefined,
  })

  const artifactPayloadQuery = useQuery({
    ...dashboardQueries.artifactPayload(selectedArtifact?.ref ?? ""),
    enabled:
      selectedArtifact !== undefined &&
      selectedArtifact.status !== "missing" &&
      selectedArtifact.status !== "failed",
  })

  useEffect(() => {
    const firstLog = logScope[0]

    if (logScope.length === 0) {
      setSelectedLogRef(undefined)
      return
    }

    if (firstLog !== undefined && (selectedLogRef === undefined || !logScope.some((log) => log.ref === selectedLogRef))) {
      setSelectedLogRef(firstLog.ref)
    }
  }, [logScope, selectedLogRef])

  useEffect(() => {
    const firstArtifact = artifactScope[0]

    if (artifactScope.length === 0) {
      setSelectedArtifactRef(undefined)
      return
    }

    if (firstArtifact !== undefined && (selectedArtifactRef === undefined || !artifactScope.some((artifact) => artifact.ref === selectedArtifactRef))) {
      setSelectedArtifactRef(firstArtifact.ref)
    }
  }, [artifactScope, selectedArtifactRef])

  if (detailQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading job...</p>
  }

  if (detailQuery.error !== null && detailQuery.data === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load job</AlertTitle>
        <AlertDescription>{detailQuery.error.message}</AlertDescription>
      </Alert>
    )
  }

  if (detail === undefined || detail === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Run not found</AlertTitle>
      </Alert>
    )
  }

  if (unit === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Job not found</AlertTitle>
      </Alert>
    )
  }

  const workflowLabel = detail.run.workflowName ?? detail.run.workflowId
  const unitsById = new Map(detail.units.map((entry) => [entry.unitId, entry] as const))
  const dependencyLinks = unit.dependencies.map((dependencyId, index) => ({
    unitId: dependencyId,
    label: unitsById.get(dependencyId)?.name ?? unit.dependencyNames[index] ?? dependencyId,
  }))
  const allAttemptsScopeActive = activeView === "logs" ? showAllLogs : activeView === "artifacts" ? showAllArtifacts : false
  const logItems = logScope.map((log) => toLogBrowserItem(log, showAllLogs && log.attemptId !== undefined ? attemptNumbers.get(log.attemptId) : undefined))
  const artifactItems = artifactScope.map((artifact) =>
    toArtifactBrowserItem(
      artifact,
      reportFormats.get(artifact.ref),
      showAllArtifacts && artifact.attemptId !== undefined ? attemptNumbers.get(artifact.attemptId) : undefined,
    ),
  )
  const artifactContent: PayloadBrowserContent | undefined =
    selectedArtifact === undefined
      ? undefined
      : selectedArtifact.status === "missing" || selectedArtifact.status === "failed"
        ? { kind: "unavailable", note: `Artifact is ${selectedArtifact.status}.` }
        : artifactPayloadQuery.data === undefined
          ? undefined
          : toArtifactViewerContent(artifactPayloadQuery.data)

  const setRouteState = (view: JobPageView, attempt: number | undefined) => {
    const nextParams = new URLSearchParams(searchParams)

    if (view === "overview") {
      nextParams.delete("view")
    } else {
      nextParams.set("view", view)
    }

    if (attempt === undefined) {
      nextParams.delete("attempt")
    } else {
      nextParams.set("attempt", `${attempt}`)
    }

    setSearchParams(nextParams, { replace: true })
  }

  return (
    <section className="grid min-w-0 gap-4 overflow-x-hidden">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={hrefForProjects()}>Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={hrefForProject(detail.run.projectId)}>{detail.run.projectId}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={hrefForRun(detail.run.runId)}>{workflowLabel}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{unit.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{unit.name}</h1>
            <StatusBadge status={unit.status} {...(unit.nextRetryAt === undefined ? {} : { nextRetryAt: unit.nextRetryAt })} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Started {formatDateTime(unit.startedAt)}</span>
            <span>Duration {formatDuration(unit.durationMs)}</span>
            <span className="max-w-full break-all font-mono text-[12px]">{truncateMiddle(unit.unitId, 72)}</span>
          </div>
          {unit.failureMessage === undefined ? null : <p className="text-sm text-destructive">{unit.failureMessage}</p>}
          {unit.skipReason === undefined ? null : <p className="text-sm text-destructive">{unit.skipReason}</p>}
          {unit.cancellationReason === undefined ? null : <p className="text-sm text-destructive">{unit.cancellationReason}</p>}
          {unit.nextRetryAt === undefined ? null : <p className="text-sm text-muted-foreground">Retry scheduled for {formatDateTime(unit.nextRetryAt)}</p>}
        </div>

        <div className="flex w-full max-w-md flex-wrap items-center justify-end gap-2">
          {activeView === "logs" ? (
            <Button variant={showAllLogs ? "default" : "outline"} size="sm" onClick={() => setShowAllLogs((value) => !value)}>
              All attempts
            </Button>
          ) : null}
          {activeView === "artifacts" ? (
            <Button variant={showAllArtifacts ? "default" : "outline"} size="sm" onClick={() => setShowAllArtifacts((value) => !value)}>
              All attempts
            </Button>
          ) : null}

          <div className="min-w-[220px] flex-1">
            <Select
              {...(allAttemptsScopeActive || selectedAttempt === undefined ? {} : { value: String(selectedAttempt.attemptNumber) })}
              onValueChange={(value) => setRouteState(activeView, Number(value))}
              disabled={attempts.length === 0 || allAttemptsScopeActive}
            >
              <SelectTrigger id="job-attempt">
                <SelectValue placeholder={allAttemptsScopeActive ? "All attempts" : "Select attempt"}>
                  {allAttemptsScopeActive ? "All attempts" : selectedAttempt === undefined ? "Select attempt" : `Attempt ${selectedAttempt.attemptNumber}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                {attempts.map((attempt) => (
                  <SelectItem key={attempt.attemptId} value={String(attempt.attemptNumber)}>
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm">Attempt {attempt.attemptNumber}</span>
                      <StatusTimestampPill status={attempt.status} {...((attempt.finishedAt ?? attempt.startedAt) === undefined ? {} : { timestamp: attempt.finishedAt ?? attempt.startedAt })} />
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Tabs value={activeView} onValueChange={(value) => setRouteState(value as JobPageView, selectedAttempt?.attemptNumber)} className="min-w-0">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <span>Logs</span>
            <span className="text-xs text-muted-foreground">{logScope.length}</span>
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="gap-2">
            <span>Artifacts</span>
            <span className="text-xs text-muted-foreground">{artifactScope.length}</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">
            <span>Timeline</span>
            <span className="text-xs text-muted-foreground">{jobEvents.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4">
          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Execution</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              <div className="grid gap-3 sm:grid-cols-2">
                <CompactField label="Image" value={unit.image ?? "-"} monospace />
                <CompactField label="Working directory" value={unit.workingDirectory ?? "-"} monospace />
              </div>
              <CompactField label="Source location" value={formatSourceLocation(unit.source)} />
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Context</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 pt-0">
              <SectionGroup title="Dependencies" emptyMessage="No dependencies.">
                {dependencyLinks.map((dependency) => (
                  <Link key={dependency.unitId} to={hrefForJob(detail.run.runId, dependency.unitId, "overview", selectedAttempt?.attemptNumber)}>
                    <Badge variant="secondary" className="border border-border/70 bg-background/70 hover:bg-accent/50">
                      {dependency.label}
                    </Badge>
                  </Link>
                ))}
              </SectionGroup>

              <SectionGroup title="Resolved Inputs" emptyMessage="No resolved inputs.">
                {(unit.inputs ?? []).map((input) => (
                  <ValueRow key={`${input.name}-${input.source ?? "none"}`} label={input.name} value={formatValue(input.value)} detail={input.source} />
                ))}
              </SectionGroup>

              <SectionGroup title="Outputs" emptyMessage="No outputs recorded.">
                {(unit.outputs ?? []).map((output) => (
                  <ValueRow
                    key={`${output.name}-${output.path ?? output.unitId ?? "output"}`}
                    label={output.name}
                    value={formatValue(output.value)}
                    detail={output.path ?? output.unitId}
                    format={output.format}
                  />
                ))}
              </SectionGroup>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Command</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-sm leading-6 text-zinc-100 shadow-sm">
                <pre className="whitespace-pre-wrap break-words">{unit.command ?? "-"}</pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="grid gap-4">
          <PayloadBrowser
            items={logItems}
            itemsLabel="logs"
            selectedItem={
              selectedLog === undefined
                ? undefined
                : toLogBrowserItem(selectedLog, showAllLogs && selectedLog.attemptId !== undefined ? attemptNumbers.get(selectedLog.attemptId) : undefined)
            }
            content={selectedLog === undefined ? undefined : { kind: "text", text: logPayloadQuery.data ?? "" }}
            {...(logPayloadQuery.error === null ? {} : { payloadError: logPayloadQuery.error.message })}
            loadingPayload={logPayloadQuery.isPending}
            emptyMessage="No logs for this selection."
            selectMessage="Select a log entry to inspect its payload."
            onSelect={setSelectedLogRef}
          />
        </TabsContent>

        <TabsContent value="artifacts" className="grid gap-4">
          <PayloadBrowser
            items={artifactItems}
            itemsLabel="artifacts"
            selectedItem={
              selectedArtifact === undefined
                ? undefined
                : toArtifactBrowserItem(
                    selectedArtifact,
                    reportFormats.get(selectedArtifact.ref),
                    showAllArtifacts && selectedArtifact.attemptId !== undefined ? attemptNumbers.get(selectedArtifact.attemptId) : undefined,
                  )
            }
            content={artifactContent}
            {...(artifactPayloadQuery.error === null ? {} : { payloadError: artifactPayloadQuery.error.message })}
            loadingPayload={artifactPayloadQuery.isPending}
            emptyMessage="No artifacts for this selection."
            selectMessage="Select an artifact to inspect it."
            onSelect={setSelectedArtifactRef}
          />
        </TabsContent>

        <TabsContent value="timeline" className="min-w-0">
          <RunTimeline events={jobEvents} emptyMessage="No events for this attempt." />
        </TabsContent>
      </Tabs>
    </section>
  )
}

const eventDataHasRunId = (event: MessageEvent<string>, runId: string) => {
  try {
    const payload = JSON.parse(event.data) as { readonly runId?: unknown }
    return payload.runId === runId
  } catch {
    return false
  }
}

function CompactField(props: { readonly label: string; readonly value: string; readonly monospace?: boolean | undefined }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className={props.monospace ? "break-all font-mono text-sm text-foreground" : "text-sm text-foreground"}>{props.value}</div>
    </div>
  )
}

function SectionGroup(props: { readonly title: string; readonly emptyMessage: string; readonly children: ReactNode }) {
  const items = Array.isArray(props.children) ? props.children.filter((child) => child !== null && child !== undefined) : props.children
  const hasContent = Array.isArray(items) ? items.length > 0 : items !== undefined && items !== null

  return (
    <section className="grid gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.title}</div>
      {hasContent ? <div className="grid gap-2">{items}</div> : <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>}
    </section>
  )
}

function ValueRow(props: { readonly label: string; readonly value: string; readonly detail?: string | undefined; readonly format?: string | undefined }) {
  return (
    <div className="grid gap-1 rounded-md border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.label}</span>
        {props.format === undefined ? null : <Badge variant="outline">{props.format}</Badge>}
      </div>
      <div className="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-foreground">{props.value}</div>
      {props.detail === undefined ? null : <div className="text-xs text-muted-foreground">{props.detail}</div>}
    </div>
  )
}

const toLogBrowserItem = (log: PayloadMetadataDto, attemptNumber?: number): PayloadBrowserItem => ({
  ref: log.ref,
  name: log.name,
  status: log.status,
  meta: [formatBytes(log.sizeBytes), formatAge(log.ageMillis)],
  ...(attemptNumber === undefined ? {} : { badges: [{ label: `Attempt ${attemptNumber}`, variant: "outline" as const }] }),
  downloadHref: `/api/logs/${encodeURIComponent(log.ref)}`,
})

const toArtifactBrowserItem = (artifact: PayloadMetadataDto, reportFormat?: string, attemptNumber?: number): PayloadBrowserItem => ({
  ref: artifact.ref,
  name: artifact.name,
  status: artifact.status,
  meta: [artifact.category ?? "artifact", formatBytes(artifact.sizeBytes), formatAge(artifact.ageMillis)],
  badges: [
    ...(attemptNumber === undefined ? [] : [{ label: `Attempt ${attemptNumber}`, variant: "outline" as const }]),
    ...(reportFormat === undefined ? [] : [{ label: reportFormat, variant: "outline" as const }]),
  ],
  downloadHref: `/api/artifacts/${encodeURIComponent(artifact.ref)}`,
})

const toArtifactViewerContent = (payload: ArtifactPayloadDto): PayloadBrowserContent =>
  payload.kind === "text"
    ? { kind: "text", text: payload.text }
    : {
        kind: "binary",
        note: payload.contentType === undefined ? "Binary payload. Download raw to inspect it." : `Binary payload (${payload.contentType}). Download raw to inspect it.`,
      }
