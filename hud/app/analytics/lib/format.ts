/** Display formatters for the analytics page (LLM costs are tiny, so precision scales with the amount). */

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  grok: "Grok",
}

export function providerLabel(provider: string): string {
  if (!provider) return "Unknown"
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Parses a YYYY-MM-DD local day key as LOCAL midnight (new Date("YYYY-MM-DD") would be UTC). */
function parseDayKey(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function formatDayShort(value: unknown): string {
  const date = parseDayKey(value)
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(value)
}

export function formatDayLong(value: unknown): string {
  const date = parseDayKey(value)
  return date ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : String(value)
}

/** Currency with enough precision for tiny LLM costs: under $0.01 shows 4 decimals. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs === 0) return "$0.00"
  if (abs < 0.0001) return `${sign}<$0.0001`
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Axis ticks: recharts picks steps like 0.025, which two decimals would show as a repeated "$0.03". */
export function formatUsdTick(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0 || abs >= 1) return formatUsd(value)
  const sign = value < 0 ? "-" : ""
  const fixed = abs < 0.01 ? abs.toFixed(4) : abs.toFixed(3)
  return `${sign}$${fixed.replace(/0+$/, "").replace(/\.(\d)$/, ".$10")}`
}

/** Compact token counts: 950, 12.3k, 1.2M, 3.4B. */
export function formatTokens(value: number): string {
  const abs = Math.abs(value)
  const compact = (n: number, suffix: string) => `${Number(n.toFixed(1))}${suffix}`
  if (abs >= 1e9) return compact(value / 1e9, "B")
  if (abs >= 1e6) return compact(value / 1e6, "M")
  if (abs >= 1e3) return compact(value / 1e3, "k")
  return String(Math.round(value))
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.1 ? 1 : 0)}%`
}

export function formatCount(value: number): string {
  return value.toLocaleString()
}

export function formatRelative(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
}
