import { buildYouTubeOAuthUrl as buildOAuthUrl, parseYouTubeOAuthState as parseOAuthState } from "../auth/index"
import { assertYouTubeOk, readYouTubeErrorMessage, youtubeFetchWithRetry } from "../client/index"
import { youtubeError } from "../errors/index"
import {
  disconnectYouTube,
  exchangeCodeForYouTubeTokens,
  getYouTubeClientConfig,
  getYouTubeGrantedScopes,
  getValidYouTubeAccessToken,
} from "../tokens/index"
import {
  YOUTUBE_API_BASE,
  type YouTubeFeedItem,
  type YouTubeFeedMode,
  type YouTubeFeedOptions,
  type YouTubeFeedResult,
  type YouTubeScope,
  type YouTubeSearchResult,
  type YouTubeSearchType,
  type YouTubeVideoDetails,
} from "../types/index"

const SEARCH_CACHE_TTL_MS = 2 * 60_000
const VIDEO_CACHE_TTL_MS = 10 * 60_000
const FEED_CACHE_TTL_MS = 3 * 60_000
const SUBSCRIPTIONS_CACHE_TTL_MS = 12 * 60_000

const YOUTUBE_DAILY_QUOTA_BUDGET = 7_000

const QUOTA_COST_SEARCH = 100
const QUOTA_COST_VIDEO_DETAILS = 1
const DEFAULT_TOPIC_MATCH_MIN = 0.4
const STRICT_TOPIC_MATCH_MIN = 0.55
const STRICT_SOURCE_MATCH_MIN = 0.6
const STRICT_CHANNEL_SOURCE_MATCH_MIN = 0.75
const TOPIC_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "about",
  "for",
  "from",
  "in",
  "on",
  "of",
  "to",
  "the",
  "news",
  "latest",
  "update",
  "updates",
  "video",
  "videos",
  "youtube",
  "today",
  "live",
  "watch",
  "new",
])

type QuotaEntry = {
  dayKey: string
  unitsUsed: number
}

type TimedValue<T> = {
  expiresAt: number
  value: T
}

type ChannelWeight = {
  channelTitle: string
  weight: number
}

type ServiceGlobalState = typeof globalThis & {
  __novaYoutubeQuotaByUser?: Map<string, QuotaEntry>
  __novaYoutubeSearchCacheByUser?: Map<string, TimedValue<YouTubeSearchResult>>
  __novaYoutubeVideoCacheByUser?: Map<string, TimedValue<YouTubeVideoDetails>>
  __novaYoutubeFeedCacheByUser?: Map<string, TimedValue<YouTubeFeedResult>>
  __novaYoutubeSubscriptionsByUser?: Map<string, TimedValue<Map<string, ChannelWeight>>>
  __novaYoutubeSearchInFlightByUser?: Map<string, Promise<YouTubeSearchResult>>
  __novaYoutubeVideoInFlightByUser?: Map<string, Promise<YouTubeVideoDetails>>
  __novaYoutubeFeedInFlightByUser?: Map<string, Promise<YouTubeFeedResult>>
}

const globalState = globalThis as ServiceGlobalState
const quotaByUser = globalState.__novaYoutubeQuotaByUser ?? new Map<string, QuotaEntry>()
const searchCacheByUser = globalState.__novaYoutubeSearchCacheByUser ?? new Map<string, TimedValue<YouTubeSearchResult>>()
const videoCacheByUser = globalState.__novaYoutubeVideoCacheByUser ?? new Map<string, TimedValue<YouTubeVideoDetails>>()
const feedCacheByUser = globalState.__novaYoutubeFeedCacheByUser ?? new Map<string, TimedValue<YouTubeFeedResult>>()
const subscriptionsByUser = globalState.__novaYoutubeSubscriptionsByUser ?? new Map<string, TimedValue<Map<string, ChannelWeight>>>()
const searchInFlightByUser = globalState.__novaYoutubeSearchInFlightByUser ?? new Map<string, Promise<YouTubeSearchResult>>()
const videoInFlightByUser = globalState.__novaYoutubeVideoInFlightByUser ?? new Map<string, Promise<YouTubeVideoDetails>>()
const feedInFlightByUser = globalState.__novaYoutubeFeedInFlightByUser ?? new Map<string, Promise<YouTubeFeedResult>>()

globalState.__novaYoutubeQuotaByUser = quotaByUser
globalState.__novaYoutubeSearchCacheByUser = searchCacheByUser
globalState.__novaYoutubeVideoCacheByUser = videoCacheByUser
globalState.__novaYoutubeFeedCacheByUser = feedCacheByUser
globalState.__novaYoutubeSubscriptionsByUser = subscriptionsByUser
globalState.__novaYoutubeSearchInFlightByUser = searchInFlightByUser
globalState.__novaYoutubeVideoInFlightByUser = videoInFlightByUser
globalState.__novaYoutubeFeedInFlightByUser = feedInFlightByUser

function normalizeUserScope(scope?: YouTubeScope): string {
  return String(scope?.userId || scope?.user?.id || "").trim().toLowerCase()
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeSourceName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
}

function normalizeSourceKey(value: unknown): string {
  return normalizeSourceName(value).toLowerCase()
}

function normalizeTopic(value: unknown): string {
  const normalized = normalizeToken(value)
  return normalized || "news"
}

function normalizeSourceConstraint(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.&'/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
}

function isBroadNewsTopic(topic: string): boolean {
  const normalized = normalizeTopic(topic).replace(/-/g, " ").trim()
  return (
    normalized === "news"
    || normalized === "latest news"
    || normalized === "breaking news"
    || normalized === "top news"
  )
}

function topicSignalTokens(topic: string): string[] {
  const normalized = normalizeTopic(topic).replace(/-/g, " ").trim()
  if (!normalized) return []
  return Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2 && !TOPIC_STOPWORDS.has(token)),
    ),
  )
}

function sourceSignalTokens(source: string): string[] {
  return Array.from(
    new Set(
      normalizeSourceConstraint(source)
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2 && !TOPIC_STOPWORDS.has(token)),
    ),
  )
}

function computeTopicMatchStrength(
  topic: string,
  title: string,
  description: string,
  channelTitle: string,
): number {
  const phrase = normalizeTopic(topic).replace(/-/g, " ").trim().toLowerCase()
  if (!phrase || isBroadNewsTopic(topic)) return 1
  const haystack = `${String(title || "")} ${String(description || "")} ${String(channelTitle || "")}`.toLowerCase()
  if (!haystack) return 0
  if (haystack.includes(phrase)) return 1

  const tokens = topicSignalTokens(topic)
  if (tokens.length === 0) return 0
  let matches = 0
  for (const token of tokens) {
    if (haystack.includes(token)) matches += 1
  }
  return matches / tokens.length
}

function computeSourceMatchStrength(
  sources: string[],
  channelTitle: string,
  title: string,
  description: string,
): number {
  if (!Array.isArray(sources) || sources.length === 0) return 0
  const channelKey = normalizeSourceKey(channelTitle)
  const haystack = `${String(channelTitle || "")} ${String(title || "")} ${String(description || "")}`.toLowerCase()
  let best = 0
  for (const source of sources) {
    const normalizedSource = normalizeSourceConstraint(source)
    if (!normalizedSource) continue
    if (channelKey && (channelKey === normalizedSource || channelKey.includes(normalizedSource))) {
      best = Math.max(best, 1)
      continue
    }
    const tokens = sourceSignalTokens(normalizedSource)
    if (tokens.length === 0) continue
    let matches = 0
    for (const token of tokens) {
      if (haystack.includes(token)) matches += 1
    }
    best = Math.max(best, matches / tokens.length)
  }
  return best
}

function computeChannelSourceMatchStrength(sources: string[], channelTitle: string): number {
  if (!Array.isArray(sources) || sources.length === 0) return 0
  const channelKey = normalizeSourceKey(channelTitle)
  if (!channelKey) return 0
  let best = 0
  for (const source of sources) {
    const normalizedSource = normalizeSourceConstraint(source)
    if (!normalizedSource) continue
    if (channelKey === normalizedSource || channelKey.includes(normalizedSource)) {
      best = Math.max(best, 1)
      continue
    }
    const tokens = sourceSignalTokens(normalizedSource)
    if (tokens.length === 0) continue
    let matches = 0
    for (const token of tokens) {
      if (channelKey.includes(token)) matches += 1
    }
    best = Math.max(best, matches / tokens.length)
  }
  return best
}

function parseNonNegativeInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function consumeQuotaUnits(scope: YouTubeScope | undefined, units: number): void {
  const userId = normalizeUserScope(scope)
  if (!userId) return
  const dayKey = getDayKey()
  const current = quotaByUser.get(userId)
  const entry = !current || current.dayKey !== dayKey
    ? { dayKey, unitsUsed: 0 }
    : { ...current }
  const normalizedUnits = Math.max(1, Math.floor(units))
  if (entry.unitsUsed + normalizedUnits > YOUTUBE_DAILY_QUOTA_BUDGET) {
    throw youtubeError(
      "youtube.quota_exceeded",
      "YouTube daily budget reached for this user context. Try again later.",
      { status: 429 },
    )
  }
  entry.unitsUsed += normalizedUnits
  quotaByUser.set(userId, entry)
}

function getCached<T>(store: Map<string, TimedValue<T>>, key: string): T | null {
  const cached = store.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    store.delete(key)
    return null
  }
  return cached.value
}

function setCached<T>(store: Map<string, TimedValue<T>>, key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs) })
}

async function withInFlightDedup<T>(
  store: Map<string, Promise<T>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const inFlight = store.get(key)
  if (inFlight) return inFlight
  const promise = task()
  store.set(key, promise)
  void promise.then(
    () => {
      if (store.get(key) === promise) {
        store.delete(key)
      }
    },
    () => {
      if (store.get(key) === promise) {
        store.delete(key)
      }
    },
  )
  return promise
}

async function youtubeApiRequest(
  endpoint: string,
  init: RequestInit,
  options: {
    operation: string
    scope?: YouTubeScope
    quotaCost: number
    timeoutMs?: number
  },
): Promise<Response> {
  consumeQuotaUnits(options.scope, options.quotaCost)
  const token = await getValidYouTubeAccessToken(false, options.scope)
  const headers = new Headers(init.headers || {})
  headers.set("Authorization", `Bearer ${token}`)
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  let response = await youtubeFetchWithRetry(
    endpoint,
    {
      ...init,
      headers,
    },
    { operation: options.operation, maxAttempts: 2, timeoutMs: options.timeoutMs ?? 10_000 },
  )

  if (response.status === 401) {
    const refreshed = await getValidYouTubeAccessToken(true, options.scope)
    const retryHeaders = new Headers(init.headers || {})
    retryHeaders.set("Authorization", `Bearer ${refreshed}`)
    if (init.body && !retryHeaders.has("content-type")) retryHeaders.set("content-type", "application/json")
    response = await youtubeFetchWithRetry(
      endpoint,
      {
        ...init,
        headers: retryHeaders,
      },
      { operation: `${options.operation}_retry`, maxAttempts: 1, timeoutMs: options.timeoutMs ?? 10_000 },
    )
  }

  if (response.status === 403) {
    const detail = await readYouTubeErrorMessage(response.clone(), "YouTube request forbidden.")
    if (/quota|daily|limit/i.test(detail)) {
      throw youtubeError("youtube.quota_exceeded", detail, { status: 429 })
    }
  }
  return response
}

function resolveThumbnail(snippet?: { thumbnails?: Record<string, { url?: string }> }): string {
  const thumbnails = snippet?.thumbnails || {}
  const candidates = [
    thumbnails.maxres?.url,
    thumbnails.standard?.url,
    thumbnails.high?.url,
    thumbnails.medium?.url,
    thumbnails.default?.url,
  ]
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim()
    if (normalized) return normalized
  }
  return ""
}

function parseDurationSeconds(durationIso: string): number {
  const value = String(durationIso || "").trim().toUpperCase()
  if (!value.startsWith("P")) return 0
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match) return 0
  const days = Number.parseInt(match[1] || "0", 10) || 0
  const hours = Number.parseInt(match[2] || "0", 10) || 0
  const minutes = Number.parseInt(match[3] || "0", 10) || 0
  const seconds = Number.parseInt(match[4] || "0", 10) || 0
  return (days * 86_400) + (hours * 3_600) + (minutes * 60) + seconds
}

function looksLikeYouTubeShortsText(value: unknown): boolean {
  const text = String(value || "").toLowerCase()
  if (!text) return false
  return /(^|\s)#shorts?\b/.test(text) || /\/shorts?\b/.test(text) || /\byoutube\s+shorts?\b/.test(text)
}

async function filterOutYouTubeShorts(
  items: YouTubeSearchResult["items"],
): Promise<YouTubeSearchResult["items"]> {
  if (items.length === 0) return items
  return items.filter((item) => {
    if (looksLikeYouTubeShortsText(item.title) || looksLikeYouTubeShortsText(item.description)) return false
    return true
  })
}

function buildSearchCacheKey(scope: YouTubeScope | undefined, value: Record<string, unknown>): string {
  return `${normalizeUserScope(scope)}:${Object.entries(value).map(([key, val]) => `${key}=${String(val || "")}`).join("&")}`
}

function buildQueryText(mode: YouTubeFeedMode, topic: string, preferredSources: string[]): string {
  const topicText = topic.replace(/-/g, " ")
  const broadNewsTopic = isBroadNewsTopic(topic)
  const topSources = preferredSources.slice(0, 4)
  if (!broadNewsTopic) {
    if (topSources.length > 0) {
      return `${topicText} (${topSources.join(" OR ")}) -shorts`
    }
    return `${topicText} news -shorts`
  }
  if (mode === "sources" && topSources.length > 0) {
    return `${topicText} (${topSources.join(" OR ")}) -shorts`
  }
  if (topSources.length > 0) {
    return `${topicText} news ${topSources.slice(0, 2).join(" ")} -shorts`
  }
  return `${topicText} news -shorts`
}

async function getUserSubscriptionWeights(scope?: YouTubeScope): Promise<Map<string, ChannelWeight>> {
  const userId = normalizeUserScope(scope)
  if (!userId) return new Map<string, ChannelWeight>()
  const cached = getCached(subscriptionsByUser, userId)
  if (cached) return cached

  const map = new Map<string, ChannelWeight>()
  // Strict single-request policy: do not add a secondary subscriptions lookup.
  setCached(subscriptionsByUser, userId, map, SUBSCRIPTIONS_CACHE_TTL_MS)
  return map
}

function scoreFeedItem(params: {
  item: {
    channelId: string
    channelTitle: string
    title: string
    description: string
    publishedAt: string
  }
  topic: string
  subscriptions: Map<string, ChannelWeight>
  preferredSources: string[]
  requiredSources: string[]
  strictSources: boolean
  strictTopic: boolean
  historyChannelIds: Set<string>
}): { score: number; reason: string; topicStrength: number; sourceStrength: number; channelSourceStrength: number } {
  const reasons: string[] = []
  let score = 0

  const publishedMs = Date.parse(String(params.item.publishedAt || ""))
  if (Number.isFinite(publishedMs)) {
    const ageHours = Math.max(0, (Date.now() - publishedMs) / 3_600_000)
    const recency = Math.max(0, 1 - Math.min(72, ageHours) / 72)
    score += recency * 20
    if (recency >= 0.66) reasons.push("recent")
  }

  const subscription = params.subscriptions.get(params.item.channelId)
  if (subscription) {
    score += 12
    reasons.push("subscription")
  }

  if (params.historyChannelIds.has(params.item.channelId)) {
    score += 8
    reasons.push("history")
  }

  const sourceStrength = computeSourceMatchStrength(
    params.preferredSources,
    params.item.channelTitle,
    params.item.title,
    params.item.description,
  )
  const channelSourceStrength = computeChannelSourceMatchStrength(
    params.requiredSources.length > 0 ? params.requiredSources : params.preferredSources,
    params.item.channelTitle,
  )
  if (sourceStrength > 0) {
    score += sourceStrength * 22
    reasons.push("preferred-source")
  }
  if (channelSourceStrength > 0.8) {
    score += 12
    reasons.push("channel-match")
  }

  const topicStrength = computeTopicMatchStrength(
    params.topic,
    params.item.title,
    params.item.description,
    params.item.channelTitle,
  )
  if (topicStrength > 0) {
    score += (topicStrength * 62) + 14
    reasons.push("topic-match")
  } else if (!isBroadNewsTopic(params.topic)) {
    score -= 28
    reasons.push("off-topic")
  }

  if (params.strictSources && params.requiredSources.length > 0 && channelSourceStrength < STRICT_CHANNEL_SOURCE_MATCH_MIN) {
    score -= 36
    reasons.push("source-miss")
  }

  if (params.strictTopic && !isBroadNewsTopic(params.topic) && topicStrength < 0.55) {
    score -= 42
    reasons.push("weak-topic")
  }

  return {
    score: Math.max(0, Math.round(score)),
    reason: reasons.length > 0 ? reasons.join(", ") : "recent",
    topicStrength,
    sourceStrength,
    channelSourceStrength,
  }
}

export async function searchYouTube(
  input: {
    query: string
    type?: YouTubeSearchType
    pageToken?: string
    maxResults?: number
    videoDuration?: "any" | "short" | "medium" | "long"
  },
  scope?: YouTubeScope,
): Promise<YouTubeSearchResult> {
  const query = String(input.query || "").trim()
  if (!query) throw youtubeError("youtube.invalid_request", "YouTube search query is required.", { status: 400 })
  const type: YouTubeSearchType = input.type === "channel" ? "channel" : "video"
  const maxResults = parseNonNegativeInt(input.maxResults, 12, 1, 25)
  const pageToken = String(input.pageToken || "").trim()
  const requestedDuration = String(input.videoDuration || "").trim().toLowerCase()
  const videoDuration: "any" | "short" | "medium" | "long" =
    requestedDuration === "short" || requestedDuration === "medium" || requestedDuration === "long"
      ? requestedDuration
      : "any"

  const cacheKey = buildSearchCacheKey(scope, { query, type, maxResults, pageToken, videoDuration })
  const cached = getCached(searchCacheByUser, cacheKey)
  if (cached) return cached
  return withInFlightDedup(searchInFlightByUser, cacheKey, async () => {
    const params = new URLSearchParams({
      part: "snippet",
      q: query,
      type,
      maxResults: String(maxResults),
      safeSearch: "moderate",
    })
    if (type === "video") {
      params.set("videoEmbeddable", "true")
      if (videoDuration !== "any") params.set("videoDuration", videoDuration)
    }
    if (pageToken) params.set("pageToken", pageToken)

    const response = await youtubeApiRequest(
      `${YOUTUBE_API_BASE}/search?${params.toString()}`,
      { method: "GET" },
      { operation: "youtube_search", scope, quotaCost: QUOTA_COST_SEARCH },
    )
    await assertYouTubeOk(response, "YouTube search failed.")
    const payload = await response.json().catch(() => null) as {
      nextPageToken?: string
      prevPageToken?: string
      items?: Array<{
        id?: { kind?: string; videoId?: string; channelId?: string } | string
        snippet?: {
          title?: string
          description?: string
          channelId?: string
          channelTitle?: string
          publishedAt?: string
          thumbnails?: Record<string, { url?: string }>
        }
      }>
    } | null

    const items = Array.isArray(payload?.items) ? payload.items : []
    const normalized = items
      .map((item) => {
        const idRecord = item?.id && typeof item.id === "object" ? item.id : null
        const kind: YouTubeSearchType = idRecord?.kind?.includes("channel") ? "channel" : "video"
        const id = String(idRecord?.channelId || idRecord?.videoId || "").trim()
        const snippet = item?.snippet
        if (!id || !snippet) return null
        return {
          id,
          kind,
          title: String(snippet.title || "").trim(),
          description: String(snippet.description || "").trim(),
          channelId: String(snippet.channelId || "").trim(),
          channelTitle: String(snippet.channelTitle || "").trim(),
          publishedAt: String(snippet.publishedAt || "").trim(),
          thumbnailUrl: resolveThumbnail(snippet),
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    const result: YouTubeSearchResult = {
      items: normalized,
      nextPageToken: String(payload?.nextPageToken || "").trim(),
      prevPageToken: String(payload?.prevPageToken || "").trim(),
    }
    setCached(searchCacheByUser, cacheKey, result, SEARCH_CACHE_TTL_MS)
    return result
  })
}

export async function getYouTubeVideoDetails(videoId: string, scope?: YouTubeScope): Promise<YouTubeVideoDetails> {
  const normalizedVideoId = String(videoId || "").trim()
  if (!normalizedVideoId) {
    throw youtubeError("youtube.invalid_request", "YouTube video id is required.", { status: 400 })
  }

  const cacheKey = buildSearchCacheKey(scope, { videoId: normalizedVideoId })
  const cached = getCached(videoCacheByUser, cacheKey)
  if (cached) return cached
  return withInFlightDedup(videoInFlightByUser, cacheKey, async () => {
    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics",
      id: normalizedVideoId,
      maxResults: "1",
    })
    const response = await youtubeApiRequest(
      `${YOUTUBE_API_BASE}/videos?${params.toString()}`,
      { method: "GET" },
      { operation: "youtube_video_details", scope, quotaCost: QUOTA_COST_VIDEO_DETAILS },
    )
    await assertYouTubeOk(response, "YouTube video details failed.")
    const payload = await response.json().catch(() => null) as {
      items?: Array<{
        id?: string
        snippet?: {
          title?: string
          description?: string
          channelId?: string
          channelTitle?: string
          publishedAt?: string
          thumbnails?: Record<string, { url?: string }>
        }
        contentDetails?: { duration?: string }
        statistics?: {
          viewCount?: string | number
          likeCount?: string | number
        }
      }>
    } | null

    const item = payload?.items?.[0]
    if (!item) throw youtubeError("youtube.not_found", "YouTube video not found.", { status: 404 })
    const durationIso = String(item.contentDetails?.duration || "").trim()
    const details: YouTubeVideoDetails = {
      id: String(item.id || normalizedVideoId).trim(),
      title: String(item.snippet?.title || "").trim(),
      description: String(item.snippet?.description || "").trim(),
      channelId: String(item.snippet?.channelId || "").trim(),
      channelTitle: String(item.snippet?.channelTitle || "").trim(),
      publishedAt: String(item.snippet?.publishedAt || "").trim(),
      thumbnailUrl: resolveThumbnail(item.snippet),
      durationIso,
      durationSeconds: parseDurationSeconds(durationIso),
      viewCount: Number.parseInt(String(item.statistics?.viewCount || "0"), 10) || 0,
      likeCount: Number.parseInt(String(item.statistics?.likeCount || "0"), 10) || 0,
    }
    setCached(videoCacheByUser, cacheKey, details, VIDEO_CACHE_TTL_MS)
    return details
  })
}

export async function getYouTubeFeed(options: YouTubeFeedOptions, scope?: YouTubeScope): Promise<YouTubeFeedResult> {
  const mode: YouTubeFeedMode = options.mode === "sources" ? "sources" : "personalized"
  const topic = normalizeTopic(options.topic || "news")
  const broadNewsTopic = isBroadNewsTopic(topic)
  const pageToken = String(options.pageToken || "").trim()
  const maxResults = parseNonNegativeInt(options.maxResults, 9, 4, 15)
  const preferredSources = Array.isArray(options.preferredSources)
    ? options.preferredSources.map((source) => normalizeSourceConstraint(source)).filter(Boolean)
    : []
  const requiredSources = Array.isArray(options.requiredSources)
    ? options.requiredSources.map((source) => normalizeSourceConstraint(source)).filter(Boolean)
    : []
  const strictSources = options.strictSources === true || requiredSources.length > 0
  const strictTopic = options.strictTopic === true || strictSources
  const effectivePreferredSources = Array.from(new Set([...requiredSources, ...preferredSources])).slice(0, 8)
  const historyChannelIds = new Set(
    Array.isArray(options.historyChannelIds)
      ? options.historyChannelIds.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 20)
      : [],
  )

  const cacheKey = buildSearchCacheKey(scope, {
    mode,
    topic,
    pageToken,
    maxResults,
    preferredSources: effectivePreferredSources.join("|"),
    requiredSources: requiredSources.join("|"),
    strictSources: strictSources ? "1" : "0",
    strictTopic: strictTopic ? "1" : "0",
    historyChannelIds: Array.from(historyChannelIds).join("|"),
  })
  const cached = getCached(feedCacheByUser, cacheKey)
  if (cached) return cached
  return withInFlightDedup(feedInFlightByUser, cacheKey, async () => {
    const effectiveHistoryChannelIds = broadNewsTopic ? historyChannelIds : new Set<string>()

    const subscriptions = mode === "personalized" && broadNewsTopic && !strictSources
      ? await getUserSubscriptionWeights(scope)
      : new Map<string, ChannelWeight>()
    const topSubscriptionSources = Array.from(subscriptions.values())
      .map((entry) => entry.channelTitle)
      .filter(Boolean)
      .slice(0, 4)
    const querySources = strictSources
      ? effectivePreferredSources
      : mode === "personalized" && broadNewsTopic
        ? [...effectivePreferredSources, ...topSubscriptionSources]
        : effectivePreferredSources

    const query = buildQueryText(mode, topic, querySources)
    const searchMaxResults = Math.min(25, Math.max(maxResults + 8, maxResults))
    const search = await searchYouTube(
      {
        query,
        type: "video",
        pageToken,
        maxResults: searchMaxResults,
        videoDuration: "medium",
      },
      scope,
    )
    const candidateItems = search.items
    const filteredItems = await filterOutYouTubeShorts(candidateItems)

    const scoredItems = filteredItems
      .map((item) => {
        const scored = scoreFeedItem({
          item,
          topic,
          subscriptions,
          preferredSources: effectivePreferredSources,
          requiredSources,
          strictSources,
          strictTopic,
          historyChannelIds: effectiveHistoryChannelIds,
        })
        return {
          videoId: item.id,
          title: item.title,
          channelId: item.channelId,
          channelTitle: item.channelTitle,
          publishedAt: item.publishedAt,
          thumbnailUrl: item.thumbnailUrl,
          description: item.description,
          score: scored.score,
          reason: scored.reason,
          topicStrength: scored.topicStrength,
          sourceStrength: scored.sourceStrength,
          channelSourceStrength: scored.channelSourceStrength,
        }
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return Date.parse(String(b.publishedAt || "")) - Date.parse(String(a.publishedAt || ""))
      })

    const minTopicStrength = broadNewsTopic
      ? 0
      : strictTopic
        ? STRICT_TOPIC_MATCH_MIN
        : DEFAULT_TOPIC_MATCH_MIN
    let rankedItems = broadNewsTopic
      ? scoredItems
      : scoredItems.filter((item) => item.topicStrength >= minTopicStrength)

    if (strictSources && requiredSources.length > 0) {
      rankedItems = rankedItems.filter(
        (item) => item.channelSourceStrength >= STRICT_CHANNEL_SOURCE_MATCH_MIN && item.sourceStrength >= STRICT_SOURCE_MATCH_MIN,
      )
    }

    if (!broadNewsTopic && rankedItems.length === 0 && !strictTopic && !strictSources) {
      rankedItems = scoredItems.filter((item) => item.topicStrength >= 0.25)
    }

    const selectedItems: YouTubeFeedItem[] = rankedItems
      .slice(0, maxResults)
      .map((item) => ({
        videoId: item.videoId,
        title: item.title,
        channelId: item.channelId,
        channelTitle: item.channelTitle,
        publishedAt: item.publishedAt,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description,
        score: item.score,
        reason: item.reason,
      }))

    const result: YouTubeFeedResult = {
      items: selectedItems,
      nextPageToken: search.nextPageToken,
      prevPageToken: search.prevPageToken,
      mode,
      topic,
      sourceSummary: querySources.slice(0, 8),
    }
    setCached(feedCacheByUser, cacheKey, result, FEED_CACHE_TTL_MS)
    return result
  })
}

export async function probeYouTubeConnection(scope?: YouTubeScope): Promise<{
  connected: boolean
  channelId: string
  channelTitle: string
  scopes: string[]
}> {
  const token = await getValidYouTubeAccessToken(false, scope)
  const response = await youtubeFetchWithRetry(
    `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true&maxResults=1`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    { operation: "youtube_probe_profile", maxAttempts: 2, timeoutMs: 8_000 },
  )
  await assertYouTubeOk(response, "YouTube profile probe failed.")
  const payload = await response.json().catch(() => null) as {
    items?: Array<{ id?: string; snippet?: { title?: string } }>
  } | null
  return {
    connected: true,
    channelId: String(payload?.items?.[0]?.id || "").trim(),
    channelTitle: String(payload?.items?.[0]?.snippet?.title || "").trim(),
    scopes: await getYouTubeGrantedScopes(scope),
  }
}

export async function buildYouTubeOAuthUrl(returnTo: string, scope?: YouTubeScope): Promise<string> {
  const config = await getYouTubeClientConfig(scope)
  const userId = normalizeUserScope(scope)
  return buildOAuthUrl({ returnTo, userId, config })
}

export const parseYouTubeOAuthState = parseOAuthState

export { exchangeCodeForYouTubeTokens, disconnectYouTube, getValidYouTubeAccessToken }
