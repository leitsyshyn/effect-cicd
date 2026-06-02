export function InlineError(props: { readonly message: string; readonly compact?: boolean }) {
  return (
    <div
      className={[
        "rounded-md border border-rose-500/30 bg-rose-500/12 text-rose-100",
        props.compact === true ? "px-3 py-2 text-sm" : "px-4 py-3 text-sm",
      ].join(" ")}
    >
      {props.message}
    </div>
  )
}
