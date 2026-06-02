import { AlertCircle } from "lucide-react"

export function EmptyState(props: { readonly title: string; readonly description: string; readonly compact?: boolean }) {
  return (
    <div
      className={[
        "dashboard-panel flex flex-col items-center justify-center gap-2 border-dashed text-center",
        props.compact === true ? "min-h-[160px] px-4 py-6" : "min-h-[280px] px-6 py-10",
      ].join(" ")}
    >
      <AlertCircle className="size-4 text-muted-foreground" />
      <div className="text-sm font-medium text-foreground">{props.title}</div>
      <div className="max-w-[36rem] text-sm text-muted-foreground">{props.description}</div>
    </div>
  )
}
