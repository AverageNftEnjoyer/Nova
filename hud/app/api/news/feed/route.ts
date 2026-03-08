import { NextResponse } from "next/server"

import { type NewsIntegrationConfig, loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import {
  collectCanonicalNewsTopicCandidates,
  matchesRequestedNewsTopics,
  normalizeNewsTopicToken,
  resolveNewsArticleClassification,
  shouldIgnoreNewsTag,
} from "@/lib/news/topic-classification"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REQUEST_TIMEOUT_MS = 9_000
const MAX_ARTICLES = 10
const DEFAULT_LIMIT = 10
const NEWSDATA_BASE_URL = "https://newsdata.io/api/1/latest"
const CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(String(process.env.NOVA_NEWS_FEED_CACHE_TTL_MS || "").trim(), 10)
  if (!Number.isFinite(parsed)) return 60 * 60_000
  return Math.max(5 * 60_000, Math.min(6 * 60 * 60_000, parsed))
})()

const CRYPTO_TOPICS = new Set(["crypto", "bitcoin", "ethereum", "defi", "altcoins", "nft", "web3"])
const MARKET_TOPICS = new Set(["market", "markets", "stocks", "equities", "earnings", "economy", "fed"])
const NEWSDATA_CATEGORY_TOPICS = new Set([
  "business",
  "entertainment",
  "environment",
  "food",
  "health",
  "politics",
  "science",
  "sports",
  "technology",
  "top",
  "tourism",
  "world",
])
type NewsArticle = {
  id: string
  title: string
  summary: string
  source: string
  url: string
  publishedAt: string
  topic: string
  tags: string[]
  imageUrl: string
}

type FeedPayload = {
  ok: true
  topic: string
  topics: string[]
  endpointKind: "latest" | "crypto" | "market" | "mixed"
  availableTopics: string[]
  stale: boolean
  fetchedAt: string
  articles: NewsArticle[]
}

class UpstreamHttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "UpstreamHttpError"
    this.status = status
  }
}

type CachedFeedEntry = {
  expiresAt: number
  payload: FeedPayload
}

type GlobalNewsFeedState = typeof globalThis & {
  __novaNewsFeedCache?: Map<string, CachedFeedEntry>
  __novaNewsFeedInflight?: Map<string, Promise<FeedPayload>>
}

const globalNewsFeedState = globalThis as GlobalNewsFeedState
const feedCache = globalNewsFeedState.__novaNewsFeedCache ?? new Map<string, CachedFeedEntry>()
const feedInflight = globalNewsFeedState.__novaNewsFeedInflight ?? new Map<string, Promise<FeedPayload>>()
globalNewsFeedState.__novaNewsFeedCache = feedCache
globalNewsFeedState.__novaNewsFeedInflight = feedInflight

function normalizeTopicToken(value: unknown): string {
  return normalizeNewsTopicToken(value)
}

function parseTopic(raw: string | null): string {
  return normalizeTopicToken(raw || "all")
}

function parseTopics(raw: string | null, fallbackRaw: string | null, availableTopics: string[]): string[] {
  const allowed = new Set(availableTopics.map((topic) => normalizeTopicToken(topic)).filter(Boolean))
  allowed.add("all")
  const candidates = String(raw || "")
    .split(",")
    .map((value) => normalizeTopicToken(value))
    .filter(Boolean)
  if (candidates.length === 0) {
    const fallback = parseTopic(fallbackRaw)
    return allowed.has(fallback) ? [fallback] : ["all"]
  }
  const filtered = Array.from(new Set(candidates.filter((topic) => allowed.has(topic))))
  if (filtered.length === 0 || filtered.includes("all")) return ["all"]
  return filtered
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(String(raw || "").trim(), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_ARTICLES, parsed))
}

function parseForceRefresh(raw: string | null): boolean {
  const normalized = String(raw || "").trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

function sanitizeAlphaCodes(value: string, min = 2, max = 2): string {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
  if (!cleaned) return ""
  const tokens = cleaned
    .split(",")
    .map((token) => token.trim())
    .filter((token) => new RegExp(`^[a-z]{${min},${max}}$`).test(token))
  return Array.from(new Set(tokens)).join(",")
}

function buildAvailableTopics(news: NewsIntegrationConfig): string[] {
  const configuredTopics = Array.isArray(news.defaultTopics)
    ? news.defaultTopics.map((topic) => normalizeTopicToken(topic)).filter(Boolean)
    : []
  const supportedTopics = [
    "all",
    ...Array.from(NEWSDATA_CATEGORY_TOPICS),
    "markets",
    "crypto",
  ]
  return Array.from(new Set([...supportedTopics, ...configuredTopics]))
}

function resolveEndpoint(topic: string): { kind: "latest" | "crypto" | "market"; url: string } {
  if (CRYPTO_TOPICS.has(topic)) return { kind: "crypto", url: NEWSDATA_BASE_URL }
  if (MARKET_TOPICS.has(topic)) return { kind: "market", url: NEWSDATA_BASE_URL }
  return { kind: "latest", url: NEWSDATA_BASE_URL }
}

function buildRequestUrl(
  endpointUrl: string,
  topic: string,
  endpointKind: "latest" | "crypto" | "market",
  limit: number,
  news: NewsIntegrationConfig,
): string {
  const url = new URL(endpointUrl)
  const hasLimitParam = ["limit", "page_size", "pageSize", "per_page"].some((key) => url.searchParams.has(key))
  const supportsLimitParam = !/\/1\/latest(?:\?|$)/i.test(endpointUrl)
  const hasCategoryParam = ["category"].some((key) => url.searchParams.has(key))
  const hasQueryParam = ["q", "query", "search"].some((key) => url.searchParams.has(key))
  const hasLanguageParam = ["language", "lang"].some((key) => url.searchParams.has(key))
  const hasCountryParam = ["country"].some((key) => url.searchParams.has(key))
  const hasKeyParam = ["apiKey", "apikey", "api_key", "token", "access_token"].some((key) => url.searchParams.has(key))
  if (topic !== "all") {
    if (endpointKind === "crypto") {
      if (!hasCategoryParam) url.searchParams.set("category", "business")
      if (!hasQueryParam) url.searchParams.set("q", "crypto OR bitcoin OR ethereum")
    } else if (endpointKind === "market") {
      if (!hasCategoryParam) url.searchParams.set("category", "business")
      if (!hasQueryParam) url.searchParams.set("q", "stock market OR equities OR fed")
    } else if (NEWSDATA_CATEGORY_TOPICS.has(topic)) {
      if (!hasCategoryParam) url.searchParams.set("category", topic)
    } else if (!hasQueryParam) {
      url.searchParams.set("q", topic.replace(/-/g, " "))
    }
  }
  if (supportsLimitParam && !hasLimitParam) url.searchParams.set("limit", String(limit))
  if (!hasLanguageParam) {
    const language = sanitizeAlphaCodes(String(news.language || "").trim(), 2, 2)
    if (language) url.searchParams.set("language", language)
  }
  if (!hasCountryParam) {
    const country = sanitizeAlphaCodes(String(news.country || "").trim(), 2, 2)
    if (country) url.searchParams.set("country", country)
  }
  if (!hasKeyParam && String(news.apiKey || "").trim()) {
    url.searchParams.set("apikey", String(news.apiKey || "").trim())
  }
  return url.toString()
}

function toIsoTimestamp(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const ts = Date.parse(raw)
  if (Number.isNaN(ts)) return ""
  return new Date(ts).toISOString()
}

function normalizeArticleTopic(value: unknown, fallbackTopic: string): string {
  const normalized = normalizeTopicToken(value)
  return normalized || fallbackTopic
}

function resolvePublishedAt(value: Record<string, unknown>): string {
  const candidates = [
    value.published_at,
    value.publishedAt,
    value.pubDate,
    value.pub_date,
    value.published,
    value.date,
    value.created_at,
    value.createdAt,
  ]
  for (const candidate of candidates) {
    const parsed = toIsoTimestamp(candidate)
    if (parsed) return parsed
  }
  return ""
}

function resolveSource(value: Record<string, unknown>, url: string): string {
  const sourceRecord = value.source && typeof value.source === "object" ? (value.source as Record<string, unknown>) : null
  const candidates = [
    sourceRecord?.name,
    sourceRecord?.title,
    sourceRecord?.id,
    value.source_name,
    value.sourceName,
    value.source_id,
    value.sourceId,
    value.publisher,
    value.news_site,
    typeof value.source === "string" ? value.source : "",
  ]
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim()
    if (normalized) return normalized
  }
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").trim()
    if (hostname) return hostname
  } catch {
    // no-op
  }
  return "News"
}

function collectArticleTags(value: Record<string, unknown>, fallbackTopic: string): string[] {
  const deduped = collectCanonicalNewsTopicCandidates([
    value.topic,
    value.category,
    value.categories,
    value.tags,
    value.keywords,
    value.keyword,
    value.ai_tag,
    value.ai_region,
    value.ai_org,
    value.section,
  ])
  const fallback = normalizeTopicToken(fallbackTopic)
  if (!deduped.length && fallback && fallback !== "all" && !shouldIgnoreTag(fallback)) {
    deduped.push(fallback)
  }
  return deduped
}

function shouldIgnoreTag(tag: string): boolean {
  return shouldIgnoreNewsTag(tag)
}

function buildStoryDedupKey(title: string): string {
  const normalized = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized
}

function toEpochMs(iso: string): number {
  const parsed = Date.parse(String(iso || "").trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function extractArticleRows(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return []
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.articles)) return record.articles
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.results)) return record.results
  if (Array.isArray(record.news)) return record.news
  if (Array.isArray(record.items)) return record.items
  return []
}

function normalizeArticles(raw: unknown, topic: string, limit: number): NewsArticle[] {
  const rows = extractArticleRows(raw)
  const normalized: NewsArticle[] = []
  const seenStoryKeys = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const value = row as Record<string, unknown>
    const title = String(value.title || value.headline || "").trim()
    const url = String(value.url || value.link || value.article_url || "").trim()
    if (!title || !url) continue
    const storyKey = buildStoryDedupKey(title)
    if (storyKey && seenStoryKeys.has(storyKey)) continue
    if (storyKey) seenStoryKeys.add(storyKey)
    const summary = String(value.summary || value.description || value.snippet || "").trim()
    const tags = collectArticleTags(value, topic)
    const classification = resolveNewsArticleClassification({
      title,
      summary,
      rawTopic: value.topic || value.category || (Array.isArray(value.tags) ? value.tags[0] : "") || tags[0] || topic,
      rawTags: tags,
      fallbackTopic: topic,
    })
    if (topic !== "all" && !matchesRequestedNewsTopics([topic], classification)) {
      continue
    }
    const normalizedTopic = normalizeArticleTopic(classification.topic, topic)
    normalized.push({
      id: String(value.id || "").trim() || `${title}:${url}`,
      title,
      summary,
      source: resolveSource(value, url),
      url,
      publishedAt: resolvePublishedAt(value),
      topic: normalizedTopic,
      tags: classification.tags,
      imageUrl: String(value.image_url || value.imageUrl || value.url_to_image || "").trim(),
    })
    if (normalized.length >= limit) break
  }
  normalized.sort((a, b) => toEpochMs(b.publishedAt) - toEpochMs(a.publishedAt))
  return normalized
}

function mergeArticlesByTopic(
  batches: Array<{ topic: string; articles: NewsArticle[] }>,
  limit: number,
): NewsArticle[] {
  const merged = new Map<string, NewsArticle>()
  for (const batch of batches) {
    for (const article of batch.articles) {
      const storyKey = buildStoryDedupKey(article.title) || article.id
      const nextTags = Array.from(
        new Set(
          [article.topic, ...article.tags]
            .map((tag) => normalizeTopicToken(tag))
            .filter((tag) => tag && tag !== "all" && !shouldIgnoreTag(tag)),
        ),
      )
      const nextArticle: NewsArticle = {
        ...article,
        topic: article.topic,
        tags: nextTags,
      }
      const existing = merged.get(storyKey)
      if (!existing) {
        merged.set(storyKey, nextArticle)
        continue
      }
      const existingTags = Array.from(
        new Set(
          [existing.topic, ...existing.tags, nextArticle.topic, ...nextArticle.tags]
            .map((tag) => normalizeTopicToken(tag))
            .filter((tag) => tag && tag !== "all" && !shouldIgnoreTag(tag)),
        ),
      )
      const preferNext = toEpochMs(nextArticle.publishedAt) > toEpochMs(existing.publishedAt)
      const preferred = preferNext ? nextArticle : existing
      merged.set(storyKey, {
        ...preferred,
        tags: existingTags,
      })
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => toEpochMs(b.publishedAt) - toEpochMs(a.publishedAt))
    .slice(0, limit)
}

async function fetchUpstreamJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    })
    const rawBody = await res.text()
    if (!res.ok) {
      let detail = ""
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody) as { message?: unknown; results?: unknown; error?: unknown; status?: unknown }
          const rawDetail = parsed?.message ?? parsed?.error ?? parsed?.results ?? parsed?.status
          if (typeof rawDetail === "string") {
            detail = rawDetail.trim()
          } else if (rawDetail != null) {
            detail = JSON.stringify(rawDetail)
          }
        } catch {
          detail = rawBody.trim()
        }
      }
      throw new UpstreamHttpError(res.status, `Upstream ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`)
    }
    if (!rawBody) return {}
    try {
      return JSON.parse(rawBody) as unknown
    } catch {
      return {}
    }
  } finally {
    clearTimeout(timeout)
  }
}

function buildCacheKey(userId: string, topics: string[], limit: number): string {
  return `${userId}:${topics.map((topic) => normalizeTopicToken(topic)).join(",")}:${limit}`
}

function getCached(cacheKey: string): FeedPayload | null {
  const cached = feedCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    feedCache.delete(cacheKey)
    return null
  }
  return cached.payload
}

function setCached(cacheKey: string, payload: FeedPayload): void {
  feedCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  })
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const config = await loadIntegrationsConfig(verified)
  const news = config.news
  if (!news.connected || !String(news.apiKey || "").trim()) {
    return NextResponse.json({ ok: false, error: "News integration is not connected." }, { status: 400 })
  }

  const requestUrl = new URL(req.url)
  const availableTopics = buildAvailableTopics(news)
  const topics = parseTopics(requestUrl.searchParams.get("topics"), requestUrl.searchParams.get("topic"), availableTopics)
  const limit = parseLimit(requestUrl.searchParams.get("limit"))
  const forceRefresh = parseForceRefresh(requestUrl.searchParams.get("forceRefresh"))
  const cacheKey = buildCacheKey(verified.user.id, topics, limit)
  const staleCandidate = feedCache.get(cacheKey)?.payload ?? null
  if (!forceRefresh) {
    const cached = getCached(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }
  }

  if (!forceRefresh) {
    const inflight = feedInflight.get(cacheKey)
    if (inflight) {
      const payload = await inflight
      return NextResponse.json(payload)
    }
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.newsFeedRead)
  if (!limitDecision.allowed) {
    if (staleCandidate) {
      return NextResponse.json({
        ...staleCandidate,
        stale: true,
      })
    }
    return rateLimitExceededResponse(limitDecision)
  }

  const pending = (async () => {
    const resolvedTopics = topics.includes("all") ? ["all"] : topics
    const topicBatches = await Promise.all(
      resolvedTopics.map(async (requestedTopic) => {
        const endpoint = resolveEndpoint(requestedTopic)
        const upstreamUrl = buildRequestUrl(endpoint.url, requestedTopic, endpoint.kind, limit, news)
        const upstreamPayload = await fetchUpstreamJson(upstreamUrl)
        return {
          topic: requestedTopic,
          endpointKind: endpoint.kind,
          articles: normalizeArticles(upstreamPayload, requestedTopic, limit),
        }
      }),
    )
    const endpointKinds = Array.from(new Set(topicBatches.map((batch) => batch.endpointKind)))
    const articles = mergeArticlesByTopic(
      topicBatches.map(({ topic, articles }) => ({ topic, articles })),
      limit,
    )
    const payload: FeedPayload = {
      ok: true,
      topic: resolvedTopics[0] || "all",
      topics: resolvedTopics,
      endpointKind: endpointKinds.length === 1 ? endpointKinds[0] : "mixed",
      availableTopics,
      stale: false,
      fetchedAt: new Date().toISOString(),
      articles,
    }
    setCached(cacheKey, payload)
    return payload
  })()
    .finally(() => {
      feedInflight.delete(cacheKey)
    })

  feedInflight.set(cacheKey, pending)

  try {
    const payload = await pending
    return NextResponse.json(payload)
  } catch (error) {
    if (staleCandidate) {
      return NextResponse.json({
        ...staleCandidate,
        stale: true,
      })
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "News feed unavailable.",
      },
      { status: error instanceof UpstreamHttpError && error.status >= 400 && error.status < 500 ? 400 : 502 },
    )
  }
}
