import { Slot } from "@radix-ui/react-slot"
import { ChevronRight } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.ts"

export function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" {...props} />
}

export function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol className={cn("flex flex-wrap items-center gap-2 text-sm text-muted-foreground", className)} {...props} />
}

export function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("inline-flex items-center gap-2", className)} {...props} />
}

export function BreadcrumbLink({ asChild = false, className, ...props }: React.ComponentProps<"a"> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : "a"
  return <Comp className={cn("transition-colors hover:text-foreground", className)} {...props} />
}

export function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return <span aria-current="page" className={cn("text-foreground", className)} {...props} />
}

export function BreadcrumbSeparator({ className, children, ...props }: React.ComponentProps<"li">) {
  return (
    <li aria-hidden="true" className={cn("text-muted-foreground", className)} {...props}>
      {children ?? <ChevronRight className="size-3.5" />}
    </li>
  )
}
