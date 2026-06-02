import { Clock3, FileCode2, Hammer, PackageOpen } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { formatDateTime, formatDuration, formatSourceLocation, formatValue, truncateMiddle } from "../lib/format.ts"
import type { PayloadMetadataDto, RunUnitDto, TimelineEventDto } from "../types.ts"
import { EmptyState } from "./empty-state.tsx"
import { InlineError } from "./inline-error.tsx"
import { PayloadBrowser } from "./payload-browser.tsx"
import { StatusBadge } from "./status-badge.tsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"
import { Separator } from "./ui/separator.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx"

export function RunInspector(props: {
  readonly unit?: RunUnitDto | undefined
  readonly logs: ReadonlyArray<PayloadMetadataDto>
  readonly artifacts: ReadonlyArray<PayloadMetadataDto>
  readonly events: ReadonlyArray<TimelineEventDto>
  readonly selectedLogRef: string | null
  readonly selectedArtifactRef: string | null
  readonly payload: string
  readonly payloadError?: string | undefined
  readonly loadingPayload: boolean
  readonly onSelectLog: (logRef: string) => void
  readonly onSelectArtifact: (artifactRef: string) => void
}) {
  const [activeTab, setActiveTab] = useState("inspect")

  useEffect(() => {
    setActiveTab("inspect")
  }, [props.unit?.unitId])

  const selectedLog = props.logs.find((log) => log.ref === props.selectedLogRef)
  const selectedArtifact = props.artifacts.find((artifact) => artifact.ref === props.selectedArtifactRef)

  return (
    <Card className="dashboard-panel min-h-0 overflow-hidden xl:sticky xl:top-6">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-[17px]">{props.unit?.name ?? "Unit inspector"}</CardTitle>
            <CardDescription>{props.unit?.unitId ?? "Select a unit in the pipeline to inspect run-local details."}</CardDescription>
          </div>
          {props.unit === undefined ? null : <StatusBadge status={props.unit.status} />}
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 px-4 py-4">
        {props.unit === undefined ? (
          <EmptyState title="No unit selected" description="Choose a stage node to inspect logs, artifacts, attempts, and resolved values." compact />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetaStat label="Duration" value={formatDuration(props.unit.durationMs)} />
              <MetaStat label="Attempts" value={`${props.unit.attempts.length}`} />
              <MetaStat label="Dependencies" value={props.unit.dependencyNames.length === 0 ? "None" : props.unit.dependencyNames.join(", ")} />
              <MetaStat label="Retry at" value={formatDateTime(props.unit.nextRetryAt)} />
              <MetaStat label="Image" value={props.unit.image ?? "Not recorded"} />
              <MetaStat label="Workdir" value={props.unit.workingDirectory ?? "default"} />
            </div>
            <div className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Command</div>
              <div className="mt-2 font-mono text-[12px] text-zinc-200">{props.unit.command ?? "Not retained"}</div>
            </div>
            {props.unit.failureMessage === undefined ? null : <InlineError message={props.unit.failureMessage} compact />}
            {props.unit.skipReason === undefined ? null : <InlineError message={props.unit.skipReason} compact />}
            {props.unit.cancellationReason === undefined ? null : <InlineError message={props.unit.cancellationReason} compact />}
          </>
        )}

        <Separator />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="inspect">Inspect</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="attempts">Attempts</TabsTrigger>
          </TabsList>

          <div className="h-[700px] pt-3">
            <TabsContent value="inspect" className="mt-0 h-full">
              {props.unit === undefined ? (
                <EmptyState title="No unit selected" description="Select a unit to inspect its resolved values and unit timeline." compact />
              ) : (
                <ScrollArea className="h-full pr-2">
                  <div className="grid gap-4">
                    <InspectorBlock title="Resolved inputs" icon={<Hammer className="size-4 text-[var(--dashboard-highlight)]" />}>
                      {(props.unit.inputs ?? []).length === 0 ? <MutedLine>No resolved unit inputs.</MutedLine> : (props.unit.inputs ?? []).map((input) => <ValueRow key={`${input.name}-${input.source ?? "none"}`} label={input.name} value={formatValue(input.value)} detail={input.source} />)}
                    </InspectorBlock>

                    <InspectorBlock title="Outputs" icon={<PackageOpen className="size-4 text-[var(--dashboard-highlight)]" />}>
                      {(props.unit.outputs ?? []).length === 0 ? <MutedLine>No outputs recorded.</MutedLine> : (props.unit.outputs ?? []).map((output) => <ValueRow key={`${output.name}-${output.unitId ?? "unit"}`} label={output.name} value={formatValue(output.value)} detail={output.path ?? output.unitId} />)}
                    </InspectorBlock>

                    <InspectorBlock title="Reports" icon={<FileCode2 className="size-4 text-[var(--dashboard-highlight)]" />}>
                      {(props.unit.reports ?? []).length === 0 ? (
                        <MutedLine>No reports recorded.</MutedLine>
                      ) : (
                        (props.unit.reports ?? []).map((report) => <ValueRow key={report.artifactRef} label={report.name} value={report.format} detail={truncateMiddle(report.artifactRef, 44)} />)
                      )}
                    </InspectorBlock>

                    <InspectorBlock title="Source" icon={<Clock3 className="size-4 text-[var(--dashboard-highlight)]" />}>
                      <MutedLine>{formatSourceLocation(props.unit.source)}</MutedLine>
                    </InspectorBlock>

                    <InspectorBlock title="Unit timeline" icon={<Clock3 className="size-4 text-[var(--dashboard-highlight)]" />}>
                      {props.events.length === 0 ? (
                        <MutedLine>No unit-scoped events.</MutedLine>
                      ) : (
                        props.events.map((event) => <ValueRow key={event.eventId} label={event.type} value={event.message} detail={formatDateTime(event.occurredAt)} />)
                      )}
                    </InspectorBlock>
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="logs" className="mt-0 h-full">
              <PayloadBrowser
                kind="log"
                items={props.logs}
                selectedItem={selectedLog}
                payload={props.selectedLogRef === null ? "" : props.payload}
                {...(props.selectedLogRef === null || props.payloadError === undefined ? {} : { payloadError: props.payloadError })}
                loadingPayload={props.selectedLogRef === null ? false : props.loadingPayload}
                emptyTitle="No logs"
                emptyDescription="The Engine has not retained any logs for this unit."
                onSelect={props.onSelectLog}
              />
            </TabsContent>

            <TabsContent value="artifacts" className="mt-0 h-full">
              <PayloadBrowser
                kind="artifact"
                items={props.artifacts}
                selectedItem={selectedArtifact}
                payload={props.selectedArtifactRef === null ? "" : props.payload}
                {...(props.selectedArtifactRef === null || props.payloadError === undefined ? {} : { payloadError: props.payloadError })}
                loadingPayload={props.selectedArtifactRef === null ? false : props.loadingPayload}
                emptyTitle="No artifacts"
                emptyDescription="No artifacts are currently registered for this unit."
                onSelect={props.onSelectArtifact}
              />
            </TabsContent>

            <TabsContent value="attempts" className="mt-0 h-full">
              {props.unit === undefined ? (
                <EmptyState title="No attempts" description="Select a unit to inspect its execution attempts." compact />
              ) : (
                <ScrollArea className="h-full pr-2">
                  <div className="grid gap-3">
                    {props.unit.attempts.length === 0 ? (
                      <EmptyState title="No attempts" description="This unit does not have recorded attempts." compact />
                    ) : (
                      props.unit.attempts.map((attempt) => (
                        <div key={attempt.attemptId} className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-foreground">Attempt {attempt.attemptNumber}</div>
                              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{truncateMiddle(attempt.attemptId, 44)}</div>
                            </div>
                            <StatusBadge status={attempt.status} />
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                            <div>{formatDateTime(attempt.startedAt)} to {formatDateTime(attempt.finishedAt)}</div>
                            <div>Duration {formatDuration(attempt.durationMs)}</div>
                            {attempt.failureMessage === undefined ? null : <div className="text-rose-200">{attempt.failureMessage}</div>}
                            {attempt.cancellationReason === undefined ? null : <div className="text-rose-200">{attempt.cancellationReason}</div>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function MetaStat(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</div>
      <div className="mt-2 text-sm text-foreground">{props.value}</div>
    </div>
  )
}

function InspectorBlock(props: { readonly title: string; readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="rounded-md border border-border/80 bg-[var(--dashboard-panel-strong)] px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">{props.icon}{props.title}</div>
      <div className="grid gap-2">{props.children}</div>
    </div>
  )
}

function ValueRow(props: { readonly label: string; readonly value: string; readonly detail?: string | undefined }) {
  return (
    <div className="grid gap-1 border-b border-border/70 pb-2 last:border-b-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</div>
      <div className="whitespace-pre-wrap break-words font-mono text-[12px] text-zinc-200">{props.value}</div>
      {props.detail === undefined ? null : <div className="text-xs text-muted-foreground">{props.detail}</div>}
    </div>
  )
}

function MutedLine({ children }: { readonly children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>
}
