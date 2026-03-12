import {
  POLYMARKET_CLOB_API_URL,
  POLYMARKET_DATA_API_URL,
  POLYMARKET_GAMMA_API_URL,
  normalizePolymarketEvent,
  normalizePolymarketLeaderboardEntry,
  normalizePolymarketMarket,
  normalizePolymarketOrderBook,
  normalizePolymarketPosition,
  normalizePolymarketTokenPrice,
  type PolymarketEvent,
  type PolymarketLeaderboardEntry,
  type PolymarketMarket,
  type PolymarketOrderBook,
  type PolymarketPosition,
  type PolymarketPricePoint,
} from "./api"
import { getGlobalPolymarketLruCache } from "./cache"

const REQUEST_TIMEOUT_MS = 10_000
const REQUEST_MAX_RETRIES = 2
const REQUESTS_PER_SECOND = 5

const TTL_MARKETS_MS = 60_000
const TTL_PRICES_MS = 5_000
const TTL_SEARCH_MS = 30_000
const TTL_LEADERBOARD_MS = 120_000

export type PolymarketLeaderboardWindow = "day" | "week" | "month" | "all"

export interface BookParams {
  tokenId?: string
  token_id?: string
  side?: "BUY" | "SELL"
}

export interface EventFilter {
  limit?: number
  offset?: number
  slug?: string
  tag?: string
  active?: boolean
}

export interface MarketFilter {
  limit?: number
  offset?: number
  active?: boolean
  closed?: boolean
  order?: string
  ascending?: boolean
  slug?: string
  tagSlug?: string
}

export interface PriceHistoryParams {
  tokenId: string
  startTs?: number
  endTs?: number
  interval?: string
  fidelity?: string
}

export interface TradeFilter {
  market?: string
  user?: string
  limit?: number
}

export interface PolymarketClientOptions {
  timeoutMs?: number
  retries?: number
  requestsPerSecond?: number
}

class RequestRateLimiter {
  private readonly limit: number
  private readonly windowMs: number
  private readonly timestamps: number[] = []
  private lock: Promise<void> = Promise.resolve()

  constructor(limit: number, windowMs = 1000) {
    this.limit = Math.max(1, Math.floor(limit))
    this.windowMs = Math.max(1, Math.floor(windowMs))
  }

  async waitTurn(): Promise<void> {
    let unlock: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const prev = this.lock
    this.lock = prev.then(() => gate)
    await prev
    try {
      await this.waitForSlot()
    } finally {
      unlock()
    }
  }
  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now()
      while (this.timestamps.length > 0 && now - this.timestamps[0] >= this.windowMs) {
        this.timestamps.shift()
      }
      if (this.timestamps.length < this.limit) {
        this.timestamps.push(now)
        return
      }
      const waitMs = Math.max(10, this.windowMs - (now - this.timestamps[0]) + 1)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

function normalizeWindow(value: string): PolymarketLeaderboardWindow {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "day" || normalized === "1d" || normalized === "daily") return "day"
  if (normalized === "week" || normalized === "7d" || normalized === "weekly") return "week"
  if (normalized === "month" || normalized === "30d" || normalized === "monthly") return "month"
  return "all"
}

function normalizePositiveInt(value: unknown, fallback: number, maxValue: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(maxValue, Math.max(1, parsed))
}

function parsePriceHistoryPoints(payload: unknown): PolymarketPricePoint[] {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const candidates: unknown[] = []
  if (Array.isArray(payload)) candidates.push(payload)
  if (Array.isArray(source.history)) candidates.push(source.history)
  if (Array.isArray(source.prices_history)) candidates.push(source.prices_history)
  if (Array.isArray(source.pricesHistory)) candidates.push(source.pricesHistory)
  if (Array.isArray(source.prices)) candidates.push(source.prices)
  if (Array.isArray(source.data)) candidates.push(source.data)

  const points: PolymarketPricePoint[] = []
  for (const candidate of candidates) {
    for (const row of candidate as unknown[]) {
      if (Array.isArray(row) && row.length >= 2) {
        const t = Number(row[0])
        const p = Number(row[1])
        if (Number.isFinite(t) && Number.isFinite(p)) {
          const tMs = t > 10_000_000_000 ? t : t * 1000
          points.push({ t: Math.trunc(tMs), p: Math.max(0, Math.min(1, p)) })
        }
        continue
      }
      if (!row || typeof row !== "object") continue
      const sourceRow = row as Record<string, unknown>
      const t = Number(sourceRow.t ?? sourceRow.time ?? sourceRow.timestamp ?? sourceRow.ts)
      const p = Number(sourceRow.p ?? sourceRow.price ?? sourceRow.y ?? sourceRow.value)
      if (!Number.isFinite(t) || !Number.isFinite(p)) continue
      const tMs = t > 10_000_000_000 ? t : t * 1000
      points.push({ t: Math.trunc(tMs), p: Math.max(0, Math.min(1, p)) })
    }
    if (points.length > 0) break
  }
  return points.sort((a, b) => a.t - b.t)
}

function tokenIdsFromBooks(tokens: BookParams[]): string[] {
  const rows = Array.isArray(tokens) ? tokens : []
  return [...new Set(rows
    .map((token) => String(token?.tokenId || token?.token_id || "").trim())
    .filter(Boolean))]
}

export class PolymarketClient {
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly rateLimiter: RequestRateLimiter
  private readonly cache = getGlobalPolymarketLruCache<unknown>("polymarket-client-cache", { maxEntries: 500 })

  constructor(options: PolymarketClientOptions = {}) {
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1000, Number(options.timeoutMs)) : REQUEST_TIMEOUT_MS
    this.retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Number(options.retries)) : REQUEST_MAX_RETRIES
    this.rateLimiter = new RequestRateLimiter(
      Number.isFinite(Number(options.requestsPerSecond))
        ? Math.max(1, Number(options.requestsPerSecond))
        : REQUESTS_PER_SECOND,
    )
  }

  private async fetchJson(url: string): Promise<unknown> {
    let lastError: unknown = null
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        await this.rateLimiter.waitTurn()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        try {
          const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          })
          if (!response.ok) {
            throw new Error(`Polymarket upstream ${response.status}`)
          }
          return await response.json()
        } finally {
          clearTimeout(timeout)
        }
      } catch (error) {
        lastError = error
        if (attempt >= this.retries) break
        const delayMs = Math.round(200 * (2 ** attempt) * (1 + Math.random() * 0.25))
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Polymarket request failed.")
  }

  private readCache<T>(key: string): T | null {
    return this.cache.get(key) as T | null
  }

  private writeCache<T>(key: string, value: T, ttlMs: number): T {
    return this.cache.set(key, value, ttlMs) as T
  }

  async searchMarkets(query: string, limit = 8): Promise<PolymarketMarket[]> {
    const normalizedQuery = String(query || "").trim()
    const normalizedLimit = normalizePositiveInt(limit, 8, 24)
    const cacheKey = `search:${normalizedQuery.toLowerCase()}:${normalizedLimit}`
    const cached = this.readCache<PolymarketMarket[]>(cacheKey)
    if (cached) return cached

    const url = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`)
    url.searchParams.set("q", normalizedQuery)
    url.searchParams.set("limit", String(normalizedLimit))
    const payload = await this.fetchJson(url.toString())
    const rows = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).markets)
      ? ((payload as Record<string, unknown>).markets as unknown[])
      : []
    const markets = rows
      .map((row) => normalizePolymarketMarket(row))
      .filter((row): row is PolymarketMarket => Boolean(row))
      .slice(0, normalizedLimit)
    return this.writeCache(cacheKey, markets, TTL_SEARCH_MS)
  }

  async getEvents(params: EventFilter = {}): Promise<PolymarketEvent[]> {
    const limit = normalizePositiveInt(params.limit, 20, 100)
    const tag = String(params.tag || "").trim()
    const slug = String(params.slug || "").trim()
    const offset = normalizePositiveInt(params.offset, 1, 10_000) - 1
    const active = typeof params.active === "boolean" ? params.active : undefined
    const cacheKey = `events:${limit}:${offset}:${tag.toLowerCase()}:${slug.toLowerCase()}:${String(active)}`
    const cached = this.readCache<PolymarketEvent[]>(cacheKey)
    if (cached) return cached

    const url = new URL(`${POLYMARKET_GAMMA_API_URL}/events`)
    url.searchParams.set("limit", String(limit))
    if (offset > 0) url.searchParams.set("offset", String(offset))
    if (tag) url.searchParams.set("tag_slug", tag)
    if (slug) url.searchParams.set("slug", slug)
    if (typeof active === "boolean") url.searchParams.set("active", active ? "true" : "false")
    const payload = await this.fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
        ? ((payload as Record<string, unknown>).data as unknown[])
        : []
    const events = rows
      .map((row) => normalizePolymarketEvent(row))
      .filter((row): row is PolymarketEvent => Boolean(row))
    return this.writeCache(cacheKey, events, TTL_MARKETS_MS)
  }

  async getEvent(id: string): Promise<PolymarketEvent | null> {
    const normalized = String(id || "").trim()
    if (!normalized) return null
    const cacheKey = `event:${normalized}`
    const cached = this.readCache<PolymarketEvent | null>(cacheKey)
    if (cached !== null) return cached
    const payload = await this.fetchJson(`${POLYMARKET_GAMMA_API_URL}/events/${encodeURIComponent(normalized)}`)
    const event = normalizePolymarketEvent(payload)
    return this.writeCache(cacheKey, event, TTL_MARKETS_MS)
  }

  async getMarkets(params: MarketFilter = {}): Promise<PolymarketMarket[]> {
    const limit = normalizePositiveInt(params.limit, 12, 100)
    const offset = normalizePositiveInt(params.offset, 1, 10_000) - 1
    const slug = String(params.slug || "").trim()
    const tagSlug = String(params.tagSlug || "").trim()
    const active = typeof params.active === "boolean" ? params.active : true
    const closed = typeof params.closed === "boolean" ? params.closed : false
    const order = String(params.order || "").trim()
    const ascending = typeof params.ascending === "boolean" ? params.ascending : undefined
    const cacheKey = `markets:${limit}:${offset}:${slug.toLowerCase()}:${tagSlug.toLowerCase()}:${String(active)}:${String(closed)}:${order}:${String(ascending)}`
    const cached = this.readCache<PolymarketMarket[]>(cacheKey)
    if (cached) return cached

    const url = new URL(`${POLYMARKET_GAMMA_API_URL}/markets`)
    url.searchParams.set("limit", String(limit))
    if (offset > 0) url.searchParams.set("offset", String(offset))
    if (slug) url.searchParams.set("slug", slug)
    if (tagSlug) url.searchParams.set("tag_slug", tagSlug)
    if (typeof active === "boolean") url.searchParams.set("active", active ? "true" : "false")
    if (typeof closed === "boolean") url.searchParams.set("closed", closed ? "true" : "false")
    if (order) url.searchParams.set("order", order)
    if (typeof ascending === "boolean") url.searchParams.set("ascending", ascending ? "true" : "false")
    const payload = await this.fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
        ? ((payload as Record<string, unknown>).data as unknown[])
        : []
    const markets = rows
      .map((row) => normalizePolymarketMarket(row))
      .filter((row): row is PolymarketMarket => Boolean(row))
    return this.writeCache(cacheKey, markets, TTL_MARKETS_MS)
  }

  async getMarket(idOrSlug: string): Promise<PolymarketMarket | null> {
    const normalized = String(idOrSlug || "").trim()
    if (!normalized) return null
    const bySlug = await this.getMarkets({ slug: normalized, limit: 1 })
    if (bySlug.length > 0) return bySlug[0]
    const payload = await this.fetchJson(`${POLYMARKET_GAMMA_API_URL}/markets/${encodeURIComponent(normalized)}`)
    return normalizePolymarketMarket(payload)
  }

  async getPrice(tokenId: string, side: "BUY" | "SELL" = "BUY"): Promise<string> {
    const normalizedTokenId = String(tokenId || "").trim()
    if (!normalizedTokenId) return ""
    const cacheKey = `price:${normalizedTokenId}:${side}`
    const cached = this.readCache<string>(cacheKey)
    if (cached !== null) return cached
    const url = `${POLYMARKET_CLOB_API_URL}/price?token_id=${encodeURIComponent(normalizedTokenId)}&side=${encodeURIComponent(side)}`
    const payload = await this.fetchJson(url)
    const priceRow = normalizePolymarketTokenPrice(payload)
    const value = priceRow ? String(priceRow.price) : ""
    return this.writeCache(cacheKey, value, TTL_PRICES_MS)
  }

  async getPrices(tokens: BookParams[]): Promise<Map<string, string>> {
    const tokenIds = tokenIdsFromBooks(tokens).slice(0, 100)
    const result = new Map<string, string>()
    if (tokenIds.length === 0) return result
    const cacheKey = `prices:${tokenIds.join(",")}`
    const cached = this.readCache<Map<string, string>>(cacheKey)
    if (cached) return new Map(cached)

    const url = `${POLYMARKET_CLOB_API_URL}/prices?token_ids=${encodeURIComponent(tokenIds.join(","))}`
    const payload = await this.fetchJson(url)
    const rows = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).prices))
        ? ((payload as Record<string, unknown>).prices as unknown[])
        : []
    for (const row of rows) {
      const normalized = normalizePolymarketTokenPrice(row)
      if (!normalized) continue
      result.set(normalized.tokenId, String(normalized.price))
    }
    const missingTokenIds = tokenIds.filter((tokenId) => !result.has(tokenId))
    if (missingTokenIds.length > 0) {
      const fallbackPrices = await Promise.all(
        missingTokenIds.map(async (tokenId) => {
          const singlePrice = await this.getPrice(tokenId, "BUY")
          return singlePrice ? [tokenId, singlePrice] as const : null
        }),
      )
      for (const row of fallbackPrices) {
        if (!row) continue
        result.set(row[0], row[1])
      }
    }
    this.writeCache(cacheKey, result, TTL_PRICES_MS)
    return result
  }

  async getOrderBook(tokenId: string): Promise<PolymarketOrderBook> {
    const normalizedTokenId = String(tokenId || "").trim()
    const payload = await this.fetchJson(`${POLYMARKET_CLOB_API_URL}/book?token_id=${encodeURIComponent(normalizedTokenId)}`)
    return normalizePolymarketOrderBook(payload, normalizedTokenId)
  }

  async getMidpoint(tokenId: string): Promise<string> {
    const normalizedTokenId = String(tokenId || "").trim()
    if (!normalizedTokenId) return ""
    const payload = await this.fetchJson(`${POLYMARKET_CLOB_API_URL}/midpoint?token_id=${encodeURIComponent(normalizedTokenId)}`)
    const value = payload && typeof payload === "object"
      ? Number((payload as Record<string, unknown>).mid ?? (payload as Record<string, unknown>).midpoint ?? 0)
      : 0
    return Number.isFinite(value) ? String(value) : ""
  }

  async getSpread(tokenId: string): Promise<string> {
    const normalizedTokenId = String(tokenId || "").trim()
    if (!normalizedTokenId) return ""
    const payload = await this.fetchJson(`${POLYMARKET_CLOB_API_URL}/spread?token_id=${encodeURIComponent(normalizedTokenId)}`)
    const value = payload && typeof payload === "object"
      ? Number((payload as Record<string, unknown>).spread ?? 0)
      : 0
    return Number.isFinite(value) ? String(value) : ""
  }

  async getPriceHistory(params: PriceHistoryParams): Promise<PolymarketPricePoint[]> {
    const tokenId = String(params.tokenId || "").trim()
    if (!tokenId) return []
    const url = new URL(`${POLYMARKET_CLOB_API_URL}/prices-history`)
    url.searchParams.set("market", tokenId)
    if (Number.isFinite(params.startTs)) url.searchParams.set("startTs", String(Math.trunc(params.startTs as number)))
    if (Number.isFinite(params.endTs)) url.searchParams.set("endTs", String(Math.trunc(params.endTs as number)))
    if (params.interval) url.searchParams.set("interval", String(params.interval))
    if (params.fidelity) url.searchParams.set("fidelity", String(params.fidelity))
    const payload = await this.fetchJson(url.toString())
    return parsePriceHistoryPoints(payload)
  }

  async getPositions(user: string): Promise<PolymarketPosition[]> {
    const normalizedUser = String(user || "").trim()
    if (!normalizedUser) return []
    const url = new URL(`${POLYMARKET_DATA_API_URL}/positions`)
    url.searchParams.set("user", normalizedUser)
    const payload = await this.fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
        ? ((payload as Record<string, unknown>).data as unknown[])
        : []
    return rows
      .map((row) => normalizePolymarketPosition(row))
      .filter((row): row is PolymarketPosition => Boolean(row))
  }

  async getTrades(params: TradeFilter = {}): Promise<unknown[]> {
    const url = new URL(`${POLYMARKET_DATA_API_URL}/trades`)
    const market = String(params.market || "").trim()
    const user = String(params.user || "").trim()
    const limit = normalizePositiveInt(params.limit, 25, 200)
    if (market) url.searchParams.set("market", market)
    if (user) url.searchParams.set("user", user)
    url.searchParams.set("limit", String(limit))
    const payload = await this.fetchJson(url.toString())
    return Array.isArray(payload)
      ? payload.slice(0, limit)
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
        ? (((payload as Record<string, unknown>).data as unknown[]).slice(0, limit))
        : []
  }

  async getLeaderboard(window: string, limit = 25): Promise<PolymarketLeaderboardEntry[]> {
    const normalizedWindow = normalizeWindow(window)
    const normalizedLimit = normalizePositiveInt(limit, 25, 100)
    const cacheKey = `leaderboard:${normalizedWindow}:${normalizedLimit}`
    const cached = this.readCache<PolymarketLeaderboardEntry[]>(cacheKey)
    if (cached) return cached

    const url = new URL(`${POLYMARKET_DATA_API_URL}/leaderboard`)
    url.searchParams.set("window", normalizedWindow)
    url.searchParams.set("limit", String(normalizedLimit))
    const payload = await this.fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).leaderboard))
        ? ((payload as Record<string, unknown>).leaderboard as unknown[])
        : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data))
          ? ((payload as Record<string, unknown>).data as unknown[])
          : []
    const entries = rows
      .map((row, index) => normalizePolymarketLeaderboardEntry(row, index + 1))
      .filter((row): row is PolymarketLeaderboardEntry => Boolean(row))
      .slice(0, normalizedLimit)
    return this.writeCache(cacheKey, entries, TTL_LEADERBOARD_MS)
  }

  async getOpenInterest(market: string): Promise<number> {
    const normalizedMarket = String(market || "").trim()
    if (!normalizedMarket) return 0
    const url = new URL(`${POLYMARKET_DATA_API_URL}/oi`)
    url.searchParams.set("market", normalizedMarket)
    const payload = await this.fetchJson(url.toString())
    const value = payload && typeof payload === "object"
      ? Number((payload as Record<string, unknown>).oi ?? (payload as Record<string, unknown>).openInterest ?? 0)
      : 0
    return Number.isFinite(value) ? value : 0
  }
}

export function createPolymarketClient(options: PolymarketClientOptions = {}): PolymarketClient {
  return new PolymarketClient(options)
}

type GlobalPolymarketClientState = typeof globalThis & {
  __novaPolymarketClient?: PolymarketClient
}

export function getGlobalPolymarketClient(options: PolymarketClientOptions = {}): PolymarketClient {
  const state = globalThis as GlobalPolymarketClientState
  if (state.__novaPolymarketClient) return state.__novaPolymarketClient
  state.__novaPolymarketClient = new PolymarketClient(options)
  return state.__novaPolymarketClient
}



