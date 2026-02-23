import type { IntegrationsSettings } from "@/lib/integrations/client-store"

export const COINBASE_TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "UTC", label: "UTC" },
]

export const COINBASE_CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
  { value: "JPY", label: "JPY" },
]

export const COINBASE_CADENCE_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
]

export const COINBASE_ERROR_COPY: Record<string, string> = {
  expired_token: "Coinbase token expired. Reconnect Coinbase credentials.",
  permission_denied: "Coinbase permission denied. Check key permissions/scopes.",
  rate_limited: "Coinbase rate limit reached. Retry after a short cooldown.",
  coinbase_outage: "Coinbase service outage detected. Retry when upstream recovers.",
  network: "Network error while calling Coinbase. Verify connectivity and retry.",
  unknown: "Coinbase sync failed with an unknown error. Retry and review logs.",
  none: "",
}

export type CoinbasePersistedSnapshot = {
  reportTimezone: string
  reportCurrency: string
  reportCadence: "daily" | "weekly"
  requiredScopes: string[]
}

export type CoinbasePendingAction = "sync" | "toggle" | "save"

export type CoinbasePrivacySettings = {
  showBalances: boolean
  showTransactions: boolean
  requireTransactionConsent: boolean
  transactionHistoryConsentGranted: boolean
}

export const DEFAULT_COINBASE_PRIVACY: CoinbasePrivacySettings = {
  showBalances: true,
  showTransactions: true,
  requireTransactionConsent: true,
  transactionHistoryConsentGranted: false,
}

export function formatIsoTimestamp(iso: string): string {
  if (!iso) return "Never"
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms))
}

export function formatFreshnessMs(value: number): string {
  const ms = Math.max(0, Math.floor(Number(value || 0)))
  if (ms <= 0) return "Unknown"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h`
  const totalDays = Math.floor(totalHours / 24)
  return `${totalDays}d`
}

function normalizeScopes(scopes: string[]): string[] {
  return scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean)
}

export function makeCoinbaseSnapshot(coinbase: IntegrationsSettings["coinbase"]): CoinbasePersistedSnapshot {
  return {
    reportTimezone: String(coinbase.reportTimezone || "").trim(),
    reportCurrency: String(coinbase.reportCurrency || "").trim().toUpperCase(),
    reportCadence: coinbase.reportCadence === "weekly" ? "weekly" : "daily",
    requiredScopes: normalizeScopes(Array.isArray(coinbase.requiredScopes) ? coinbase.requiredScopes : []),
  }
}

export function coinbaseSnapshotsEqual(a: CoinbasePersistedSnapshot, b: CoinbasePersistedSnapshot): boolean {
  return (
    a.reportTimezone === b.reportTimezone &&
    a.reportCurrency === b.reportCurrency &&
    a.reportCadence === b.reportCadence &&
    a.requiredScopes.join(",") === b.requiredScopes.join(",")
  )
}

export function normalizeCoinbasePrivacy(raw: unknown): CoinbasePrivacySettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    showBalances: typeof value.showBalances === "boolean" ? value.showBalances : DEFAULT_COINBASE_PRIVACY.showBalances,
    showTransactions:
      typeof value.showTransactions === "boolean" ? value.showTransactions : DEFAULT_COINBASE_PRIVACY.showTransactions,
    requireTransactionConsent:
      typeof value.requireTransactionConsent === "boolean"
        ? value.requireTransactionConsent
        : DEFAULT_COINBASE_PRIVACY.requireTransactionConsent,
    transactionHistoryConsentGranted:
      typeof value.transactionHistoryConsentGranted === "boolean"
        ? value.transactionHistoryConsentGranted
        : DEFAULT_COINBASE_PRIVACY.transactionHistoryConsentGranted,
  }
}
