/**
 * Data Node Executors
 */

import "server-only"

import type { WebSearchNode, HttpRequestNode, RssFeedNode, CoinbaseNode, PolymarketDataFetchNode, NodeOutput, ExecutionContext } from "../../types/index"
import { searchWebAndCollect } from "../../web/search"
import { executeCoinbaseNode } from "../coinbase-step"
import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../../web/safe-fetch"
import { formatCoinbasePriceAlertTextFromObject } from "../../output/contract"
import {
  fetchPolymarketEvents,
  fetchPolymarketLeaderboard,
  fetchPolymarketMarketBySlug,
  fetchPolymarketMarkets,
  fetchPolymarketPrices,
} from "@/lib/integrations/polymarket/server"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const WORKFLOW_HTTP_TIMEOUT_MS = readIntEnv("NOVA_WORKFLOW_HTTP_TIMEOUT_MS", 15_000, 1_000, 120_000)
const WORKFLOW_HTTP_MAX_REDIRECTS = readIntEnv("NOVA_WORKFLOW_HTTP_MAX_REDIRECTS", 3, 0, 8)
const WORKFLOW_HTTP_RESPONSE_MAX_BYTES = readIntEnv("NOVA_WORKFLOW_HTTP_RESPONSE_MAX_BYTES", 2_000_000, 4_096, 20_000_000)
const WORKFLOW_RSS_RESPONSE_MAX_BYTES = readIntEnv("NOVA_WORKFLOW_RSS_RESPONSE_MAX_BYTES", 1_000_000, 4_096, 20_000_000)

function normalizePolymarketLeaderboardWindow(value: unknown): "day" | "week" | "month" | "all" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "day" || normalized === "daily" || normalized === "1d") return "day"
  if (normalized === "week" || normalized === "weekly" || normalized === "7d") return "week"
  if (normalized === "month" || normalized === "monthly" || normalized === "30d") return "month"
  return "all"
}

function toClampedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function toCompactPolymarketPriceText(tokenId: string, price: number): string {
  const safeToken = String(tokenId || "").trim()
  const pct = Number.isFinite(price) ? (price * 100).toFixed(1) : "0.0"
  return `${safeToken || "token"}: ${pct}%`
}

// --- Web Search ---------------------------------------------------------------

export async function executeWebSearch(
  node: WebSearchNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const query = ctx.resolveExpr(node.query)
  if (!query.trim()) {
    return { ok: false, error: "Web search query is empty." }
  }

  try {
    const result = await searchWebAndCollect(query, {}, ctx.scope)
    const text = result.searchText || result.results?.map((r) => `${r.title}: ${r.snippet}`).join("\n") || ""
    return {
      ok: true,
      text,
      data: result,
      items: result.results,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// --- HTTP Request -------------------------------------------------------------

export async function executeHttpRequest(
  node: HttpRequestNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const url = ctx.resolveExpr(node.url)
  if (!url.trim()) {
    return { ok: false, error: "HTTP request URL is empty." }
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(node.headers || {}) }
    if (node.authentication === "bearer" && node.authToken) {
      headers["Authorization"] = `Bearer ${ctx.resolveExpr(node.authToken)}`
    }

    const body = node.body ? ctx.resolveExpr(node.body) : undefined
    const method = String(node.method || "GET").trim().toUpperCase()
    const { response } = await fetchWithSsrfGuard({
      url,
      timeoutMs: WORKFLOW_HTTP_TIMEOUT_MS,
      maxRedirects: WORKFLOW_HTTP_MAX_REDIRECTS,
      init: {
        method,
        headers,
        body: body && method !== "GET" ? body : undefined,
      },
    })

    const responseText = await readResponseTextWithLimit(response, WORKFLOW_HTTP_RESPONSE_MAX_BYTES)
    let data: unknown = responseText
    if (node.responseFormat === "json") {
      try { data = JSON.parse(responseText) } catch { data = responseText }
    }
    // Don't propagate error body as text - error pages/HTML should not flow to downstream nodes
    return {
      ok: response.ok,
      text: response.ok ? (typeof data === "string" ? data : JSON.stringify(data)) : "",
      data: response.ok ? data : undefined,
      ...(response.ok ? {} : { error: `HTTP ${response.status}`, errorCode: `HTTP_${response.status}` }),
    }
  } catch (err) {
    return { ok: false, error: String(err), errorCode: "FETCH_ERROR" }
  }
}

// --- RSS Feed ----------------------------------------------------------------

export async function executeRssFeed(
  node: RssFeedNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const url = ctx.resolveExpr(node.url)
  if (!url.trim()) {
    return { ok: false, error: "RSS feed URL is empty." }
  }

  try {
    const { response } = await fetchWithSsrfGuard({
      url,
      timeoutMs: WORKFLOW_HTTP_TIMEOUT_MS,
      maxRedirects: WORKFLOW_HTTP_MAX_REDIRECTS,
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const xmlText = await readResponseTextWithLimit(response, WORKFLOW_RSS_RESPONSE_MAX_BYTES)
    const items = parseRssXml(xmlText, node.maxItems ?? 20)
    const filtered = node.filterKeywords?.length
      ? items.filter((item) => node.filterKeywords!.some((kw) => item.title?.toLowerCase().includes(kw.toLowerCase()) || item.description?.toLowerCase().includes(kw.toLowerCase())))
      : items
    const text = filtered.map((item) => `${item.title}\n${item.description || ""}`).join("\n\n")
    return { ok: true, text, data: { items: filtered }, items: filtered }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function parseRssXml(xml: string, maxItems: number): Array<{ title?: string; description?: string; link?: string; pubDate?: string }> {
  const items: Array<{ title?: string; description?: string; link?: string; pubDate?: string }> = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1]
    items.push({
      title: extractXmlTag(block, "title"),
      description: extractXmlTag(block, "description"),
      link: extractXmlTag(block, "link"),
      pubDate: extractXmlTag(block, "pubDate"),
    })
  }
  return items
}

const ALLOWED_XML_TAGS = new Set(["title", "description", "link", "pubDate", "author", "guid", "category"])

function extractXmlTag(xml: string, tag: string): string | undefined {
  // Allowlist prevents regex injection if tag is ever sourced from untrusted input
  if (!ALLOWED_XML_TAGS.has(tag)) return undefined
  const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "si").exec(xml)
  return m?.[1]?.trim() || undefined
}

// --- Coinbase ----------------------------------------------------------------

export async function executeCoinbase(
  node: CoinbaseNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const userContextId = String(ctx.scope?.userId || ctx.scope?.user?.id || "").slice(0, 96)
  const conversationId = ctx.missionId

  try {
    const result = await executeCoinbaseNode({
      node,
      userContextId,
      conversationId,
      missionId: ctx.missionId,
      missionRunId: ctx.runId,
      scope: ctx.scope,
      contextNowMs: ctx.now.getTime(),
      logger: () => undefined,
    })

    if (!result.ok) {
      return { ok: false, error: result.errorCode || "Coinbase step failed", errorCode: result.errorCode }
    }

    return {
      ok: true,
      text: (() => {
        if (typeof result.output === "string") return result.output
        return formatCoinbasePriceAlertTextFromObject(result.output) || "Coinbase update ready."
      })(),
      data: result.output,
      artifactRef: result.artifactRef,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// -- Polymarket -----------------------------------------------------------------

export async function executePolymarketDataFetch(
  node: PolymarketDataFetchNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _ctx
  const queryType = (() => {
    const normalized = String(node.queryType || "search").trim().toLowerCase()
    return normalized === "market" || normalized === "prices" || normalized === "leaderboard" || normalized === "events"
      ? normalized
      : "search"
  })()

  try {
    if (queryType === "market") {
      const slug = String(node.slug || "").trim()
      if (!slug) return { ok: false, error: "polymarket-data-fetch requires slug for queryType=market." }
      const market = await fetchPolymarketMarketBySlug(slug)
      if (!market) {
        return {
          ok: false,
          error: `Polymarket market "${slug}" was not found.`,
          errorCode: "POLYMARKET_MARKET_NOT_FOUND",
        }
      }
      const tokenIds = market.outcomes
        .map((outcome) => String(outcome.tokenId || "").trim())
        .filter(Boolean)
        .slice(0, 12)
      const prices = tokenIds.length > 0 ? await fetchPolymarketPrices(tokenIds) : []
      const text = prices.length > 0
        ? `${market.question} | ${prices.slice(0, 4).map((entry) => toCompactPolymarketPriceText(entry.tokenId, entry.price)).join(" | ")}`
        : market.question
      return {
        ok: true,
        text,
        data: {
          queryType,
          slug,
          market,
          prices,
        },
        items: [market],
      }
    }

    if (queryType === "prices") {
      const directTokenIds = Array.isArray(node.tokenIds)
        ? node.tokenIds.map((value) => String(value || "").trim()).filter(Boolean)
        : []
      const slug = String(node.slug || "").trim()
      const slugDerivedTokenIds = slug
        ? ((await fetchPolymarketMarketBySlug(slug))?.outcomes || []).map((outcome) => String(outcome.tokenId || "").trim()).filter(Boolean)
        : []
      const tokenIds = [...new Set([...directTokenIds, ...slugDerivedTokenIds])].slice(0, 24)
      if (tokenIds.length === 0) {
        return { ok: false, error: "polymarket-data-fetch prices query needs tokenIds or a market slug." }
      }
      const prices = await fetchPolymarketPrices(tokenIds)
      return {
        ok: true,
        text: prices.length > 0
          ? prices.slice(0, 6).map((entry) => toCompactPolymarketPriceText(entry.tokenId, entry.price)).join(" | ")
          : "No price rows returned.",
        data: {
          queryType,
          tokenIds,
          prices,
        },
        items: prices,
      }
    }

    if (queryType === "leaderboard") {
      const limit = toClampedInt(node.limit, 20, 1, 100)
      const window = normalizePolymarketLeaderboardWindow(node.window)
      const entries = await fetchPolymarketLeaderboard({ window, limit })
      return {
        ok: true,
        text: entries.length > 0
          ? `Top trader: ${entries[0].username || entries[0].walletAddress || "unknown"} | PnL ${entries[0].pnl.toFixed(2)}`
          : "Leaderboard is empty.",
        data: {
          queryType,
          window,
          entries,
        },
        items: entries,
      }
    }

    if (queryType === "events") {
      const limit = toClampedInt(node.limit, 20, 1, 100)
      const tagSlug = String(node.tagSlug || "").trim() || undefined
      const events = await fetchPolymarketEvents({ limit, tagSlug })
      return {
        ok: true,
        text: events.length > 0 ? `${events.length} active events loaded.` : "No events returned.",
        data: {
          queryType,
          tagSlug,
          events,
        },
        items: events,
      }
    }

    const limit = toClampedInt(node.limit, 8, 1, 24)
    const query = String(node.query || "").trim()
    const tagSlug = String(node.tagSlug || "").trim() || undefined
    const markets = await fetchPolymarketMarkets({ query, tagSlug, limit })
    return {
      ok: true,
      text: markets.length > 0 ? `${markets.length} market matches found.` : "No markets matched the query.",
      data: {
        queryType: "search",
        query,
        tagSlug,
        markets,
      },
      items: markets,
    }
  } catch (err) {
    return { ok: false, error: String(err), errorCode: "POLYMARKET_FETCH_FAILED" }
  }
}
