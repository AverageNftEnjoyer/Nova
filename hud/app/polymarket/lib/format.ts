import type { PolymarketMarket, PolymarketOutcome } from "@/lib/integrations/polymarket/api"

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/** Whole-dollar amounts above $100, cents below; zero and invalid read as "$0". */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value)
}

/** Compact volume: $1.2M, $48.3k. */
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value)
}

/** Share price in cents ("63c"); an en dash when there is no price. */
export function formatCents(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "–"
  return `${Math.round(value * 100)}c`
}

export function formatPreciseCents(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1).replace(/\.0$/, "")}c`
}

export function formatSignedPct(value: number): string {
  if (!Number.isFinite(value)) return "0.0%"
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`
}

export function formatSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(2)
}

export function formatAddress(value: string, empty = "Not connected"): string {
  const normalized = String(value || "").trim()
  if (!normalized) return empty
  if (normalized.length <= 12) return normalized
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

export function formatDate(value: string): string {
  const ms = Date.parse(String(value || "").trim())
  if (!Number.isFinite(ms)) return ""
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function outcomePrice(outcome: PolymarketOutcome | undefined | null): number {
  if (!outcome) return 0
  return outcome.price || outcome.lastTradePrice || 0
}

export function marketYesPrice(market: PolymarketMarket): number {
  return outcomePrice(market.outcomes[0])
}
