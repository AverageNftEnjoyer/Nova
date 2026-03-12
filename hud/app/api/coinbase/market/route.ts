import { NextResponse } from "next/server"

import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "SUI-USD", "XRP-USD", "DOGE-USD"] as const
const MAX_TICKERS = 8
const REQUEST_TIMEOUT_MS = 8_000
type MarketRange = "1h" | "1d" | "7d"
const DEFAULT_RANGE: MarketRange = "1d"
const RANGE_CONFIG: Record<MarketRange, { windowMs: number; granularitySeconds: number }> = {
  "1h": { windowMs: 60 * 60 * 1_000, granularitySeconds: 300 },
  "1d": { windowMs: 24 * 60 * 60 * 1_000, granularitySeconds: 3_600 },
  "7d": { windowMs: 7 * 24 * 60 * 60 * 1_000, granularitySeconds: 21_600 },
}
const CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(String(process.env.NOVA_COINBASE_MARKET_CACHE_TTL_MS || "").trim(), 10)
  if (!Number.isFinite(parsed)) return 45_000
  return Math.max(0, Math.min(300_000, parsed))
})()

type CoinbaseStatsPayload = {
  open?: string
  last?: string
}

type CandleTuple = [number, number, number, number, number, number]

type MarketAsset = {
  ticker: string
  symbol: string
  price: number
  changePct: number
  chart: number[]
}

type CachedAssetEntry = {
  asset: MarketAsset
  expiresAt: number
}

type GlobalCoinbaseMarketState = typeof globalThis & {
  __novaCoinbaseMarketAssetCache?: Map<string, CachedAssetEntry>
  __novaCoinbaseMarketInflight?: Map<string, Promise<MarketAsset>>
}

const globalMarketState = globalThis as GlobalCoinbaseMarketState
const marketAssetCache = globalMarketState.__novaCoinbaseMarketAssetCache ?? new Map<string, CachedAssetEntry>()
const marketInflight = globalMarketState.__novaCoinbaseMarketInflight ?? new Map<string, Promise<MarketAsset>>()
globalMarketState.__novaCoinbaseMarketAssetCache = marketAssetCache
globalMarketState.__novaCoinbaseMarketInflight = marketInflight

function toNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeTicker(value: string): string {
  const raw = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")
  const valid = /^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/.test(raw)
  return valid ? raw : ""
}

function parseTickers(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_TICKERS]
  const unique = new Set<string>()
  for (const token of String(raw).split(/[,\s]+/)) {
    const ticker = normalizeTicker(token)
    if (!ticker) continue
    unique.add(ticker)
    if (unique.size >= MAX_TICKERS) break
  }
  if (unique.size === 0) return [...DEFAULT_TICKERS]
  return [...unique]
}

function parseRange(raw: string | null): MarketRange {
  if (raw === "1h" || raw === "7d") return raw
  return DEFAULT_RANGE
}

function buildCacheKey(ticker: string, range: MarketRange): string {
  return `${ticker}:${range}`
}

function getCachedAsset(cacheKey: string): MarketAsset | null {
  if (CACHE_TTL_MS <= 0) return null
  const cached = marketAssetCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    marketAssetCache.delete(cacheKey)
    return null
  }
  return cached.asset
}

function setCachedAsset(cacheKey: string, asset: MarketAsset): void {
  if (CACHE_TTL_MS <= 0) return
  marketAssetCache.set(cacheKey, {
    asset,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

function buildCandlesUrl(ticker: string, range: MarketRange): string {
  const cfg = RANGE_CONFIG[range]
  const end = new Date()
  const start = new Date(end.getTime() - cfg.windowMs)
  const params = new URLSearchParams({
    granularity: String(cfg.granularitySeconds),
    start: start.toISOString(),
    end: end.toISOString(),
  })
  return `https://api.exchange.coinbase.com/products/${encodeURIComponent(ticker)}/candles?${params.toString()}`
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Upstream ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchSpotFallback(ticker: string): Promise<number> {
  const payload = (await fetchJson(`https://api.coinbase.com/v2/prices/${encodeURIComponent(ticker)}/spot`)) as {
    data?: { amount?: string }
  }
  return toNumber(payload?.data?.amount)
}

function buildChartFromCandles(candles: unknown): number[] {
  if (!Array.isArray(candles)) return []
  const parsed: Array<{ ts: number; close: number }> = []
  for (const row of candles as unknown[]) {
    if (!Array.isArray(row) || row.length < 5) continue
    const tuple = row as CandleTuple
    const ts = toNumber(tuple[0])
    const close = toNumber(tuple[4])
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue
    parsed.push({ ts, close })
  }
  parsed.sort((a, b) => a.ts - b.ts)
  return parsed.map((item) => item.close)
}

async function fetchMarketAsset(ticker: string, range: MarketRange): Promise<MarketAsset> {
  const [statsPayload, candlesPayload] = await Promise.all([
    fetchJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(ticker)}/stats`),
    fetchJson(buildCandlesUrl(ticker, range)),
  ])

  const stats = (statsPayload ?? {}) as CoinbaseStatsPayload
  let price = toNumber(stats.last)
  if (!Number.isFinite(price) || price <= 0) {
    price = await fetchSpotFallback(ticker)
  }
  const chart = buildChartFromCandles(candlesPayload)
  if ((!Number.isFinite(price) || price <= 0) && chart.length > 0) {
    price = chart[chart.length - 1]
  }
  const chartStart = chart.length > 1 ? chart[0] : 0
  const chartEnd = chart.length > 0 ? chart[chart.length - 1] : price
  const baseline = chartStart > 0 ? chartStart : toNumber(stats.open)
  const end = Number.isFinite(price) && price > 0 ? price : chartEnd
  const changePct = baseline > 0 && end > 0 ? ((end - baseline) / baseline) * 100 : 0
  const symbol = ticker.split("-")[0] || ticker

  return {
    ticker,
    symbol,
    price,
    changePct,
    chart: chart.length > 0 ? chart : [price],
  }
}

async function fetchMarketAssetCached(ticker: string, range: MarketRange): Promise<MarketAsset> {
  const cacheKey = buildCacheKey(ticker, range)
  const cached = getCachedAsset(cacheKey)
  if (cached) return cached
  const inflight = marketInflight.get(cacheKey)
  if (inflight) return inflight

  const pending = fetchMarketAsset(ticker, range)
    .then((asset) => {
      setCachedAsset(cacheKey, asset)
      return asset
    })
    .finally(() => {
      marketInflight.delete(cacheKey)
    })

  marketInflight.set(cacheKey, pending)
  return pending
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.coinbaseMarketRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const url = new URL(req.url)
  const tickers = parseTickers(url.searchParams.get("tickers"))
  const range = parseRange(url.searchParams.get("range"))
  const results = await Promise.allSettled(tickers.map((ticker) => fetchMarketAssetCached(ticker, range)))

  const assets: MarketAsset[] = []
  const failed: string[] = []
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (result.status === "fulfilled") {
      assets.push(result.value)
    } else {
      failed.push(tickers[i])
    }
  }

  if (assets.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Coinbase market feed unavailable.", failed },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    range,
    assets,
    failed,
    fetchedAt: new Date().toISOString(),
  })
}
