/** Formatters shared by the Home panels. All output is short and meant for Geist Mono with tabular numerals. */

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  if (value < 0.01) return "<$0.01"
  if (value < 100) return `$${value.toFixed(2)}`
  return `$${Math.round(value).toLocaleString("en-US")}`
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`
}

/** "42s", "3m 05s", "1h 12m" since `startedAt` (ISO). Empty when unknown. */
export function formatElapsed(startedAt: string | null | undefined, now: number): string {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(start)) return ""
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function formatRelative(iso: string | null | undefined, now: number): string {
  const ts = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(ts)) return ""
  const diff = Math.max(0, now - ts)
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** "14:30" today, "Tue 09:00" within a week, else "Dec 4". */
export function formatUpcoming(iso: string, now: number): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return time
  const tomorrow = new Date(now + 86_400_000)
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`
  if (date.getTime() - now < 7 * 86_400_000) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
