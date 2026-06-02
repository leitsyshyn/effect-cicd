import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useSearchParams, useParams } from "react-router-dom"

import type { ArtifactPayloadDto } from "../api.ts"
import { PayloadBrowser, type PayloadBrowserContent, type PayloadBrowserItem } from "../components/payload-browser.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb.tsx"
import { Button } from "../components/ui/button.tsx"
import { Field, FieldLabel } from "../components/ui/field.tsx"
import { ScrollArea } from "../components/ui/scroll-area.tsx"
import { Select, SelectItem } from "../components/ui/select.tsx"
import { Separator } from "../components/ui/separator.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { dashboardQueries } from "../lib/dashboard-query.ts"
import { formatAge, formatBytes, formatDateTime, formatDuration, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import { hrefForProject, hrefForProjects, hrefForRun, parseAttemptNumber, parseJobPageView, type JobPageView } from "../lib/routing.ts"
import type { PayloadMetadataDto, TimelineEventDto } from "../types.ts"

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

  if (detailQuery.error !== null) {
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{unit.name}</h1>
            <StatusBadge status={unit.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Started {formatDateTime(unit.startedAt)}</span>
            <span>Duration {formatDuration(unit.durationMs)}</span>
            <span className="font-mono text-[12px]">{truncateMiddle(unit.unitId, 72)}</span>
          </div>
          {unit.failureMessage === undefined ? null : <p className="text-sm text-destructive">{unit.failureMessage}</p>}
          {unit.skipReason === undefined ? null : <p className="text-sm text-destructive">{unit.skipReason}</p>}
          {unit.cancellationReason === undefined ? null : <p className="text-sm text-destructive">{unit.cancellationReason}</p>}
          {unit.nextRetryAt === undefined ? null : <p className="text-sm text-muted-foreground">Retry scheduled for {formatDateTime(unit.nextRetryAt)}</p>}
        </div>

        <Field className="w-full max-w-xs">
          <FieldLabel htmlFor="job-attempt">Attempt</FieldLabel>
          <Select
            id="job-attempt"
            value={selectedAttempt?.attemptNumber ?? ""}
            onChange={(event) => setRouteState(activeView, Number(event.target.value))}
            disabled={attempts.length === 0}
          >
            {attempts.map((attempt) => (
              <SelectItem key={attempt.attemptId} value={attempt.attemptNumber}>
                Attempt {attempt.attemptNumber} · {attempt.status}
              </SelectItem>
            ))}
          </Select>
        </Field>
      </div>

      <Tabs value={activeView} onValueChange={(value) => setRouteState(value as JobPageView, selectedAttempt?.attemptNumber)}>
        <TabsList className="grid w-full max-w-md grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6">
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Execution details</h2>
            <div className="grid gap-3">
              <DetailRow label="Image" value={unit.image ?? "-"} />
              <DetailRow label="Command" value={unit.command ?? "-"} monospace />
              <DetailRow label="Working Directory" value={unit.workingDirectory ?? "-"} />
              <DetailRow label="Dependencies" value={unit.dependencyNames.length === 0 ? "-" : unit.dependencyNames.join(", ")} />
              <DetailRow label="Source location" value={formatSourceLocation(unit.source)} />
            </div>
          </section>

          <Separator />

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Resolved Inputs</h2>
            {(unit.inputs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No resolved inputs.</p>
            ) : (
              <div className="grid gap-3">
                {(unit.inputs ?? []).map((input) => (
                  <ValueRow key={`${input.name}-${input.source ?? "none"}`} label={input.name} value={formatValue(input.value)} detail={input.source} />
                ))}
              </div>
            )}
          </section>

          <Separator />

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Outputs</h2>
            {(unit.outputs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No outputs recorded.</p>
            ) : (
              <div className="grid gap-3">
                {(unit.outputs ?? []).map((output) => (
                  <ValueRow key={`${output.name}-${output.path ?? output.unitId ?? "output"}`} label={output.name} value={formatValue(output.value)} detail={output.path ?? output.unitId} format={output.format} />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="logs" className="grid gap-4">
          <div className="flex justify-end">
            <Button variant={showAllLogs ? "default" : "outline"} size="sm" onClick={() => setShowAllLogs((value) => !value)}>
              All attempts
            </Button>
          </div>

          <PayloadBrowser
            items={logItems}
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
          <div className="flex justify-end">
            <Button variant={showAllArtifacts ? "default" : "outline"} size="sm" onClick={() => setShowAllArtifacts((value) => !value)}>
              All attempts
            </Button>
          </div>

          <PayloadBrowser
            items={artifactItems}
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

        <TabsContent value="timeline">
          {jobEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events for this attempt.</p>
          ) : (
            <ScrollArea className="h-[60vh] rounded-md border">
              <div className="grid">
                {jobEvents.map((event) => (
                  <div key={event.eventId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                    <span className={`mt-1 inline-flex size-2.5 rounded-full ${eventDotClass(event)}`} />
                    <div className="grid gap-1">
                      <p className="text-sm text-foreground">{event.message}</p>
                      <p className="text-xs text-muted-foreground">{event.type}</p>
                    </div>
                    <div className="grid justify-items-end gap-1 text-xs text-muted-foreground">
                      <span>{formatDateTime(event.occurredAt)}</span>
                      <span>#{event.sequence}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function DetailRow(props: { readonly label: string; readonly value: string; readonly monospace?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className={props.monospace ? "overflow-x-auto whitespace-pre font-mono text-sm text-foreground" : "text-sm text-foreground"}>{props.value}</div>
    </div>
  )
}

function ValueRow(props: { readonly label: string; readonly value: string; readonly detail?: string | undefined; readonly format?: string | undefined }) {
  return (
    <div className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
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

const eventDotClass = (event: TimelineEventDto) => {
  const type = event.type.toLowerCase()

  if (type.includes("succeeded") || type.includes("completed")) {
    return "bg-emerald-400"
  }

  if (type.includes("failed") || type.includes("timedout") || type.includes("timed_out")) {
    return "bg-rose-400"
  }

  if (type.includes("started") || type.includes("dispatched") || type.includes("ready")) {
    return "bg-sky-400"
  }

  if (type.includes("skipped")) {
    return "bg-amber-400"
  }

  return "bg-zinc-500"
}
