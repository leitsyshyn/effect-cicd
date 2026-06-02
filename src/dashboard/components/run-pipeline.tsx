import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx"
import { ScrollArea } from "./ui/scroll-area.tsx"
import { StatusBadge } from "./status-badge.tsx"
import { StatusDot } from "./status-dot.tsx"
import { formatDuration, truncateMiddle } from "../lib/format.ts"
import type { RunDetailDto } from "../types.ts"

const pipelineStageWidth = 284
const pipelineStageGap = 32
const pipelineStageHeaderHeight = 48
const pipelineUnitHeight = 86
const pipelineUnitGap = 14
const pipelineFramePaddingX = 24
const pipelineFramePaddingY = 24

export function RunPipelineView(props: {
  readonly detail: RunDetailDto
  readonly selectedUnitId?: string | undefined
  readonly onSelectUnit: (unitId: string) => void
}) {
  const positions = new Map<string, { readonly x: number; readonly y: number }>()
  const stageHeights = props.detail.stages.map(
    (stage) => pipelineStageHeaderHeight + Math.max(stage.units.length, 1) * pipelineUnitHeight + Math.max(stage.units.length - 1, 0) * pipelineUnitGap,
  )
  const canvasHeight = Math.max(...stageHeights, 0) + pipelineFramePaddingY * 2
  const canvasWidth = props.detail.stages.length * pipelineStageWidth + Math.max(props.detail.stages.length - 1, 0) * pipelineStageGap + pipelineFramePaddingX * 2

  props.detail.stages.forEach((stage, stageIndex) => {
    stage.units.forEach((unit, unitIndex) => {
      positions.set(unit.unitId, {
        x: pipelineFramePaddingX + stageIndex * (pipelineStageWidth + pipelineStageGap),
        y: pipelineFramePaddingY + pipelineStageHeaderHeight + unitIndex * (pipelineUnitHeight + pipelineUnitGap),
      })
    })
  })

  return (
    <Card className="dashboard-panel overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-[17px]">Execution pipeline</CardTitle>
            <CardDescription>Stage-grouped DAG layout driven by Engine plan structure and current run state.</CardDescription>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{props.detail.dependencies.length} dependencies</div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <ScrollArea className="w-full">
          <div className="relative min-w-max" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
            <svg data-testid="pipeline-deps" className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} fill="none">
              {props.detail.dependencies.map((dependency) => {
                const from = positions.get(dependency.from)
                const to = positions.get(dependency.to)
                if (from === undefined || to === undefined) {
                  return null
                }

                const startX = from.x + pipelineStageWidth - 18
                const startY = from.y + pipelineUnitHeight / 2
                const endX = to.x + 18
                const endY = to.y + pipelineUnitHeight / 2
                const delta = Math.max((endX - startX) / 2, 18)
                const highlighted = props.selectedUnitId === dependency.to || props.selectedUnitId === dependency.from

                return (
                  <path
                    key={`${dependency.from}-${dependency.to}`}
                    d={`M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`}
                    stroke={highlighted ? "rgba(162,204,255,0.85)" : "rgba(174,177,189,0.26)"}
                    strokeWidth={highlighted ? 2.2 : 1.2}
                  />
                )
              })}
            </svg>

            <div className="relative flex gap-8">
              {props.detail.stages.map((stage) => (
                <div key={stage.id} className="dashboard-stage w-[284px] min-w-[284px]">
                  <div className="mb-4 flex items-end justify-between gap-3 border-b border-border/70 pb-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--dashboard-highlight)]">stage {stage.depth + 1}</div>
                      <div className="mt-1 text-sm font-semibold text-zinc-100">{stage.label}</div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{stage.units.length} units</div>
                  </div>

                  <div className="flex flex-col gap-[14px]">
                    {stage.units.map((unit) => (
                      <button
                        key={unit.unitId}
                        type="button"
                        onClick={() => props.onSelectUnit(unit.unitId)}
                        className={[
                          "dashboard-unit-card flex h-[86px] w-full items-start justify-between gap-4 px-4 py-3 text-left transition duration-150",
                          props.selectedUnitId === unit.unitId ? "border-[var(--dashboard-highlight)]/70 bg-[var(--dashboard-panel-strong)] shadow-[inset_0_0_0_1px_rgba(162,204,255,0.18)]" : "hover:border-border hover:bg-[var(--dashboard-panel-strong)]/75",
                        ].join(" ")}
                      >
                        <div className="min-w-0 grid gap-2">
                          <div className="flex items-center gap-2">
                            <StatusDot status={unit.status} />
                            <div className="truncate text-[15px] font-medium text-zinc-100">{unit.name}</div>
                          </div>
                          <div className="font-mono text-[11px] text-zinc-500">{truncateMiddle(unit.unitId, 52)}</div>
                          <div className="truncate text-[11px] uppercase tracking-[0.16em] text-zinc-500">{unit.command ?? "command not retained"}</div>
                        </div>

                        <div className="grid justify-items-end gap-2 text-right">
                          <StatusBadge status={unit.status} />
                          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{formatDuration(unit.durationMs)}</div>
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
