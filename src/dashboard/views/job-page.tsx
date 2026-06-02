import { useEffect, useState } from "react"

import type { ArtifactPayloadDto, createDashboardApi } from "../api.ts"
import { PayloadBrowser, type PayloadBrowserContent, type PayloadBrowserItem } from "../components/payload-browser.tsx"
import { StatusBadge } from "../components/status-badge.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Button } from "../components/ui/button.tsx"
import { ScrollArea } from "../components/ui/scroll-area.tsx"
import { Separator } from "../components/ui/separator.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { formatAge, formatBytes, formatDateTime, formatDuration, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import { hrefForJob, hrefForProject, hrefForProjects, hrefForRun, type DashboardNavigate, type JobPageView, type JobRoute } from "../lib/routing.ts"
import type { PayloadMetadataDto, RunDetailDto, TimelineEventDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

export function JobPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate; readonly route: JobRoute }) {
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [showAllArtifacts, setShowAllArtifacts] = useState(false)
  const [selectedLogRef, setSelectedLogRef] = useState<string>()
  const [selectedArtifactRef, setSelectedArtifactRef] = useState<string>()
  const [logPayload, setLogPayload] = useState("")
  const [logError, setLogError] = useState<string>()
  const [loadingLog, setLoadingLog] = useState(false)
  const [artifactContent, setArtifactContent] = useState<PayloadBrowserContent>()
  const [artifactError, setArtifactError] = useState<string>()
  const [loadingArtifact, setLoadingArtifact] = useState(false)

  const load = async (background = false) => {
    if (!background) {
      setLoading(true)
      setError(undefined)
    }

    try {
      setDetail(await props.api.inspectRun(props.route.runId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void load()

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true)
      }
    }, 5_000)

    return () => window.clearInterval(interval)
  }, [props.route.runId])

  const unit = detail?.units.find((entry) => entry.unitId === props.route.unitId)
  const attempts = unit === undefined ? [] : [...unit.attempts].sort((left, right) => left.attemptNumber - right.attemptNumber)
  const selectedAttempt = attempts.find((attempt) => attempt.attemptNumber === props.route.attempt) ?? attempts[attempts.length - 1]
  const activeView: JobPageView = props.route.view ?? "overview"
  const logs = detail?.logs.filter((log) => log.unitId === props.route.unitId) ?? []
  const artifacts = detail?.artifacts.filter((artifact) => artifact.unitId === props.route.unitId) ?? []
  const logScope = showAllLogs || selectedAttempt === undefined ? logs : logs.filter((log) => log.attemptId === selectedAttempt.attemptId)
  const artifactScope = showAllArtifacts || selectedAttempt === undefined ? artifacts : artifacts.filter((artifact) => artifact.attemptId === selectedAttempt.attemptId)
  const attemptNumbers = new Map(attempts.map((attempt) => [attempt.attemptId, attempt.attemptNumber] as const))
  const reportFormats = new Map((unit?.reports ?? []).map((report) => [report.artifactRef, report.format] as const))
  const selectedLog = logScope.find((log) => log.ref === selectedLogRef)
  const selectedArtifact = artifactScope.find((artifact) => artifact.ref === selectedArtifactRef)
  const jobEvents = selectedAttempt === undefined || detail === null || unit === undefined
    ? []
    : detail.events.filter((event) => event.unitId === unit.unitId && event.attemptId === selectedAttempt.attemptId)

  useEffect(() => {
    if (logScope.length === 0) {
      setSelectedLogRef(undefined)
      return
    }

    if (selectedLogRef === undefined || !logScope.some((log) => log.ref === selectedLogRef)) {
      setSelectedLogRef(logScope[0].ref)
    }
  }, [logScope, selectedLogRef])

  useEffect(() => {
    if (artifactScope.length === 0) {
      setSelectedArtifactRef(undefined)
      return
    }

    if (selectedArtifactRef === undefined || !artifactScope.some((artifact) => artifact.ref === selectedArtifactRef)) {
      setSelectedArtifactRef(artifactScope[0].ref)
    }
  }, [artifactScope, selectedArtifactRef])

  useEffect(() => {
    if (selectedLog === undefined) {
      setLogPayload("")
      setLogError(undefined)
      setLoadingLog(false)
      return
    }

    let cancelled = false

    const loadLog = async () => {
      setLoadingLog(true)
      setLogError(undefined)
      setLogPayload("")

      try {
        const payload = await props.api.readLogPayload(selectedLog.ref)
        if (!cancelled) {
          setLogPayload(payload)
        }
      } catch (caught) {
        if (!cancelled) {
          setLogError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (!cancelled) {
          setLoadingLog(false)
        }
      }
    }

    void loadLog()

    return () => {
      cancelled = true
    }
  }, [props.api, selectedLog])

  useEffect(() => {
    if (selectedArtifact === undefined) {
      setArtifactContent(undefined)
      setArtifactError(undefined)
      setLoadingArtifact(false)
      return
    }

    if (selectedArtifact.status === "missing" || selectedArtifact.status === "failed") {
      setArtifactContent({ kind: "unavailable", note: `Artifact is ${selectedArtifact.status}.` })
      setArtifactError(undefined)
      setLoadingArtifact(false)
      return
    }

    let cancelled = false

    const loadArtifact = async () => {
      setLoadingArtifact(true)
      setArtifactError(undefined)
      setArtifactContent(undefined)

      try {
        const payload = await props.api.readArtifactPayload(selectedArtifact.ref)
        if (!cancelled) {
          setArtifactContent(toArtifactViewerContent(payload))
        }
      } catch (caught) {
        if (!cancelled) {
          setArtifactError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (!cancelled) {
          setLoadingArtifact(false)
        }
      }
    }

    void loadArtifact()

    return () => {
      cancelled = true
    }
  }, [props.api, selectedArtifact])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading job...</p>
  }

  if (error !== undefined || detail === null) {
    return <p className="text-sm text-destructive">{error ?? "Run not found"}</p>
  }

  if (unit === undefined) {
    return <p className="text-sm text-destructive">Job not found.</p>
  }

  const workflowLabel = detail.run.workflowName ?? detail.run.workflowId
  const logItems = logScope.map((log) => toLogBrowserItem(log, showAllLogs ? attemptNumbers.get(log.attemptId) : undefined))
  const artifactItems = artifactScope.map((artifact) =>
    toArtifactBrowserItem(artifact, reportFormats.get(artifact.ref), showAllArtifacts ? attemptNumbers.get(artifact.attemptId) : undefined),
  )

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button type="button" onClick={() => props.navigate(hrefForProjects())} className="hover:text-foreground">
          Projects
        </button>
        <span>/</span>
        <button type="button" onClick={() => props.navigate(hrefForProject(detail.run.projectId))} className="hover:text-foreground">
          {detail.run.projectId}
        </button>
        <span>/</span>
        <button type="button" onClick={() => props.navigate(hrefForRun(detail.run.runId))} className="hover:text-foreground">
          {workflowLabel}
        </button>
        <span>/</span>
        <span className="text-foreground">{unit.name}</span>
      </div>

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

        <label className="grid gap-2 text-sm text-muted-foreground">
          <span>Attempt</span>
          <select
            value={selectedAttempt?.attemptNumber ?? ""}
            onChange={(event) => props.navigate(hrefForJob(detail.run.runId, unit.unitId, activeView, Number(event.target.value)), { replace: true })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            disabled={attempts.length === 0}
          >
            {attempts.map((attempt) => (
              <option key={attempt.attemptId} value={attempt.attemptNumber}>
                Attempt {attempt.attemptNumber} · {attempt.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Tabs value={activeView} onValueChange={(value) => props.navigate(hrefForJob(detail.run.runId, unit.unitId, value as JobPageView, selectedAttempt?.attemptNumber), { replace: true })}>
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
            selectedItem={selectedLog === undefined ? undefined : toLogBrowserItem(selectedLog, showAllLogs ? attemptNumbers.get(selectedLog.attemptId) : undefined)}
            content={selectedLog === undefined ? undefined : { kind: "text", text: logPayload }}
            {...(logError === undefined ? {} : { payloadError: logError })}
            loadingPayload={loadingLog}
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
            selectedItem={selectedArtifact === undefined ? undefined : toArtifactBrowserItem(selectedArtifact, reportFormats.get(selectedArtifact.ref), showAllArtifacts ? attemptNumbers.get(selectedArtifact.attemptId) : undefined)}
            content={artifactContent}
            {...(artifactError === undefined ? {} : { payloadError: artifactError })}
            loadingPayload={loadingArtifact}
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
