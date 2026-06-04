/**
 * Lightweight terminal styling for CLI command output.
 *
 * Styling (color, blank-line spacing, list bullets) is applied only when
 * writing to an interactive terminal. When the output is piped, redirected, or
 * captured in tests, `pretty` is `false` and every helper falls back to the
 * exact plain-text form — so piped output stays stable and grep-friendly.
 *
 * Detection mirrors Effect's own CLI convention (`isTTY` + `NO_COLOR`),
 * with a `FORCE_COLOR` escape hatch for demos and screenshots.
 */
const proc = (globalThis as { process?: typeof process }).process

const forceColor = proc?.env?.FORCE_COLOR !== undefined && proc.env.FORCE_COLOR !== "0"
const noColor = proc?.env?.NO_COLOR !== undefined && proc.env.NO_COLOR !== ""

/** True when output should be styled (interactive terminal, color not disabled). */
export const pretty: boolean = forceColor || (!noColor && proc?.stdout?.isTTY === true)

const ESC = "\x1b["

const wrap = (open: number, close: number) => (text: string): string =>
  pretty ? `${ESC}${open}m${text}${ESC}${close}m` : text

export const bold = wrap(1, 22)
export const dim = wrap(2, 22)
export const red = wrap(31, 39)
export const green = wrap(32, 39)
export const yellow = wrap(33, 39)
export const blue = wrap(34, 39)
export const magenta = wrap(35, 39)
export const cyan = wrap(36, 39)
export const gray = wrap(90, 39)

/** A `key: value` field line. Label is dimmed when styled; text is unchanged when plain. */
export const kv = (key: string, value: string): string => `${gray(`${key}:`)} ${value}`

/** A section header line (e.g. `units:`). Bold + cyan when styled, plain `text:` otherwise. */
export const heading = (text: string): string => bold(cyan(`${text}:`))

/** A list item nested under a section. Indented with a bullet when styled, unchanged when plain. */
export const item = (text: string): string => (pretty ? `  ${dim("•")} ${text}` : text)

/** Spacing between groups: a single blank line when styled, nothing when plain. Spread into arrays. */
export const gap = (): ReadonlyArray<string> => (pretty ? [""] : [])

/** Placeholder for an empty section/value. */
export const none = (): string => dim("—")

/** A success confirmation line, prefixed with a green check when styled. */
export const success = (text: string): string => (pretty ? `${green("✓")} ${text}` : text)

/** Color a status token by its meaning. Text is unchanged when plain. */
export const status = (value: string): string => {
  switch (value) {
    case "succeeded":
    case "completed":
    case "stored":
    case "deleted":
    case "ready":
    case "true":
      return green(value)
    case "failed":
    case "rejected":
    case "error":
      return red(value)
    case "running":
    case "pending":
    case "queued":
    case "in_progress":
    case "scheduled":
      return yellow(value)
    case "canceled":
    case "cancelled":
    case "skipped":
    case "false":
      return gray(value)
    default:
      return value
  }
}
