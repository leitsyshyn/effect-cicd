import { AlertCircle, ArrowLeft, Clock3, RefreshCcw } from "lucide-react"
import { type ReactNode, startTransition, useEffect, useMemo, useState } from "react"

import { createDashboardApi } from "./api.ts"
import { Badge } from "./components/ui/badge.tsx"
import { Button } from "./components/ui/button.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.tsx"
import { ScrollArea } from "./components/ui/scroll-area.tsx"
import { Separator } from "./components/ui/separator.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx"
import { TooltipProvider } from "./components/ui/tooltip.tsx"
import type { PayloadMetadataDto, RunDetailDto, RunSummaryDto, RunUnitDto, TimelineEventDto } from "./types.ts"

const api = createDashboardApi()
const pipelineStageWidth = 260
const pipelineStageGap = 32
const pipelineStageHeaderHeight = 42
const pipelineUnitHeight = 58
const pipelineUnitGap = 10
const pipelineFramePaddingX = 24
const pipelineFramePaddingY = 24

export function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  const [search, setSearch] = useState(() => window.location.search)

  useEffect(() => {
    document.documentElement.classList.add("dark")

    const onPopState = () => {
      startTransition(() => {
        setPath(window.location.pathname)
        setSearch(window.location.search)
      })
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  return (
    <TooltipProvider>
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-4 px-5 py-5 text-[14px] sm:px-6 lg:px-8">
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="text-[15px] font-semibold tracking-tight">effect-cicd</div>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {path === "/" ? <RunsPage /> : <RunPage path={path} search={search} setSearch={setSearch} />}
      </div>
    </TooltipProvider>
  )
}

export function RunsPage() {
  const [runs, setRuns] = useState<ReadonlyArray<RunSummaryDto>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const nextRuns = await api.listRuns()
      startTransition(() => setRuns(nextRuns))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="grid gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Runs</h1>
          <div className="mt-1 text-sm text-muted-foreground">Persisted workflow runs</div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {error === null ? null : <InlineError message={error} />}
          {loading ? (
            <EmptyState title="Loading runs" description="Fetching persisted runs" />
          ) : runs.length === 0 ? (
            <EmptyState title="No runs" description="Start a workflow and it will appear here" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.runId}>
                    <TableCell>
                      <a href={`/runs/${encodeURIComponent(run.runId)}`} className="block">
                        <div className="font-medium">{run.workflowName ?? run.workflowId}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{run.workflowId}</div>
                      </a>
                    </TableCell>
                    <TableCell><StatusBadge status={run.status} /></TableCell>
                    <TableCell>{run.progress.completedUnits}/{run.progress.totalUnits}</TableCell>
                    <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                    <TableCell>{formatDateTime(run.updatedAt)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{truncateMiddle(run.runId, 52)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function RunPage({ path, search, setSearch }: { readonly path: string; readonly search: string; readonly setSearch: (value: string) => void }) {
  const runId = decodeURIComponent(path.replace(/^\/runs\//, ""))
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLogRef, setSelectedLogRef] = useState<string | null>(null)
  const [selectedArtifactRef, setSelectedArtifactRef] = useState<string | null>(null)
  const [payload, setPayload] = useState<string>("")
  const selectedUnitId = useMemo(() => new URLSearchParams(search).get("unit") ?? undefined, [search])
  const selectedUnit = detail?.units.find((unit) => unit.unitId === selectedUnitId) ?? detail?.units[0]

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const nextDetail = await api.inspectRun(runId)
      startTransition(() => setDetail(nextDetail))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [runId])

  useEffect(() => {
    if (selectedLogRef === null && selectedArtifactRef === null) {
      setPayload("")
      return
    }

    const loadPayload = async () => {
      const nextPayload = selectedLogRef !== null ? await api.readLogPayload(selectedLogRef) : await api.readArtifactPayload(selectedArtifactRef!)
      startTransition(() => setPayload(nextPayload))
    }

    void loadPayload()
  }, [selectedArtifactRef, selectedLogRef])

  const setSelectedUnitInUrl = (unitId: string) => {
    const params = new URLSearchParams(search)
    params.set("unit", unitId)
    const nextSearch = `?${params.toString()}`
    window.history.replaceState(null, "", `${path}${nextSearch}`)
    startTransition(() => setSearch(nextSearch))
  }

  if (loading) {
    return <EmptyState title="Loading run" description="Fetching run detail" />
  }

  if (error !== null || detail === null) {
    return <InlineError message={error ?? "Run not found"} />
  }

  const filteredEvents = selectedUnit === undefined ? detail.events : detail.events.filter((event) => event.unitId === selectedUnit.unitId)
  const filteredLogs = selectedUnit === undefined ? detail.logs : detail.logs.filter((log) => log.unitId === selectedUnit.unitId)
  const filteredArtifacts = selectedUnit === undefined ? detail.artifacts : detail.artifacts.filter((artifact) => artifact.unitId === selectedUnit.unitId)

  return (
    <section className="grid gap-4">
      <RunHeader detail={detail} />
      <div className="grid min-h-0 gap-4 xl:items-start xl:grid-cols-[minmax(0,1.9fr)_360px]">
        <RunPipelineView detail={detail} {...(selectedUnit?.unitId === undefined ? {} : { selectedUnitId: selectedUnit.unitId })} onSelectUnit={setSelectedUnitInUrl} />
        <RunUnitPanel
          {...(selectedUnit === undefined ? {} : { unit: selectedUnit })}
          logs={filteredLogs}
          artifacts={filteredArtifacts}
          events={filteredEvents}
          selectedLogRef={selectedLogRef}
          selectedArtifactRef={selectedArtifactRef}
          payload={payload}
          onSelectLog={(logRef) => {
            setSelectedArtifactRef(null)
            setSelectedLogRef(logRef)
          }}
          onSelectArtifact={(artifactRef) => {
            setSelectedLogRef(null)
            setSelectedArtifactRef(artifactRef)
          }}
        />
      </div>
    </section>
  )
}

export function RunHeader({ detail }: { readonly detail: RunDetailDto }) {
  return (
    <div className="grid gap-3 border-b border-border/80 pb-4">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <a href="/" className="inline-flex items-center gap-2 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Runs
        </a>
        <span>/</span>
        <span>{detail.run.workflowName ?? detail.run.workflowId}</span>
        <span>/</span>
        <span className="font-mono text-foreground">{detail.run.runId}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-tight">{detail.run.workflowName ?? detail.run.workflowId}</h1>
            <StatusBadge status={detail.run.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <InlineMeta icon={<Clock3 className="h-4 w-4" />} label="Started" value={formatDateTime(detail.run.startedAt)} />
            <InlineMeta label="Finished" value={formatDateTime(detail.run.finishedAt)} />
            <InlineMeta label="Units" value={`${detail.run.progress.totalUnits}`} />
            <InlineMeta label="Completed" value={`${detail.run.progress.completedUnits}`} />
            <InlineMeta label="Logs" value={`${detail.logs.length}`} />
            <InlineMeta label="Artifacts" value={`${detail.artifacts.length}`} />
          </div>
          {detail.run.failureMessage === undefined ? null : <InlineError message={detail.run.failureMessage} compact />}
        </div>
      </div>
    </div>
  )
}

export function RunPipelineView({ detail, selectedUnitId, onSelectUnit }: { readonly detail: RunDetailDto; readonly selectedUnitId?: string; readonly onSelectUnit: (unitId: string) => void }) {
  const positions = new Map<string, { readonly x: number; readonly y: number }>()
  const stageHeights = detail.stages.map((stage) => pipelineStageHeaderHeight + Math.max(stage.units.length, 1) * pipelineUnitHeight + Math.max(stage.units.length - 1, 0) * pipelineUnitGap)
  const canvasHeight = Math.max(...stageHeights, 0) + pipelineFramePaddingY * 2
  const canvasWidth = detail.stages.length * pipelineStageWidth + Math.max(detail.stages.length - 1, 0) * pipelineStageGap + pipelineFramePaddingX * 2

  detail.stages.forEach((stage, stageIndex) => {
    stage.units.forEach((unit, unitIndex) => {
      positions.set(unit.unitId, {
        x: pipelineFramePaddingX + stageIndex * (pipelineStageWidth + pipelineStageGap),
        y: pipelineFramePaddingY + pipelineStageHeaderHeight + unitIndex * (pipelineUnitHeight + pipelineUnitGap),
      })
    })
  })

  return (
    <Card className="self-start overflow-hidden">
      <CardHeader className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-[15px]">Pipeline</CardTitle>
          <div className="text-xs text-muted-foreground">{detail.dependencies.length} dependencies</div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <ScrollArea className="w-full">
          <div className="relative min-w-max" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
            <svg data-testid="pipeline-deps" className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} fill="none">
              {detail.dependencies.map((dependency) => {
                const from = positions.get(dependency.from)
                const to = positions.get(dependency.to)
                if (from === undefined || to === undefined) {
                  return null
                }

                const startX = from.x + pipelineStageWidth - 16
                const startY = from.y + pipelineUnitHeight / 2
                const endX = to.x + 16
                const endY = to.y + pipelineUnitHeight / 2
                const delta = Math.max((endX - startX) / 2, 18)

                return (
                  <path
                    key={`${dependency.from}-${dependency.to}`}
                    d={`M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`}
                    stroke={selectedUnitId === dependency.to || selectedUnitId === dependency.from ? "rgba(147,197,253,0.8)" : "rgba(161,161,170,0.28)"}
                    strokeWidth={selectedUnitId === dependency.to || selectedUnitId === dependency.from ? 2 : 1.25}
                  />
                )
              })}
            </svg>

            <div className="relative flex gap-8">
              {detail.stages.map((stage) => (
                <div key={stage.id} className="w-[260px] min-w-[260px] border border-white/6 bg-[#1d1e24] px-3 py-3">
                  <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="text-[13px] font-semibold tracking-wide text-zinc-200">{stage.label}</div>
                    <div className="text-[11px] text-zinc-500">{stage.units.length}</div>
                  </div>

                  <div className="space-y-[10px]">
                    {stage.units.map((unit) => (
                      <button
                        key={unit.unitId}
                        type="button"
                        onClick={() => onSelectUnit(unit.unitId)}
                        className={[
                          "flex h-[58px] w-full items-center justify-between border px-3 text-left transition",
                          selectedUnitId === unit.unitId
                            ? "border-sky-400/70 bg-[#191b22] shadow-[inset_0_0_0_1px_rgba(125,211,252,0.25)]"
                            : "border-white/8 bg-[#17181d] hover:border-white/14 hover:bg-[#1b1d24]",
                        ].join(" ")}
                      >
                        <div className="min-w-0 pr-3">
                          <div className="truncate text-[14px] font-medium text-zinc-100">{unit.name}</div>
                          <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{unit.unitId}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusDot status={unit.status} />
                          <div className="mt-1 text-[11px] text-zinc-500">{formatDuration(unit.durationMs)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function RunUnitPanel(props: {
  readonly unit?: RunUnitDto
  readonly logs: ReadonlyArray<PayloadMetadataDto>
  readonly artifacts: ReadonlyArray<PayloadMetadataDto>
  readonly events: ReadonlyArray<TimelineEventDto>
  readonly selectedLogRef: string | null
  readonly selectedArtifactRef: string | null
  readonly payload: string
  readonly onSelectLog: (logRef: string) => void
  readonly onSelectArtifact: (artifactRef: string) => void
}) {
  const { unit, logs, artifacts, events, selectedLogRef, selectedArtifactRef, payload, onSelectLog, onSelectArtifact } = props
  const [activeTab, setActiveTab] = useState("logs")

  useEffect(() => {
    setActiveTab("logs")
  }, [unit?.unitId])

  const selectedLog = logs.find((log) => log.ref === selectedLogRef)
  const selectedArtifact = artifacts.find((artifact) => artifact.ref === selectedArtifactRef)

  return (
    <Card className="min-h-0 overflow-hidden xl:sticky xl:top-4">
      <CardHeader className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-[15px]">{unit?.name ?? "Job"}</CardTitle>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{unit?.unitId ?? "Select a job"}</div>
          </div>
          {unit === undefined ? null : <StatusBadge status={unit.status} />}
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 px-4 py-4">
        {unit === undefined ? (
          <EmptyState title="No job selected" description="Select a job in the pipeline" compact />
        ) : (
          <>
            <div className="grid gap-2 text-sm text-zinc-300">
              <DetailRow label="Duration" value={formatDuration(unit.durationMs)} />
              <DetailRow label="Attempts" value={`${unit.attempts.length}`} />
              <DetailRow label="Dependencies" value={unit.dependencyNames.length === 0 ? "None" : unit.dependencyNames.join(", ")} />
            </div>
            {unit.failureMessage === undefined ? null : <InlineError message={unit.failureMessage} compact />}
          </>
        )}

        <Separator />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="attempts">Attempts</TabsTrigger>
          </TabsList>

          <div className="h-[620px] pt-3">
            <TabsContent value="logs" className="mt-0 h-full">
              <PayloadBrowser
                kind="log"
                items={logs}
                selectedItem={selectedLog}
                payload={selectedLogRef === null ? "" : payload}
                emptyTitle="No logs"
                emptyDescription="No registered logs"
                onSelect={onSelectLog}
              />
            </TabsContent>

            <TabsContent value="artifacts" className="mt-0 h-full">
              <PayloadBrowser
                kind="artifact"
                items={artifacts}
                selectedItem={selectedArtifact}
                payload={selectedArtifactRef === null ? "" : payload}
                emptyTitle="No artifacts"
                emptyDescription="No registered artifacts"
                onSelect={onSelectArtifact}
              />
            </TabsContent>

            <TabsContent value="timeline" className="mt-0 h-full">
              <ScrollArea className="h-full pr-2">
                <div className="space-y-2">
                  {events.map((event) => (
                    <div key={event.eventId} className="border border-white/6 bg-[#17181d] px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium text-zinc-200">{event.type}</div>
                        <div className="text-[11px] text-zinc-500">#{event.sequence}</div>
                      </div>
                      <div className="mt-1 text-[12px] text-zinc-400">{event.message}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{formatDateTime(event.occurredAt)}</div>
                    </div>
                  ))}
                  {events.length === 0 ? <EmptyState title="No events" description="No events for this job" compact /> : null}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="attempts" className="mt-0 h-full">
              <ScrollArea className="h-full pr-2">
                <div className="space-y-2">
                  {unit?.attempts.map((attempt) => (
                    <div key={attempt.attemptId} className="border border-white/6 bg-[#17181d] px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-zinc-100">Attempt {attempt.attemptNumber}</div>
                        <StatusBadge status={attempt.status} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-zinc-500">{truncateMiddle(attempt.attemptId, 44)}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{formatDateTime(attempt.startedAt)} to {formatDateTime(attempt.finishedAt)}</div>
                    </div>
                  ))}
                  {unit?.attempts.length ? null : <EmptyState title="No attempts" description="No attempt history" compact />}
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function PayloadBrowser({ kind, items, selectedItem, payload, emptyTitle, emptyDescription, onSelect }: { readonly kind: "log" | "artifact"; readonly items: ReadonlyArray<PayloadMetadataDto>; readonly selectedItem: PayloadMetadataDto | undefined; readonly payload: string; readonly emptyTitle: string; readonly emptyDescription: string; readonly onSelect: (ref: string) => void }) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} compact />
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="max-h-[156px] space-y-1 overflow-auto pr-1">
        {items.map((item) => (
          <button
            key={item.ref}
            type="button"
            onClick={() => onSelect(item.ref)}
            className={[
              "w-full border px-3 py-2 text-left transition",
              selectedItem?.ref === item.ref ? "border-sky-400/60 bg-[#1b1d24]" : "border-white/6 bg-[#17181d] hover:border-white/14",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-100">{item.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">{item.category ?? "log"}</div>
              </div>
              <StatusBadge status={item.status} />
            </div>
          </button>
        ))}
      </div>

      <ConsoleViewer kind={kind} item={selectedItem} payload={payload} />
    </div>
  )
}

function ConsoleViewer({ kind, item, payload }: { readonly kind: "log" | "artifact"; readonly item: PayloadMetadataDto | undefined; readonly payload: string }) {
  if (item === undefined) {
    return <EmptyState title={`No ${kind} selected`} description={`Select a ${kind} entry`} compact />
  }

  const lines = payload.length === 0 ? [] : payload.replace(/\n$/, "").split("\n")

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-white/6 bg-[#101115]">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] text-zinc-100">{item.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-500">{item.category ?? kind}</div>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <ScrollArea className="h-full">
        {lines.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">No payload content</div>
        ) : (
          <div className="font-mono text-[12px] leading-6 text-zinc-100">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-white/[0.03] px-0 last:border-b-0">
                <div className="select-none border-r border-white/[0.04] px-3 py-0.5 text-right text-zinc-500">{index + 1}</div>
                <div className="overflow-x-auto px-3 py-0.5 whitespace-pre">{line.length === 0 ? " " : line}</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function InlineMeta({ icon, label, value }: { readonly icon?: ReactNode; readonly label: string; readonly value: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </span>
  )
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { readonly status: string }) {
  const variant = status === "succeeded" ? "success" : status === "failed" || status === "interrupted" ? "failure" : status === "running" || status === "ready" ? "running" : status === "skipped" ? "skipped" : "secondary"
  return <Badge variant={variant as any}>{status}</Badge>
}

function StatusDot({ status }: { readonly status: string }) {
  const color = status === "succeeded"
    ? "bg-emerald-400"
    : status === "failed" || status === "interrupted"
      ? "bg-rose-400"
      : status === "running" || status === "ready"
        ? "bg-sky-400"
        : status === "skipped"
          ? "bg-amber-400"
          : "bg-zinc-500"

  return <span className={["inline-flex h-2.5 w-2.5 rounded-full", color].join(" ")} />
}

function EmptyState({ title, description, compact = false }: { readonly title: string; readonly description: string; readonly compact?: boolean }) {
  return (
    <div className={["flex flex-col items-center justify-center border border-dashed border-white/8 bg-[#16171c] text-center", compact ? "min-h-[140px] px-4 py-6" : "min-h-[260px] px-6 py-10"].join(" ")}>
      <div className="mb-2"><AlertCircle className="h-4 w-4 text-zinc-500" /></div>
      <div className="text-sm font-medium text-zinc-100">{title}</div>
      <div className="mt-1 text-sm text-zinc-500">{description}</div>
    </div>
  )
}

function InlineError({ message, compact = false }: { readonly message: string; readonly compact?: boolean }) {
  return <div className={["border border-rose-500/20 bg-rose-500/10 text-rose-200", compact ? "px-3 py-2 text-sm" : "m-4 px-4 py-3 text-sm"].join(" ")}>{message}</div>
}

const formatDateTime = (value: string | undefined) => (value === undefined ? "-" : new Date(value).toLocaleString())

const formatDuration = (value: number | undefined) => {
  if (value === undefined) {
    return "-"
  }

  if (value < 1_000) {
    return `${value}ms`
  }

  if (value < 60_000) {
    return `${(value / 1_000).toFixed(1)}s`
  }

  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

const truncateMiddle = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value
  }

  const visible = Math.max(maxLength - 3, 2)
  const start = Math.ceil(visible / 2)
  const end = Math.floor(visible / 2)
  return `${value.slice(0, start)}...${value.slice(value.length - end)}`
}
