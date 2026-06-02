import type { RunDetailDto } from "../types.ts"
import { StatusBadge } from "./status-badge.tsx"
import { StatusDot } from "./status-dot.tsx"
import { Card, CardContent } from "./ui/card.tsx"

const pipelineStageWidth = 260
const pipelineStageGap = 24
const pipelineUnitHeight = 56
const pipelineUnitGap = 12
const pipelineFramePaddingX = 16
const pipelineFramePaddingY = 10
const pipelineCardPadding = 12
const pipelineStageHeaderHeight = 41

export function RunPipelineView(props: {
  readonly detail: RunDetailDto
  readonly selectedUnitId?: string | undefined
  readonly onSelectUnit: (unitId: string) => void
}) {
  const positions = new Map<string, { readonly x: number; readonly y: number }>()
  const stageHeights = props.detail.stages.map(
    (stage) =>
      pipelineStageHeaderHeight +
      Math.max(stage.units.length, 1) * pipelineUnitHeight +
      Math.max(stage.units.length - 1, 0) * pipelineUnitGap +
      pipelineCardPadding * 2,
  )
  const canvasHeight = Math.max(...stageHeights, 0) + pipelineFramePaddingY * 2
  const canvasWidth = props.detail.stages.length * pipelineStageWidth + Math.max(props.detail.stages.length - 1, 0) * pipelineStageGap + pipelineFramePaddingX * 2

  props.detail.stages.forEach((stage, stageIndex) => {
    stage.units.forEach((unit, unitIndex) => {
      positions.set(unit.unitId, {
        x: pipelineFramePaddingX + stageIndex * (pipelineStageWidth + pipelineStageGap),
        y: pipelineFramePaddingY + pipelineCardPadding + pipelineStageHeaderHeight + unitIndex * (pipelineUnitHeight + pipelineUnitGap),
      })
    })
  })

  return (
    <Card>
      <CardContent className="overflow-hidden p-4">
        <div className="w-full overflow-x-auto overflow-y-hidden">
          <div className="min-w-max">
            <div className="relative" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
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
                      stroke={highlighted ? "rgba(148, 163, 184, 0.8)" : "rgba(148, 163, 184, 0.3)"}
                      strokeWidth={highlighted ? 2.2 : 1.2}
                    />
                  )
                })}
              </svg>

              <div className="relative flex items-start gap-6">
                {props.detail.stages.map((stage) => (
                  <div key={stage.id} className="flex w-[260px] min-w-[260px] flex-col rounded-md border bg-card p-3">
                    <div className="mb-3 border-b border-border pb-2">
                      <div className="truncate text-sm font-semibold text-foreground">{stage.label}</div>
                    </div>

                    <div className="flex flex-col gap-3">
                      {stage.units.map((unit) => (
                        <button
                          key={unit.unitId}
                          type="button"
                          onClick={() => props.onSelectUnit(unit.unitId)}
                          className={[
                            "flex h-[56px] w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left transition-colors",
                            props.selectedUnitId === unit.unitId ? "border-ring bg-accent/40" : "hover:bg-accent/30",
                          ].join(" ")}
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <StatusDot status={unit.status} {...(unit.nextRetryAt === undefined ? {} : { nextRetryAt: unit.nextRetryAt })} />
                            <div className="truncate text-sm font-medium text-foreground">{unit.name}</div>
                          </div>
                          <StatusBadge status={unit.status} {...(unit.nextRetryAt === undefined ? {} : { nextRetryAt: unit.nextRetryAt })} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
