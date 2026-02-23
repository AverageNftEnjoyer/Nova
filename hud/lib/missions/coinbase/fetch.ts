import "server-only"

import crypto from "node:crypto"
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
  portfolio: {
    balances: Array<{
      accountId: string
      accountName: string
      accountType: string
      assetSymbol: string
      available: number
      hold: number
      total: number
    }>
    fetchedAtMs: number
  } | null
  transactions: Array<{
    id: string
    side: "buy" | "sell" | "other"
    assetSymbol: string
    quantity: number
    price: number | null
    fee: number | null
    occurredAtMs: number
    status: string
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

function toBase64Url(input: Buffer | string): string {
  const value = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input, "utf8").toString("base64")
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function normalizePrivateKeyPem(raw: string): string {
  const key = String(raw || "").trim().replace(/\\n/g, "\n").trim()
  if (!key) return ""
  if (key.includes("BEGIN EC PRIVATE KEY") || key.includes("BEGIN PRIVATE KEY")) return key
  return ""
}

function tryConvertSecretStringToPrivateKeyPem(raw: string): string {
  const compact = String(raw || "").trim().replace(/\s+/g, "")
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return ""
  let decoded: Buffer
  try {
    decoded = Buffer.from(compact, "base64")
  } catch {
    return ""
  }
  if (!decoded || decoded.length < 16) return ""
  const attempts: Array<() => crypto.KeyObject> = [
    () => crypto.createPrivateKey({ key: decoded, format: "der", type: "pkcs8" }),
    () => crypto.createPrivateKey({ key: decoded, format: "der", type: "sec1" }),
  ]
  for (const create of attempts) {
    try {
      const keyObj = create()
      return keyObj.export({ format: "pem", type: "pkcs8" }).toString()
    } catch {
      // keep trying
    }
  }
  return ""
}

function buildCoinbaseJwt(params: {
  apiKey: string
  privateKeyPem: string
  method: string
  pathWithQuery: string
  host: string
  nowMs: number
}): string {
  const nbf = Math.floor(params.nowMs / 1000)
  const exp = nbf + 120
  const header = {
    alg: "ES256",
    kid: params.apiKey,
    typ: "JWT",
    nonce: crypto.randomUUID().replace(/-/g, ""),
  }
  const payload = {
    iss: "cdp",
    sub: params.apiKey,
    nbf,
    exp,
    uri: `${params.method.toUpperCase()} ${params.host}${params.pathWithQuery}`,
  }
  const encodedHeader = toBase64Url(JSON.stringify(header))
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = crypto
    .createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({ key: params.privateKeyPem, dsaEncoding: "ieee-p1363" })
  return `${signingInput}.${toBase64Url(signature)}`
}

function decodeHmacSecret(raw: string): Buffer {
  const compact = String(raw || "").trim().replace(/\s+/g, "")
  if (!compact) return Buffer.alloc(0)
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      const decoded = Buffer.from(compact, "base64")
      if (decoded.length > 0) return decoded
    } catch {
      // fallback below
    }
  }
  return Buffer.from(compact, "utf8")
}

function buildHmacHeaders(params: {
  apiKey: string
  apiSecret: string
  method: string
  pathWithQuery: string
  bodyText?: string
}): Record<string, string> {
  const timestamp = (Date.now() / 1000).toFixed(0)
  const prehash = `${timestamp}${params.method.toUpperCase()}${params.pathWithQuery}${String(params.bodyText || "")}`
  const secretBytes = decodeHmacSecret(params.apiSecret)
  const signature = crypto.createHmac("sha256", secretBytes).update(prehash).digest("base64")
  return {
    "CB-ACCESS-KEY": params.apiKey,
    "CB-ACCESS-SIGN": signature,
    "CB-ACCESS-TIMESTAMP": timestamp,
  }
}

function buildCoinbaseAuthHeaders(params: {
  apiKey: string
  apiSecret: string
  method: string
  pathWithQuery: string
  host: string
}): { headers: Record<string, string>; mode: "jwt_bearer" | "hmac_secret" } {
  const normalizedPem = normalizePrivateKeyPem(params.apiSecret)
  const derivedPem = normalizedPem || tryConvertSecretStringToPrivateKeyPem(params.apiSecret)
  if (derivedPem) {
    const token = buildCoinbaseJwt({
      apiKey: params.apiKey,
      privateKeyPem: derivedPem,
      method: params.method,
      pathWithQuery: params.pathWithQuery,
      host: params.host,
      nowMs: Date.now(),
    })
    return {
      headers: { Authorization: `Bearer ${token}` },
      mode: "jwt_bearer",
    }
  }
  return {
    headers: buildHmacHeaders({
      apiKey: params.apiKey,
      apiSecret: params.apiSecret,
      method: params.method,
      pathWithQuery: params.pathWithQuery,
    }),
    mode: "hmac_secret",
  }
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : null
}

function toDateMs(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

async function fetchPrivateCoinbaseJson(params: {
  apiKey: string
  apiSecret: string
  path: string
  query?: Record<string, string | number | undefined>
}): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const host = "api.coinbase.com"
  const url = new URL(`https://${host}${params.path}`)
  for (const [key, value] of Object.entries(params.query || {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  const pathWithQuery = `${url.pathname}${url.search}`
  const auth = buildCoinbaseAuthHeaders({
    apiKey: params.apiKey,
    apiSecret: params.apiSecret,
    method: "GET",
    pathWithQuery,
    host,
  })
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...auth.headers,
      },
      cache: "no-store",
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return {
        ok: false,
        error: `Coinbase private endpoint ${params.path} failed (${response.status}) [auth=${auth.mode}]${detail ? `: ${detail.slice(0, 240)}` : ""}`,
      }
    }
    const payload = await response.json().catch(() => ({}))
    return { ok: true, data: payload }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Coinbase private endpoint request failed.",
    }
  }
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
  let portfolio: CoinbaseMissionResult["portfolio"] = null
  let transactions: CoinbaseMissionResult["transactions"] = []
  let privateError = ""
  if (!config.coinbase.connected) {
    notes.push("Coinbase integration is not connected for this user context.")
  }
  const hasPrivateCreds = config.coinbase.connected && config.coinbase.apiKey.trim().length > 0 && config.coinbase.apiSecret.trim().length > 0
  if (hasPrivateCreds) {
    const [accountsRaw, fillsRaw] = await Promise.all([
      fetchPrivateCoinbaseJson({
        apiKey: config.coinbase.apiKey,
        apiSecret: config.coinbase.apiSecret,
        path: "/api/v3/brokerage/accounts",
      }),
      fetchPrivateCoinbaseJson({
        apiKey: config.coinbase.apiKey,
        apiSecret: config.coinbase.apiSecret,
        path: "/api/v3/brokerage/orders/historical/fills",
        query: { limit: 20 },
      }),
    ])
    if (accountsRaw.ok) {
      const payload = accountsRaw.data as {
        accounts?: Array<{
          uuid?: string
          name?: string
          type?: string
          currency?: string
          available_balance?: { value?: string }
          hold?: { value?: string }
        }>
      }
      const rows = Array.isArray(payload.accounts) ? payload.accounts : []
      portfolio = {
        balances: rows.map((entry) => {
          const available = toFiniteNumber(entry?.available_balance?.value)
          const hold = toFiniteNumber(entry?.hold?.value)
          return {
            accountId: String(entry?.uuid || "").trim(),
            accountName: String(entry?.name || "").trim() || "Coinbase Account",
            accountType: String(entry?.type || "").trim() || "unknown",
            assetSymbol: String(entry?.currency || "").trim().toUpperCase() || "UNKNOWN",
            available,
            hold,
            total: available + hold,
          }
        }),
        fetchedAtMs: Date.now(),
      }
    } else {
      privateError = accountsRaw.error
    }
    if (fillsRaw.ok) {
      const payload = fillsRaw.data as {
        fills?: Array<{
          entry_id?: string
          side?: string
          size?: string
          price?: string
          commission?: string
          trade_time?: string
          product_id?: string
          order_status?: string
        }>
      }
      const fills = Array.isArray(payload.fills) ? payload.fills : []
      transactions = fills.map((fill) => {
        const productId = String(fill?.product_id || "").trim().toUpperCase()
        const assetSymbol = productId.includes("-") ? productId.split("-")[0] : (productId || "UNKNOWN")
        const sideRaw = String(fill?.side || "").trim().toLowerCase()
        const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "other"
        return {
          id: String(fill?.entry_id || "").trim() || `${productId}:${fill?.trade_time || ""}`,
          side,
          assetSymbol,
          quantity: toFiniteNumber(fill?.size),
          price: toNullableNumber(fill?.price),
          fee: toNullableNumber(fill?.commission),
          occurredAtMs: toDateMs(fill?.trade_time),
          status: String(fill?.order_status || "").trim() || "unknown",
        }
      })
    } else if (!privateError) {
      privateError = fillsRaw.error
    }
    if (privateError) {
      notes.push(`Coinbase private account data unavailable: ${privateError}`)
    }
  } else {
    notes.push("Coinbase private account data requires connected API key + private key.")
  }
  if (primitive === "weekly_pnl_summary") {
    if (!portfolio || transactions.length === 0) {
      notes.push("PnL requires portfolio and transaction history; required Coinbase account data was incomplete for this run.")
    }
  }
  if (primitive === "price_alert_digest" && Number.isFinite(Number(input.thresholdPct))) {
    notes.push(`Requested threshold: ${Number(input.thresholdPct).toFixed(2)}%.`)
  }
  const hasPortfolio = Boolean(portfolio)
  const hasTransactions = transactions.length > 0
  const requiresAccountData =
    primitive === "weekly_pnl_summary" || primitive === "daily_portfolio_summary"
  const ok =
    primitive === "weekly_pnl_summary" ? (hasPortfolio && hasTransactions) :
    primitive === "daily_portfolio_summary" ? hasPortfolio :
    prices.length > 0

  return {
    ok,
    source: "coinbase",
    primitive,
    checkedAtMs,
    checkedAtIso,
    quoteCurrency,
    assets,
    prices,
    portfolio,
    transactions,
    integration: {
      connected: config.coinbase.connected,
      lastSyncAt: config.coinbase.lastSyncAt,
      lastSyncStatus: config.coinbase.lastSyncStatus,
      lastSyncErrorCode: config.coinbase.lastSyncErrorCode,
      lastSyncErrorMessage: config.coinbase.lastSyncErrorMessage,
      lastFreshnessMs: config.coinbase.lastFreshnessMs,
    },
    notes,
    error: ok
      ? undefined
      : requiresAccountData
        ? "Coinbase account data (portfolio + transactions) could not be verified for this user context."
        : "Coinbase did not return valid spot prices for requested assets.",
  }
}
