/**
 * Data Node Executors
 */

import "server-only"

import type { WebSearchNode, HttpRequestNode, RssFeedNode, CoinbaseNode, NodeOutput, ExecutionContext } from "../../types/index"
import { searchWebAndCollect } from "../../web/search"
import { executeCoinbaseWorkflowStep } from "../coinbase-step"
import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../../web/safe-fetch"
import { formatCoinbasePriceAlertTextFromObject } from "../../output/contract"

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

// ─── Web Search ───────────────────────────────────────────────────────────────

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

// ─── HTTP Request ─────────────────────────────────────────────────────────────

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

    // Don't propagate error body as text — error pages/HTML should not flow to downstream nodes
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

// ─── RSS Feed ─────────────────────────────────────────────────────────────────

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

// ─── Coinbase ─────────────────────────────────────────────────────────────────

export async function executeCoinbase(
  node: CoinbaseNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  // Map new CoinbaseNode to the legacy WorkflowStep format expected by executeCoinbaseWorkflowStep
  const legacyStep = {
    id: node.id,
    type: "coinbase" as const,
    title: node.label,
    coinbaseIntent: node.intent,
    coinbaseParams: {
      assets: node.assets,
      quoteCurrency: node.quoteCurrency || "USD",
      thresholdPct: node.thresholdPct,
      cadence: node.cadence,
      transactionLimit: node.transactionLimit,
      includePreviousArtifactContext: node.includePreviousArtifactContext ?? true,
    },
    coinbaseFormat: node.format
      ? { style: node.format.style, includeRawMetadata: node.format.includeRawMetadata }
      : { style: "standard" as const, includeRawMetadata: true },
  }

  const userContextId = String(ctx.scope?.userId || ctx.scope?.user?.id || "").slice(0, 96)
  const conversationId = ctx.missionId

  try {
    const result = await executeCoinbaseWorkflowStep({
      step: legacyStep,
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
