import type { SourceLocationDto } from "../types.ts"

export const formatDateTime = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return "-"
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}

export const formatDuration = (value: number | undefined) => {
  if (value === undefined) {
    return "-"
  }

  if (value < 1_000) {
    return `${value}ms`
  }

  if (value < 60_000) {
    return `${(value / 1_000).toFixed(1)}s`
  }

  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

export const formatBytes = (value: number | undefined) => {
  if (value === undefined) {
    return "-"
  }

  if (value < 1_024) {
    return `${value} B`
  }

  if (value < 1_048_576) {
    return `${(value / 1_024).toFixed(1)} KB`
  }

  return `${(value / 1_048_576).toFixed(1)} MB`
}

export const formatAge = (value: number | undefined) => {
  if (value === undefined) {
    return "-"
  }

  if (value < 60_000) {
    return `${Math.round(value / 1_000)}s ago`
  }

  if (value < 3_600_000) {
    return `${Math.round(value / 60_000)}m ago`
  }

  return `${Math.round(value / 3_600_000)}h ago`
}

export const truncateMiddle = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value
  }

  const visible = Math.max(maxLength - 3, 2)
  const start = Math.ceil(visible / 2)
  const end = Math.floor(visible / 2)
  return `${value.slice(0, start)}...${value.slice(value.length - end)}`
}

export const formatValue = (value: unknown) => {
  if (value === undefined) {
    return "-"
  }

  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const formatSourceLocation = (source: SourceLocationDto | undefined) => {
  if (source === undefined) {
    return "No source metadata"
  }

  const location = [source.file, source.line === undefined ? undefined : `${source.line}:${source.column ?? 1}`]
    .filter((segment): segment is string => segment !== undefined)
    .join(":")

  if (source.origin !== undefined && location.length > 0) {
    return `${source.origin} (${location})`
  }

  return source.origin ?? (location || "No source metadata")
}
