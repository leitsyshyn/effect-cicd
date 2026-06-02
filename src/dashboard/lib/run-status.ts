import type { BadgeProps } from "../components/ui/badge.tsx"

const activeStatuses = new Set(["queued", "running", "canceling"])
const retryableStatuses = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"])

export const badgeVariantForStatus = (status: string): BadgeProps["variant"] => {
  if (status === "succeeded") {
    return "secondary"
  }

  if (status === "failed" || status === "interrupted" || status === "timed_out" || status === "canceled") {
    return "destructive"
  }

  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") {
    return "secondary"
  }

  if (status === "skipped") {
    return "outline"
  }

  return "secondary"
}

export const badgeClassNameForStatus = (status: string) => {
  if (status === "succeeded") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }

  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
  }

  if (status === "skipped") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  }

  return undefined
}

export const dotClassForStatus = (status: string) => {
  if (status === "succeeded") {
    return "bg-emerald-400"
  }

  if (status === "failed" || status === "interrupted" || status === "timed_out" || status === "canceled") {
    return "bg-rose-400"
  }

  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") {
    return "bg-sky-400"
  }

  if (status === "skipped") {
    return "bg-amber-400"
  }

  return "bg-zinc-500"
}

export const isCancelableStatus = (status: string) => activeStatuses.has(status)

export const isRetryableStatus = (status: string) => retryableStatuses.has(status)
