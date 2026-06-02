import { Activity, CircleAlert, Logs, PackageSearch } from "lucide-react"
import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { EmptyState } from "../components/empty-state.tsx"
import { MetricCard } from "../components/metric-card.tsx"
import { RunHeader } from "../components/run-header.tsx"
import { RunInspector } from "../components/run-inspector.tsx"
import { RunOverview } from "../components/run-overview.tsx"
import { RunPipelineView } from "../components/run-pipeline.tsx"
import { RunTimeline } from "../components/run-timeline.tsx"
import { formatDuration } from "../lib/format.ts"
import { hrefForRun, type DashboardNavigate, type RunRoute } from "../lib/routing.ts"
import type { RunDetailDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

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

  const load = async () => {
    setLoading(true)
    setError(undefined)

    try {
      setDetail(await props.api.inspectRun(props.route.runId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const source = new EventSource(`/api/runs/${encodeURIComponent(props.route.runId)}/stream`)
    const reload = () => {
      void load()
    }

    source.addEventListener("run-update", reload)
    source.onerror = () => undefined

    return () => source.close()
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

  const selectedUnit = detail?.units.find((unit) => unit.unitId === props.route.selectedUnitId) ?? detail?.units[0]
  const selectUnit = (unitId: string) => props.navigate(hrefForRun(props.route.runId, unitId), { replace: true })

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
        props.navigate(hrefForRun(result.runId))
        return
      }

      if (action === "gc" && typeof result === "object" && result !== null && "deletedCount" in result) {
        setActionNotice(`Payload GC completed. Deleted ${(result as any).deletedCount} payloads and freed ${(result as any).bytesFreed} bytes.`)
      }

      if (action === "cancel") {
        setActionNotice("Cancellation requested. Run state will update as the Engine persists the new status.")
      }

      await load()
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Progress" value={`${detail.run.progress.completedUnits}/${detail.run.progress.totalUnits}`} detail="Completed units / total units" accent={<Activity className="size-4 text-[var(--dashboard-highlight)]" />} />
        <MetricCard label="Duration" value={formatDuration(detail.run.durationMs)} detail="Engine-timed run duration" accent={<CircleAlert className="size-4 text-[var(--dashboard-highlight)]" />} />
        <MetricCard label="Logs" value={`${detail.logs.length}`} detail="Persisted log payloads" accent={<Logs className="size-4 text-[var(--dashboard-highlight)]" />} />
        <MetricCard label="Artifacts" value={`${detail.artifacts.length}`} detail="Persisted artifact payloads" accent={<PackageSearch className="size-4 text-[var(--dashboard-highlight)]" />} />
      </div>

      <RunOverview detail={detail} />

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_420px] xl:items-start">
        <div className="grid gap-4">
          <RunPipelineView detail={detail} {...(selectedUnit?.unitId === undefined ? {} : { selectedUnitId: selectedUnit.unitId })} onSelectUnit={selectUnit} />
          <RunTimeline events={detail.events} {...(selectedUnit?.unitId === undefined ? {} : { selectedUnitId: selectedUnit.unitId })} />
        </div>

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
    </section>
  )
}
