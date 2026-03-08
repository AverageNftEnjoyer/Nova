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
  normalizePolymarketMarket,
  normalizePolymarketOrderBook,
  normalizePolymarketPosition,
  normalizePolymarketProfile,
  type PolymarketMarket,
  type PolymarketOrderBook,
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

const REQUEST_TIMEOUT_MS = 8_000

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

export async function fetchPolymarketMarkets(params: {
  query?: string
  limit?: number
  tagSlug?: string
}): Promise<PolymarketMarket[]> {
  const limit = Math.max(1, Math.min(24, Math.floor(Number(params.limit || 8))))
  const query = String(params.query || "").trim()
  if (query) {
    const searchUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/public-search`)
    searchUrl.searchParams.set("q", query)
    const payload = await fetchJson(searchUrl.toString()) as { markets?: unknown[] }
    return (Array.isArray(payload?.markets) ? payload.markets : [])
      .map((entry) => normalizePolymarketMarket(entry))
      .filter((entry): entry is PolymarketMarket => Boolean(entry))
      .filter((entry) => entry.active && !entry.closed)
      .slice(0, limit)
  }

  const marketsUrl = new URL(`${POLYMARKET_GAMMA_API_URL}/markets`)
  marketsUrl.searchParams.set("active", "true")
  marketsUrl.searchParams.set("closed", "false")
  marketsUrl.searchParams.set("limit", String(limit))
  if (params.tagSlug) marketsUrl.searchParams.set("tag_slug", String(params.tagSlug).trim())

  const payload = await fetchJson(marketsUrl.toString())
  return (Array.isArray(payload) ? payload : [])
    .map((entry) => normalizePolymarketMarket(entry))
    .filter((entry): entry is PolymarketMarket => Boolean(entry))
}

export async function fetchPolymarketMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  const normalizedSlug = String(slug || "").trim()
  if (!normalizedSlug) return null
  const url = new URL(`${POLYMARKET_GAMMA_API_URL}/markets`)
  url.searchParams.set("slug", normalizedSlug)
  url.searchParams.set("limit", "1")
  const payload = await fetchJson(url.toString())
  const items = Array.isArray(payload) ? payload : []
  return normalizePolymarketMarket(items[0])
}

export async function fetchPolymarketOrderBook(tokenId: string): Promise<PolymarketOrderBook> {
  const normalizedTokenId = String(tokenId || "").trim()
  if (!normalizedTokenId) {
    throw new PolymarketServerError("POLYMARKET_TOKEN_REQUIRED", "tokenId is required.", 400)
  }
  const payload = await fetchJson(`${POLYMARKET_CLOB_API_URL}/book?token_id=${encodeURIComponent(normalizedTokenId)}`)
  return normalizePolymarketOrderBook(payload, normalizedTokenId)
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
    const url = new URL(`${POLYMARKET_DATA_API_URL}/positions`)
    url.searchParams.set("user", normalizedAddress)
    url.searchParams.set("sizeThreshold", "0.1")
    const payload = await fetchJson(url.toString())
    const rows = Array.isArray(payload) ? payload : Array.isArray((payload as { data?: unknown[] } | null | undefined)?.data)
      ? ((payload as { data?: unknown[] }).data ?? [])
      : []
    return rows
      .map((entry) => normalizePolymarketPosition(entry))
      .filter((entry): entry is PolymarketPosition => Boolean(entry))
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
