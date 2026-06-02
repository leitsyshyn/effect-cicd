import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { EmptyState } from "../components/empty-state.tsx"
import { RunHeader } from "../components/run-header.tsx"
import { RunInspector } from "../components/run-inspector.tsx"
import { RunOverview } from "../components/run-overview.tsx"
import { RunPipelineView } from "../components/run-pipeline.tsx"
import { RunTimeline } from "../components/run-timeline.tsx"
import { Button } from "../components/ui/button.tsx"
import { hrefForRun, type DashboardNavigate, type RunPageView, type RunRoute } from "../lib/routing.ts"
import type { RunDetailDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

const pageTabs: ReadonlyArray<readonly [RunPageView, string]> = [
  ["pipeline", "Pipeline"],
  ["jobs", "Jobs"],
  ["summary", "Overview"],
  ["events", "Events"],
]

export function RunPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate; readonly route: RunRoute }) {
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [selectedLogRef, setSelectedLogRef] = useState<string | null>(null)
  const [selectedArtifactRef, setSelectedArtifactRef] = useState<string | null>(null)
  const [payload, setPayload] = useState("")
  const [payloadError, setPayloadError] = useState<string>()
  const [loadingPayload, setLoadingPayload] = useState(false)
  const [actionPending, setActionPending] = useState<string>()
  const [actionNotice, setActionNotice] = useState<string>()
  const [actionError, setActionError] = useState<string>()

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

  useEffect(() => {
    if (selectedLogRef === null && selectedArtifactRef === null) {
      setPayload("")
      setPayloadError(undefined)
      setLoadingPayload(false)
      return
    }

    const loadPayload = async () => {
      setLoadingPayload(true)
      setPayloadError(undefined)

      try {
        const nextPayload = selectedLogRef !== null
          ? await props.api.readLogPayload(selectedLogRef)
          : await props.api.readArtifactPayload(selectedArtifactRef!)
        setPayload(nextPayload)
      } catch (caught) {
        setPayload("")
        setPayloadError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setLoadingPayload(false)
      }
    }

    void loadPayload()
  }, [props.api, selectedArtifactRef, selectedLogRef])

  const activeView: RunPageView = props.route.view ?? "pipeline"
  const selectedUnit = detail?.units.find((unit) => unit.unitId === props.route.selectedUnitId) ?? detail?.units[0]
  const setView = (view: RunPageView) => props.navigate(hrefForRun(props.route.runId, selectedUnit?.unitId, view), { replace: true })
  const selectUnit = (unitId: string) => props.navigate(hrefForRun(props.route.runId, unitId, activeView), { replace: true })

  const filteredEvents = selectedUnit === undefined ? [] : detail?.events.filter((event) => event.unitId === selectedUnit.unitId) ?? []
  const filteredLogs = selectedUnit === undefined ? [] : detail?.logs.filter((log) => log.unitId === selectedUnit.unitId) ?? []
  const filteredArtifacts = selectedUnit === undefined ? [] : detail?.artifacts.filter((artifact) => artifact.unitId === selectedUnit.unitId) ?? []

  const runAction = async (action: "cancel" | "retry" | "gc", effect: () => Promise<unknown>) => {
    setActionPending(action)
    setActionError(undefined)
    setActionNotice(undefined)

    try {
      const result = await effect()

      if (action === "retry" && typeof result === "object" && result !== null && "runId" in result && typeof result.runId === "string") {
        props.navigate(hrefForRun(result.runId, undefined, "pipeline"))
        return
      }

      if (action === "gc" && typeof result === "object" && result !== null && "deletedCount" in result) {
        setActionNotice(`Payload GC completed. Deleted ${(result as any).deletedCount} payloads and freed ${(result as any).bytesFreed} bytes.`)
      }

      if (action === "cancel") {
        setActionNotice("Cancellation requested. Run state will update as the Engine persists the new status.")
      }

      await load(true)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionPending(undefined)
    }
  }

  if (loading) {
    return <EmptyState title="Loading run" description="Fetching durable run detail from the Engine service." />
  }

  if (error !== undefined || detail === null) {
    return <EmptyState title="Run unavailable" description={error ?? "Run not found"} />
  }

  return (
    <section className="grid gap-4">
      <RunHeader
        detail={detail}
        navigate={props.navigate}
        {...(actionPending === undefined ? {} : { actionPending })}
        {...(actionNotice === undefined ? {} : { actionNotice })}
        {...(actionError === undefined ? {} : { actionError })}
        onCancel={() => void runAction("cancel", () => props.api.cancelRun(detail.run.runId, "Canceled from dashboard"))}
        onRetry={() => void runAction("retry", () => props.api.retryRun(detail.run.runId, "Retried from dashboard"))}
        onGc={() => void runAction("gc", () => props.api.gcRunArtifacts(detail.run.runId))}
      />

      <div className="dashboard-nav flex flex-wrap items-center gap-5">
        {pageTabs.map(([value, label]) => (
          <Button key={value} variant="ghost" size="sm" className={["dashboard-tab rounded-none px-0 pb-3 pt-0", activeView === value ? "" : "opacity-90"].join(" ")} onClick={() => setView(value)}>
            {label}
          </Button>
        ))}
      </div>

      {activeView === "pipeline" ? (
        <div className="grid gap-4">
          <RunPipelineView detail={detail} {...(selectedUnit?.unitId === undefined ? {} : { selectedUnitId: selectedUnit.unitId })} onSelectUnit={selectUnit} />
        </div>
      ) : null}

      {activeView === "jobs" ? (
        <div className="grid min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <section className="dashboard-section overflow-hidden">
            <header className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Jobs</header>
            <div className="max-h-[72vh] overflow-auto">
              {detail.stages.map((stage) => (
                <div key={stage.id} className="border-b border-border last:border-b-0">
                  <div className="bg-[#1a1624] px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{stage.label}</div>
                  <div>
                    {stage.units.map((unit) => (
                      <button
                        key={unit.unitId}
                        type="button"
                        onClick={() => selectUnit(unit.unitId)}
                        className={[
                          "flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-b-0",
                          selectedUnit?.unitId === unit.unitId ? "bg-[#2a2436]" : "hover:bg-[#221d2d]",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{unit.name}</div>
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{unit.unitId}</div>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">{unit.status}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <RunInspector
            {...(selectedUnit === undefined ? {} : { unit: selectedUnit })}
            logs={filteredLogs}
            artifacts={filteredArtifacts}
            events={filteredEvents}
            selectedLogRef={selectedLogRef}
            selectedArtifactRef={selectedArtifactRef}
            payload={payload}
            {...(payloadError === undefined ? {} : { payloadError })}
            loadingPayload={loadingPayload}
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
      ) : null}

      {activeView === "summary" ? <RunOverview detail={detail} /> : null}

      {activeView === "events" ? <RunTimeline events={detail.events} {...(selectedUnit?.unitId === undefined ? {} : { selectedUnitId: selectedUnit.unitId })} /> : null}
    </section>
  )
}
