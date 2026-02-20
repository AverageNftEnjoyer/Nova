import "server-only"

import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/server-store"

type CoinbasePrimitive = "daily_portfolio_summary" | "price_alert_digest" | "weekly_pnl_summary"

export interface CoinbaseMissionRequest {
  primitive: CoinbasePrimitive
  assets: string[]
  quoteCurrency: string
  thresholdPct?: number
  cadence?: string
}

export interface CoinbaseMissionResult {
  ok: boolean
  source: "coinbase"
  primitive: CoinbasePrimitive
  checkedAtMs: number
  checkedAtIso: string
  quoteCurrency: string
  assets: string[]
  prices: Array<{
    symbolPair: string
    baseAsset: string
    quoteAsset: string
    price: number
    fetchedAtMs: number
  }>
  integration: {
    connected: boolean
    lastSyncAt: string
    lastSyncStatus: string
    lastSyncErrorCode: string
    lastSyncErrorMessage: string
    lastFreshnessMs: number
  }
  notes: string[]
  error?: string
}

const DEFAULT_ASSETS = ["BTC", "ETH", "SOL"]
const KNOWN_ASSETS = new Set([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BCH", "AVAX", "DOT", "MATIC", "UNI", "LINK", "ATOM",
  "XLM", "ALGO", "TRX", "ETC", "NEAR", "APT", "ARB", "OP", "FIL", "AAVE", "SUI", "SHIB", "USDT", "USDC", "EURC",
])

function normalizeAsset(value: string): string {
  const token = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!token) return ""
  if (KNOWN_ASSETS.has(token)) return token
  return token.slice(0, 10)
}

function normalizeAssets(input: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    const asset = normalizeAsset(value)
    if (!asset || seen.has(asset)) continue
    seen.add(asset)
    out.push(asset)
    if (out.length >= 8) break
  }
  return out.length > 0 ? out : [...DEFAULT_ASSETS]
}

function normalizeQuoteCurrency(value: string): string {
  const token = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!token || token.length < 2 || token.length > 10) return "USD"
  return token
}

export function parseCoinbaseFetchQuery(query: string): Partial<CoinbaseMissionRequest> {
  const text = String(query || "").trim()
  if (!text) return {}
  const pairs = text
    .split(/[&\n;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const kv = new Map<string, string>()
  for (const pair of pairs) {
    const idx = pair.indexOf("=")
    if (idx < 0) continue
    const key = pair.slice(0, idx).trim().toLowerCase()
    const value = pair.slice(idx + 1).trim()
    if (!key) continue
    kv.set(key, value)
  }
  const primitive = String(kv.get("primitive") || "").trim().toLowerCase()
  const assetsRaw = String(kv.get("assets") || kv.get("symbols") || "").trim()
  const quoteCurrency = String(kv.get("quote") || kv.get("currency") || "USD").trim()
  const thresholdPct = Number.parseFloat(String(kv.get("thresholdPct") || kv.get("threshold") || ""))
  const cadence = String(kv.get("cadence") || "").trim().toLowerCase()
  return {
    primitive:
      primitive === "daily_portfolio_summary" || primitive === "price_alert_digest" || primitive === "weekly_pnl_summary"
        ? primitive
        : undefined,
    assets: assetsRaw
      ? assetsRaw.split(/[|,\s]+/).map((item) => item.trim()).filter(Boolean)
      : undefined,
    quoteCurrency,
    thresholdPct: Number.isFinite(thresholdPct) ? thresholdPct : undefined,
    cadence: cadence || undefined,
  }
}

async function fetchSpotPrice(symbolPair: string): Promise<{ ok: true; price: number; fetchedAtMs: number } | { ok: false }> {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbolPair)}/spot`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
  if (!res.ok) return { ok: false }
  const payload = await res.json().catch(() => ({})) as { data?: { amount?: string } }
  const amount = Number.parseFloat(String(payload?.data?.amount || ""))
  if (!Number.isFinite(amount)) return { ok: false }
  return { ok: true, price: amount, fetchedAtMs: Date.now() }
}

export async function fetchCoinbaseMissionData(
  input: Partial<CoinbaseMissionRequest>,
  scope?: IntegrationsStoreScope,
): Promise<CoinbaseMissionResult> {
  const primitive: CoinbasePrimitive =
    input.primitive === "price_alert_digest" || input.primitive === "weekly_pnl_summary"
      ? input.primitive
      : "daily_portfolio_summary"
  const assets = normalizeAssets(Array.isArray(input.assets) ? input.assets : DEFAULT_ASSETS)
  const quoteCurrency = normalizeQuoteCurrency(String(input.quoteCurrency || "USD"))
  const config = await loadIntegrationsConfig(scope)
  const checkedAtMs = Date.now()
  const checkedAtIso = new Date(checkedAtMs).toISOString()

  const prices: CoinbaseMissionResult["prices"] = []
  for (const baseAsset of assets) {
    const symbolPair = `${baseAsset}-${quoteCurrency}`
    try {
      const row = await fetchSpotPrice(symbolPair)
      if (!row.ok) continue
      prices.push({
        symbolPair,
        baseAsset,
        quoteAsset: quoteCurrency,
        price: row.price,
        fetchedAtMs: row.fetchedAtMs,
      })
    } catch {
      // keep collecting other assets
    }
  }

  const notes: string[] = []
  if (!config.coinbase.connected) {
    notes.push("Coinbase integration is not connected for this user context.")
  }
  if (primitive === "weekly_pnl_summary") {
    notes.push("PnL requires portfolio and transaction history. This run includes live spot prices only.")
  }
  if (primitive === "price_alert_digest" && Number.isFinite(Number(input.thresholdPct))) {
    notes.push(`Requested threshold: ${Number(input.thresholdPct).toFixed(2)}%.`)
  }

  return {
    ok: prices.length > 0,
    source: "coinbase",
    primitive,
    checkedAtMs,
    checkedAtIso,
    quoteCurrency,
    assets,
    prices,
    integration: {
      connected: config.coinbase.connected,
      lastSyncAt: config.coinbase.lastSyncAt,
      lastSyncStatus: config.coinbase.lastSyncStatus,
      lastSyncErrorCode: config.coinbase.lastSyncErrorCode,
      lastSyncErrorMessage: config.coinbase.lastSyncErrorMessage,
      lastFreshnessMs: config.coinbase.lastFreshnessMs,
    },
    notes,
    error: prices.length > 0 ? undefined : "Coinbase did not return valid spot prices for requested assets.",
  }
}
