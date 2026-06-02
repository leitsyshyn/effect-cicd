import type { BadgeProps } from "../components/ui/badge.tsx"

const activeStatuses = new Set(["queued", "running", "canceling"])
const retryableStatuses = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"])

export const badgeVariantForStatus = (status: string): BadgeProps["variant"] => {
  if (status === "succeeded") {
    return "success"
  }

  if (status === "failed" || status === "interrupted" || status === "timed_out" || status === "canceled") {
    return "failure"
  }

  if (status === "running" || status === "ready" || status === "queued" || status === "canceling") {
    return "running"
  }

  if (status === "skipped") {
    return "skipped"
  }

  return "secondary"
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
