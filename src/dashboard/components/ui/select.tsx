import * as React from "react"

import { cn } from "../../lib/utils.ts"

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive focus-visible:ring-2 focus-visible:ring-ring/60",
      className,
    )}
    {...props}
  />
))

Select.displayName = "Select"

export function SelectItem(props: React.ComponentProps<"option">) {
  return <option {...props} />
}
