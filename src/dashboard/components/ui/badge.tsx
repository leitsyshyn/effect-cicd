import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "../../lib/utils.ts"

const badgeVariants = cva("inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "border-border text-foreground",
      success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      failure: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      running: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      skipped: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
