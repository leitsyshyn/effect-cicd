import { Cause, Effect, Layer, Logger } from "effect"

const levelOrder: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export const structuredLoggerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const configuredLevel = normalizeLevel(process.env.LOG_LEVEL ?? "info")
    const configuredThreshold = levelOrder[configuredLevel] ?? 20

    const logger = Logger.make<unknown, void>(({ message, logLevel, cause, date }) => {
      const level = normalizeLevel(logLevel)
      if ((levelOrder[level] ?? 20) < configuredThreshold) {
        return
      }

      const payload: Record<string, unknown> = {
        timestamp: date.toISOString(),
        level,
        message: typeof message === "string" ? message : JSON.stringify(message),
      }

      const module = extractField(message, "module")
      const runId = extractField(message, "runId")
      const unitId = extractField(message, "unitId")
      if (typeof module === "string") payload.module = module
      if (typeof runId === "string") payload.runId = runId
      if (typeof unitId === "string") payload.unitId = unitId
      if (String(cause) !== "{") {
        payload.error = Cause.pretty(cause)
      }

      console.log(JSON.stringify(payload))
    })

    return Logger.layer([logger])
  }),
)

export const logInfo = (message: string, fields?: Readonly<Record<string, unknown>>) =>
  Effect.logInfo(fields === undefined ? message : { ...fields, message })

export const logWarning = (message: string, fields?: Readonly<Record<string, unknown>>) =>
  Effect.logWarning(fields === undefined ? message : { ...fields, message })

export const logError = (message: string, fields?: Readonly<Record<string, unknown>>) =>
  Effect.logError(fields === undefined ? message : { ...fields, message })

const normalizeLevel = (level: unknown) => {
  const normalized = String(level).toLowerCase()

  switch (normalized) {
    case "debug":
    case "info":
    case "warning":
    case "error":
    case "fatal":
      return normalized === "warning" ? "warn" : normalized === "fatal" ? "error" : normalized
    default:
      return "info"
  }
}

const extractField = (message: unknown, field: string) =>
  typeof message === "object" && message !== null && field in message ? (message as Record<string, unknown>)[field] : undefined
