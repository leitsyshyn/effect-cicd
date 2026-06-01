import { Layer } from "effect"
import * as Context from "effect/Context"

type Labels = Readonly<Record<string, string>>

interface HistogramBucket {
  readonly upperBound: number
  count: number
}

export class Metrics extends Context.Service<
  Metrics,
  {
    readonly incrementCounter: (name: string, labels?: Labels, value?: number) => void
    readonly setGauge: (name: string, labels: Labels | undefined, value: number) => void
    readonly observeHistogram: (name: string, labels: Labels | undefined, value: number, buckets?: ReadonlyArray<number>) => void
    readonly renderPrometheus: () => string
  }
>()("@effect-cicd/runtime/Metrics") {
  static readonly layer = Layer.sync(Metrics, () => {
    const counters = new Map<string, number>()
    const gauges = new Map<string, number>()
    const histograms = new Map<string, { readonly labels: Labels; readonly buckets: Array<HistogramBucket>; sum: number; count: number }>()

    const normalizeLabels = (labels: Labels | undefined) => Object.entries(labels ?? {}).sort(([a], [b]) => a.localeCompare(b))
    const keyOf = (name: string, labels?: Labels) => `${name}|${JSON.stringify(normalizeLabels(labels))}`
    const renderLabels = (labels?: Labels) => {
      const entries = normalizeLabels(labels)
      return entries.length === 0 ? "" : `{${entries.map(([key, value]) => `${key}="${value}"`).join(",")}}`
    }

    const incrementCounter = (name: string, labels?: Labels, value = 1) => {
      const key = keyOf(name, labels)
      counters.set(key, (counters.get(key) ?? 0) + value)
    }

    const setGauge = (name: string, labels: Labels | undefined, value: number) => {
      gauges.set(keyOf(name, labels), value)
    }

    const observeHistogram = (name: string, labels: Labels | undefined, value: number, buckets?: ReadonlyArray<number>) => {
      const key = keyOf(name, labels)
      const resolvedBuckets = [...(buckets ?? [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60])].sort((a, b) => a - b)
      const histogram = histograms.get(key) ?? {
        labels: labels ?? {},
        buckets: resolvedBuckets.map((upperBound) => ({ upperBound, count: 0 })),
        sum: 0,
        count: 0,
      }

      for (const bucket of histogram.buckets) {
        if (value <= bucket.upperBound) {
          bucket.count += 1
        }
      }
      histogram.sum += value
      histogram.count += 1
      histograms.set(key, histogram)
    }

    const renderPrometheus = () => {
      const lines = new Array<string>()

      for (const [key, value] of counters.entries()) {
        const [name = "", labelsJson = "[]"] = key.split("|", 2)
        const labels = Object.fromEntries(JSON.parse(labelsJson) as Array<[string, string]>)
        lines.push(`${name}${renderLabels(labels)} ${value}`)
      }

      for (const [key, value] of gauges.entries()) {
        const [name = "", labelsJson = "[]"] = key.split("|", 2)
        const labels = Object.fromEntries(JSON.parse(labelsJson) as Array<[string, string]>)
        lines.push(`${name}${renderLabels(labels)} ${value}`)
      }

      for (const [key, histogram] of histograms.entries()) {
        const [name = ""] = key.split("|", 1)
        for (const bucket of histogram.buckets) {
          lines.push(`${name}_bucket${renderLabels({ ...histogram.labels, le: String(bucket.upperBound) })} ${bucket.count}`)
        }
        lines.push(`${name}_bucket${renderLabels({ ...histogram.labels, le: "+Inf" })} ${histogram.count}`)
        lines.push(`${name}_sum${renderLabels(histogram.labels)} ${histogram.sum}`)
        lines.push(`${name}_count${renderLabels(histogram.labels)} ${histogram.count}`)
      }

      return lines.join("\n")
    }

    return { incrementCounter, setGauge, observeHistogram, renderPrometheus }
  })
}
