import "server-only"

import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/runtime/agent-sync"
import {
  loadIntegrationsConfig,
  updateIntegrationsConfig,
  type IntegrationsConfig,
} from "@/lib/integrations/store/server-store"
import { normalizePhantomIntegrationConfig } from "@/lib/integrations/phantom/types"
import type { VerifiedSupabaseRequest } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import {
  POLYMARKET_CLOB_API_URL,
  POLYMARKET_DATA_API_URL,
  POLYMARKET_GAMMA_API_URL,
  normalizePolymarketEvmAddress,
  normalizePolymarketEvent,
  normalizePolymarketLeaderboardEntry,
  normalizePolymarketMarket,
  normalizePolymarketTokenPrice,
  normalizePolymarketProfile,
  type PolymarketEvent,
  type PolymarketLeaderboardEntry,
  type PolymarketMarket,
  type PolymarketOrderBook,
  type PolymarketPricePoint,
  type PolymarketTokenPrice,
  type PolymarketPosition,
  type PolymarketProfile,
} from "./api"
import {
  validatePolymarketWalletBinding,
} from "./guards"
import {
  DEFAULT_POLYMARKET_INTEGRATION_CONFIG,
  normalizePolymarketIntegrationConfig,
} from "./types"
import { getGlobalPolymarketLruCache } from "./cache"
import { getGlobalPolymarketClient } from "./client"

const REQUEST_TIMEOUT_MS = 8_000
export type PolymarketHistoryRange = "1h" | "6h" | "1d" | "1w" | "1m" | "all"
export type PolymarketLeaderboardWindow = "day" | "week" | "month" | "all"

const EVENTS_CACHE_TTL_MS = 30_000
const PRICES_CACHE_TTL_MS = 5_000
const LEADERBOARD_CACHE_TTL_MS = 120_000

type GlobalPolymarketServerState = typeof globalThis & {
  __novaPolymarketServerInflight?: Map<string, Promise<unknown>>
}

const globalPolymarketServerState = globalThis as GlobalPolymarketServerState
const polymarketServerCache = getGlobalPolymarketLruCache<unknown>("polymarket-server-cache", { maxEntries: 500 })
const polymarketServerInflight = globalPolymarketServerState.__novaPolymarketServerInflight ?? new Map<string, Promise<unknown>>()
globalPolymarketServerState.__novaPolymarketServerInflight = polymarketServerInflight
const polymarketClient = getGlobalPolymarketClient()

class PolymarketServerError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function assertUserContextId(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) {
    throw new PolymarketServerError("POLYMARKET_USER_REQUIRED", "Authenticated user context is required.", 401)
  }
  return normalized
}

function buildDisconnectedPolymarketConfig(previous: IntegrationsConfig["polymarket"]): IntegrationsConfig["polymarket"] {
  return normalizePolymarketIntegrationConfig({
    ...DEFAULT_POLYMARKET_INTEGRATION_CONFIG,
    lastProfileSyncAt: previous.lastProfileSyncAt,
  })
}

export function assertPolymarketWalletMatchesVerifiedPhantom(params: {
  walletAddress: string
  phantom: ReturnType<typeof normalizePhantomIntegrationConfig>
}): string {
  const validation = validatePolymarketWalletBinding(params)
  if (!validation.ok) {
    throw new PolymarketServerError(validation.code, validation.message, validation.status)
  }
  return validation.walletAddress
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new PolymarketServerError("POLYMARKET_UPSTREAM_FAILED", `Polymarket upstream failed with ${response.status}.`, 502)
    }
    return await response.json().catch(() => ({}))
  } finally {
    clearTimeout(timer)
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function normalizePositiveInt(value: unknown, fallback: number, maxValue: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(maxValue, Math.max(1, parsed))
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(String(value || "").trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function sortPolymarketMarkets(markets: PolymarketMarket[], orderInput: string, ascendingInput?: boolean): PolymarketMarket[] {
  const order = String(orderInput || "").trim().toLowerCase()
  if (!order || markets.length < 2) return markets
  const asc = ascendingInput === true
  const direction = asc ? 1 : -1
  const sorted = [...markets]
  sorted.sort((a, b) => {
    let delta = 0
    if (order === "volume24hr" || order === "volume_24hr" || order === "volume24") {
      delta = a.volume24hr - b.volume24hr
    } else if (order === "volume") {
      delta = a.volume - b.volume
    } else if (order === "liquidity") {
      delta = a.liquidity - b.liquidity
    } else if (order === "createdat" || order === "created_at" || order === "created") {
      delta = toEpochMs(a.createdAt) - toEpochMs(b.createdAt)
    } else if (order === "startdate" || order === "start_date" || order === "start") {
      delta = toEpochMs(a.startDate) - toEpochMs(b.startDate)
    } else if (order === "enddate" || order === "end_date" || order === "end") {
      delta = toEpochMs(a.endDate) - toEpochMs(b.endDate)
    }
    if (delta === 0) {
      delta = a.question.localeCompare(b.question)
    }
    return delta * direction
  })
  return sorted
}

function getCachedValue<T>(key: string): T | null {
  return polymarketServerCache.get(key) as T | null
}

function setCachedValue<T>(key: string, value: T, ttlMs: number): T {
  if (ttlMs > 0) {
    polymarketServerCache.set(key, value, ttlMs)
  }
  return value
}

async function fetchWithCacheDedup<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = getCachedValue<T>(key)
  if (cached !== null) return cached

  const pending = polymarketServerInflight.get(key)
  if (pending) return pending as Promise<T>

  const nextPending = loader()
    .then((value) => setCachedValue(key, value, ttlMs))
    .finally(() => {
      polymarketServerInflight.delete(key)
    })

  polymarketServerInflight.set(key, nextPending as Promise<unknown>)
  return nextPending
}

function normalizeHistoryPoint(raw: unknown): PolymarketPricePoint | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const t = Number(raw[0])
    const p = Number(raw[1])
    if (!Number.isFinite(t) || !Number.isFinite(p)) return null
    const tMs = t > 10_000_000_000 ? t : t * 1000
    return { t: Math.trunc(tMs), p: clamp01(p) }
  }
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const timeCandidate = Number(row.t ?? row.time ?? row.timestamp ?? row.ts)
  const priceCandidate = Number(row.p ?? row.price ?? row.y ?? row.value)
  if (!Number.isFinite(timeCandidate) || !Number.isFinite(priceCandidate)) return null
  const tMs = timeCandidate > 10_000_000_000 ? timeCandidate : timeCandidate * 1000
  return { t: Math.trunc(tMs), p: clamp01(priceCandidate) }
}

function parseHistoryPoints(payload: unknown): PolymarketPricePoint[] {
  const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const candidates: unknown[] = []
  if (Array.isArray(payload)) candidates.push(payload)
  if (Array.isArray(source.history)) candidates.push(source.history)
  if (Array.isArray(source.prices_history)) candidates.push(source.prices_history)
  if (Array.isArray(source.pricesHistory)) candidates.push(source.pricesHistory)
  if (Array.isArray(source.prices)) candidates.push(source.prices)
  if (Array.isArray(source.data)) candidates.push(source.data)

  for (const candidate of candidates) {
    const points = (candidate as unknown[])
      .map((entry) => normalizeHistoryPoint(entry))
      .filter((entry): entry is PolymarketPricePoint => Boolean(entry))
      .sort((a, b) => a.t - b.t)
    if (points.length > 0) return points
  }
  return []
}

function normalizeHistoryRange(value: string): PolymarketHistoryRange {
  const normalized = value.trim().toLowerCase()
  if (normalized === "1h" || normalized === "6h" || normalized === "1d" || normalized === "1w" || normalized === "1m" || normalized === "all") {
    return normalized
  }
  return "1d"
}

const HISTORY_WINDOW_MS: Record<PolymarketHistoryRange, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "all": 365 * 24 * 60 * 60 * 1000,
}

const HISTORY_FIDELITY: Record<PolymarketHistoryRange, string> = {
  "1h": "5",
  "6h": "15",
  "1d": "30",
  "1w": "60",
  "1m": "240",
  "all": "1440",
}

export async function fetchPolymarketPriceHistory(tokenId: string, rangeInput: string): Promise<PolymarketPricePoint[]> {
  const normalizedTokenId = String(tokenId || "").trim()
  if (!normalizedTokenId) {
    throw new PolymarketServerError("POLYMARKET_TOKEN_REQUIRED", "tokenId is required.", 400)
  }

  const range = normalizeHistoryRange(rangeInput)
  const nowMs = Date.now()
  const startMs = nowMs - HISTORY_WINDOW_MS[range]
  const startTs = Math.floor(startMs / 1000)
  const endTs = Math.floor(nowMs / 1000)
  const fidelity = HISTORY_FIDELITY[range]

  const candidateUrls: string[] = []

  const clobWithTimeWindow = new URL(`${POLYMARKET_CLOB_API_URL}/prices-history`)
  clobWithTimeWindow.searchParams.set("market", normalizedTokenId)
  clobWithTimeWindow.searchParams.set("interval", range)
  clobWithTimeWindow.searchParams.set("fidelity", fidelity)
  clobWithTimeWindow.searchParams.set("startTs", String(startTs))
  clobWithTimeWindow.searchParams.set("endTs", String(endTs))
  candidateUrls.push(clobWithTimeWindow.toString())

  const clobBasic = new URL(`${POLYMARKET_CLOB_API_URL}/prices-history`)
  clobBasic.searchParams.set("market", normalizedTokenId)
  clobBasic.searchParams.set("interval", range)
  clobBasic.searchParams.set("fidelity", fidelity)
  candidateUrls.push(clobBasic.toString())

  const dataApi = new URL(`${POLYMARKET_DATA_API_URL}/price-history`)
  dataApi.searchParams.set("market", normalizedTokenId)
  dataApi.searchParams.set("interval", range)
  dataApi.searchParams.set("startTs", String(startTs))
  dataApi.searchParams.set("endTs", String(endTs))
  candidateUrls.push(dataApi.toString())

  for (const url of candidateUrls) {
    try {
      const payload = await fetchJson(url)
      const points = parseHistoryPoints(payload)
      if (points.length > 0) return points
    } catch {
      // Try the next compatible upstream variant.
    }
  }

  throw new PolymarketServerError("POLYMARKET_HISTORY_UNAVAILABLE", "Failed to load market price history.", 502)
}

export async function fetchPolymarketMarkets(params: {
  query?: string
  limit?: number
  tagSlug?: string
  offset?: number
  order?: string
  ascending?: boolean
}): Promise<PolymarketMarket[]> {
  const limit = Math.max(1, Math.min(24, Math.floor(Number(params.limit || 8))))
  const query = String(params.query || "").trim()
  const tagSlug = String(params.tagSlug || "").trim()
  const offsetParsed = Number.parseInt(String(params.offset ?? "").trim(), 10)
  const offset = Number.isFinite(offsetParsed) && offsetParsed > 0 ? Math.min(offsetParsed, 10_000) : 0
  const order = String(params.order || "").trim()
  const ascending = typeof params.ascending === "boolean" ? params.ascending : undefined
  if (query) {
    const searchLimit = Math.min(100, Math.max(limit, limit + offset))
    const searchUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`)
    searchUrl.searchParams.set("q", query)
    searchUrl.searchParams.set("limit", String(searchLimit))
    const payload = await fetchJson(searchUrl.toString()) as { markets?: unknown[] }
    const normalized = (Array.isArray(payload?.markets) ? payload.markets : [])
      .map((entry) => normalizePolymarketMarket(entry))
      .filter((entry): entry is PolymarketMarket => Boolean(entry))
      .filter((entry) => entry.active && !entry.closed)
    const sorted = sortPolymarketMarkets(normalized, order, ascending)
    return sorted.slice(offset, offset + limit)
  }

  const markets = await polymarketClient.getMarkets({
    limit,
    offset: offset + 1,
    active: true,
    closed: false,
    tagSlug,
    order,
    ascending,
  })
  return sortPolymarketMarkets(markets, order, ascending)
}

export async function fetchPolymarketEvents(params: {
  limit?: number
  tagSlug?: string
} = {}): Promise<PolymarketEvent[]> {
  const limit = normalizePositiveInt(params.limit, 20, 100)
  const tagSlug = String(params.tagSlug || "").trim()
  const cacheKey = `events:${tagSlug.toLowerCase()}:${limit}`
  return fetchWithCacheDedup(cacheKey, EVENTS_CACHE_TTL_MS, async () => {
    const url = new URL(`${POLYMARKET_GAMMA_API_URL}/events`)
    url.searchParams.set("limit", String(limit))
    if (tagSlug) {
      url.searchParams.set("tag_slug", tagSlug)
    }
    const payload = await fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown[] } | null | undefined)?.data)
        ? ((payload as { data?: unknown[] }).data ?? [])
        : []
    return rows
      .map((entry) => normalizePolymarketEvent(entry))
      .filter((entry): entry is PolymarketEvent => Boolean(entry))
  })
}

function extractPriceRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return []
  const source = payload as Record<string, unknown>
  if (Array.isArray(source.prices)) return source.prices
  if (Array.isArray(source.data)) return source.data

  const isLikelyTokenId = (value: string): boolean => /^(\d{3,}|0x[a-fA-F0-9]{8,}|[A-Za-z0-9_-]{12,})$/.test(value)
  const rows: unknown[] = []
  for (const [tokenId, value] of Object.entries(source)) {
    const normalizedTokenId = String(tokenId || "").trim()
    if (!isLikelyTokenId(normalizedTokenId)) continue
    if (value && typeof value === "object") {
      rows.push({
        token_id: normalizedTokenId,
        ...(value as Record<string, unknown>),
      })
      continue
    }
    const parsedPrice = Number.parseFloat(String(value ?? ""))
    if (Number.isFinite(parsedPrice)) {
      rows.push({
        token_id: tokenId,
        price: parsedPrice,
      })
    }
  }
  return rows
}

export async function fetchPolymarketPrices(tokenIds: string[]): Promise<PolymarketTokenPrice[]> {
  const normalizedTokenIds = [...new Set(
    (Array.isArray(tokenIds) ? tokenIds : [])
      .map((tokenId) => String(tokenId || "").trim())
      .filter(Boolean),
  )].slice(0, 100)

  if (normalizedTokenIds.length === 0) return []

  const cacheKey = `prices:${normalizedTokenIds.join(",")}`
  return fetchWithCacheDedup(cacheKey, PRICES_CACHE_TTL_MS, async () => {
    const candidateUrls = [
      `${POLYMARKET_CLOB_API_URL}/prices?token_ids=${encodeURIComponent(normalizedTokenIds.join(","))}`,
      `${POLYMARKET_CLOB_API_URL}/prices?tokenIds=${encodeURIComponent(normalizedTokenIds.join(","))}`,
      `${POLYMARKET_CLOB_API_URL}/prices?tokens=${encodeURIComponent(normalizedTokenIds.join(","))}`,
    ]

    for (const url of candidateUrls) {
      try {
        const payload = await fetchJson(url)
        const normalizedRows = extractPriceRows(payload)
          .map((entry) => normalizePolymarketTokenPrice(entry))
          .filter((entry): entry is PolymarketTokenPrice => Boolean(entry))
        if (normalizedRows.length > 0) {
          const deduped = new Map<string, PolymarketTokenPrice>()
          for (const row of normalizedRows) {
            if (!deduped.has(row.tokenId)) deduped.set(row.tokenId, row)
          }
          return [...deduped.values()]
        }
      } catch {
        // Try next compatible endpoint variant.
      }
    }

    const fallbackRows = await Promise.all(
      normalizedTokenIds.map(async (tokenId) => {
        try {
          const payload = await fetchJson(`${POLYMARKET_CLOB_API_URL}/price?token_id=${encodeURIComponent(tokenId)}`)
          return normalizePolymarketTokenPrice({
            token_id: tokenId,
            ...(payload && typeof payload === "object" ? payload as Record<string, unknown> : {}),
          })
        } catch {
          return null
        }
      }),
    )

    const normalizedFallbackRows = fallbackRows.filter((entry): entry is PolymarketTokenPrice => Boolean(entry))
    if (normalizedFallbackRows.length > 0) {
      const deduped = new Map<string, PolymarketTokenPrice>()
      for (const row of normalizedFallbackRows) {
        if (!deduped.has(row.tokenId)) deduped.set(row.tokenId, row)
      }
      return [...deduped.values()]
    }

    throw new PolymarketServerError("POLYMARKET_PRICES_UNAVAILABLE", "Failed to load market prices.", 502)
  })
}

function normalizeLeaderboardWindow(value: unknown): PolymarketLeaderboardWindow {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "day" || normalized === "1d" || normalized === "daily") return "day"
  if (normalized === "week" || normalized === "7d" || normalized === "weekly") return "week"
  if (normalized === "month" || normalized === "30d" || normalized === "monthly") return "month"
  return "all"
}

export async function fetchPolymarketLeaderboard(params: {
  window?: string
  limit?: number
} = {}): Promise<PolymarketLeaderboardEntry[]> {
  const normalizedWindow = normalizeLeaderboardWindow(params.window)
  const limit = normalizePositiveInt(params.limit, 25, 100)
  const cacheKey = `leaderboard:${normalizedWindow}:${limit}`
  return fetchWithCacheDedup(cacheKey, LEADERBOARD_CACHE_TTL_MS, async () => {
    const url = new URL(`${POLYMARKET_DATA_API_URL}/leaderboard`)
    url.searchParams.set("window", normalizedWindow)
    url.searchParams.set("limit", String(limit))
    const payload = await fetchJson(url.toString())
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { leaderboard?: unknown[] } | null | undefined)?.leaderboard)
        ? ((payload as { leaderboard?: unknown[] }).leaderboard ?? [])
        : Array.isArray((payload as { data?: unknown[] } | null | undefined)?.data)
          ? ((payload as { data?: unknown[] }).data ?? [])
          : []
    return rows
      .map((entry, index) => normalizePolymarketLeaderboardEntry(entry, index + 1))
      .filter((entry): entry is PolymarketLeaderboardEntry => Boolean(entry))
      .slice(0, limit)
  })
}

export async function fetchPolymarketMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  const normalizedSlug = String(slug || "").trim()
  if (!normalizedSlug) return null
  return polymarketClient.getMarket(normalizedSlug)
}

export async function fetchPolymarketOrderBook(tokenId: string): Promise<PolymarketOrderBook> {
  const normalizedTokenId = String(tokenId || "").trim()
  if (!normalizedTokenId) {
    throw new PolymarketServerError("POLYMARKET_TOKEN_REQUIRED", "tokenId is required.", 400)
  }
  return polymarketClient.getOrderBook(normalizedTokenId)
}

export async function fetchPolymarketPublicProfile(walletAddress: string): Promise<PolymarketProfile> {
  const normalizedWalletAddress = normalizePolymarketEvmAddress(walletAddress)
  if (!normalizedWalletAddress) {
    throw new PolymarketServerError("POLYMARKET_WALLET_REQUIRED", "A valid wallet address is required.", 400)
  }
  try {
    const payload = await fetchJson(`${POLYMARKET_GAMMA_API_URL}/public-profile?address=${encodeURIComponent(normalizedWalletAddress)}`)
    return normalizePolymarketProfile(payload, normalizedWalletAddress)
  } catch {
    return normalizePolymarketProfile({}, normalizedWalletAddress)
  }
}

export async function fetchPolymarketPositions(address: string): Promise<PolymarketPosition[]> {
  const normalizedAddress = normalizePolymarketEvmAddress(address)
  if (!normalizedAddress) return []
  try {
    return await polymarketClient.getPositions(normalizedAddress)
  } catch {
    return []
  }
}

export async function connectPolymarketIntegration(params: {
  verified: VerifiedSupabaseRequest
  walletAddress: string
  signatureType?: 0 | 1 | 2
  liveTradingEnabled?: boolean
}): Promise<IntegrationsConfig["polymarket"]> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  const current = await loadIntegrationsConfig(params.verified)
  const phantom = normalizePhantomIntegrationConfig(current.phantom)
  const walletAddress = assertPolymarketWalletMatchesVerifiedPhantom({
    walletAddress: params.walletAddress,
    phantom,
  })
  const profile = await fetchPolymarketPublicProfile(walletAddress)
  const now = new Date().toISOString()
  const nextPolymarket = normalizePolymarketIntegrationConfig({
    ...current.polymarket,
    connected: true,
    walletAddress,
    profileAddress: profile.profileAddress || walletAddress,
    username: profile.username,
    pseudonym: profile.pseudonym,
    profileImageUrl: profile.profileImageUrl,
    signatureType: params.signatureType ?? current.polymarket.signatureType ?? 0,
    liveTradingEnabled: params.liveTradingEnabled === true || current.polymarket.liveTradingEnabled === true,
    lastConnectedAt: current.polymarket.lastConnectedAt || now,
    lastProfileSyncAt: now,
  })

  const nextConfig = await updateIntegrationsConfig(
    {
      polymarket: nextPolymarket,
    } as never,
    params.verified,
  )
  await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), userContextId, nextConfig)
  return nextConfig.polymarket
}

export async function updatePolymarketTradingPreference(params: {
  verified: VerifiedSupabaseRequest
  liveTradingEnabled: boolean
}): Promise<IntegrationsConfig["polymarket"]> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  const current = await loadIntegrationsConfig(params.verified)
  const phantom = normalizePhantomIntegrationConfig(current.phantom)
  if (params.liveTradingEnabled) {
    assertPolymarketWalletMatchesVerifiedPhantom({
      walletAddress: current.polymarket.walletAddress,
      phantom,
    })
  }
  const nextConfig = await updateIntegrationsConfig(
    {
      polymarket: normalizePolymarketIntegrationConfig({
        ...current.polymarket,
        liveTradingEnabled: current.polymarket.connected && params.liveTradingEnabled === true,
      }),
    } as never,
    params.verified,
  )
  await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), userContextId, nextConfig)
  return nextConfig.polymarket
}

export async function disconnectPolymarketIntegration(params: {
  verified: VerifiedSupabaseRequest
}): Promise<IntegrationsConfig["polymarket"]> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  const current = await loadIntegrationsConfig(params.verified)
  const nextConfig = await updateIntegrationsConfig(
    {
      polymarket: buildDisconnectedPolymarketConfig(current.polymarket),
    } as never,
    params.verified,
  )
  await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), userContextId, nextConfig)
  return nextConfig.polymarket
}

export function toPolymarketServerError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof PolymarketServerError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }
  return {
    status: 500,
    code: "POLYMARKET_SERVER_FAILED",
    message: error instanceof Error ? error.message : "Polymarket request failed.",
  }
}



