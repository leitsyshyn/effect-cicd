import { useEffect, useState } from "react"

import type { createDashboardApi } from "../api.ts"
import { RunHeader } from "../components/run-header.tsx"
import { RunPipelineView } from "../components/run-pipeline.tsx"
import { RunTimeline } from "../components/run-timeline.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { hrefForJob, hrefForRun, type DashboardNavigate, type RunPageView, type RunRoute } from "../lib/routing.ts"
import type { RunDetailDto } from "../types.ts"

type DashboardApi = ReturnType<typeof createDashboardApi>

const pageTabs: ReadonlyArray<readonly [RunPageView, string]> = [
  ["workflow", "Workflow"],
  ["timeline", "Timeline"],
]

export function RunPage(props: { readonly api: DashboardApi; readonly navigate: DashboardNavigate; readonly route: RunRoute }) {
  const [detail, setDetail] = useState<RunDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
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
        setActionNotice("Cancellation requested.")
      }

      await load(true)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionPending(undefined)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading run...</p>
  }

  if (error !== undefined || detail === null) {
    return <p className="text-sm text-destructive">{error ?? "Run not found"}</p>
  }

  const activeView: RunPageView = props.route.view ?? "workflow"

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

      <Tabs value={activeView} onValueChange={(value) => props.navigate(hrefForRun(detail.run.runId, value as RunPageView), { replace: true })}>
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          {pageTabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>{label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="workflow">
          <RunPipelineView detail={detail} onSelectUnit={(unitId) => props.navigate(hrefForJob(detail.run.runId, unitId))} />
        </TabsContent>

        <TabsContent value="timeline">
          <RunTimeline events={detail.events} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
