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

const YOUTUBE_DAILY_QUOTA_BUDGET = (() => {
  const parsed = Number.parseInt(String(process.env.NOVA_YOUTUBE_DAILY_QUOTA_BUDGET || "").trim(), 10)
  if (!Number.isFinite(parsed)) return 7_000
  return Math.max(500, Math.min(10_000, parsed))
})()

const QUOTA_COST_SEARCH = 100
const QUOTA_COST_VIDEO_DETAILS = 1
const QUOTA_COST_SUBSCRIPTIONS = 1

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
}

const globalState = globalThis as ServiceGlobalState
const quotaByUser = globalState.__novaYoutubeQuotaByUser ?? new Map<string, QuotaEntry>()
const searchCacheByUser = globalState.__novaYoutubeSearchCacheByUser ?? new Map<string, TimedValue<YouTubeSearchResult>>()
const videoCacheByUser = globalState.__novaYoutubeVideoCacheByUser ?? new Map<string, TimedValue<YouTubeVideoDetails>>()
const feedCacheByUser = globalState.__novaYoutubeFeedCacheByUser ?? new Map<string, TimedValue<YouTubeFeedResult>>()
const subscriptionsByUser = globalState.__novaYoutubeSubscriptionsByUser ?? new Map<string, TimedValue<Map<string, ChannelWeight>>>()

globalState.__novaYoutubeQuotaByUser = quotaByUser
globalState.__novaYoutubeSearchCacheByUser = searchCacheByUser
globalState.__novaYoutubeVideoCacheByUser = videoCacheByUser
globalState.__novaYoutubeFeedCacheByUser = feedCacheByUser
globalState.__novaYoutubeSubscriptionsByUser = subscriptionsByUser

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

function buildSearchCacheKey(scope: YouTubeScope | undefined, value: Record<string, unknown>): string {
  return `${normalizeUserScope(scope)}:${Object.entries(value).map(([key, val]) => `${key}=${String(val || "")}`).join("&")}`
}

function buildQueryText(mode: YouTubeFeedMode, topic: string, preferredSources: string[]): string {
  const topicText = topic.replace(/-/g, " ")
  const topSources = preferredSources.slice(0, 4)
  if (mode === "sources" && topSources.length > 0) {
    return `${topicText} (${topSources.join(" OR ")})`
  }
  if (topSources.length > 0) {
    return `${topicText} news ${topSources.slice(0, 2).join(" ")}`
  }
  return `${topicText} news`
}

async function getUserSubscriptionWeights(scope?: YouTubeScope): Promise<Map<string, ChannelWeight>> {
  const userId = normalizeUserScope(scope)
  if (!userId) return new Map<string, ChannelWeight>()
  const cached = getCached(subscriptionsByUser, userId)
  if (cached) return cached

  const map = new Map<string, ChannelWeight>()
  try {
    let pageToken = ""
    for (let page = 0; page < 2; page += 1) {
      const params = new URLSearchParams({
        part: "snippet",
        mine: "true",
        maxResults: "50",
      })
      if (pageToken) params.set("pageToken", pageToken)
      const response = await youtubeApiRequest(
        `${YOUTUBE_API_BASE}/subscriptions?${params.toString()}`,
        { method: "GET" },
        { operation: "youtube_subscriptions", scope, quotaCost: QUOTA_COST_SUBSCRIPTIONS, timeoutMs: 9_000 },
      )
      await assertYouTubeOk(response, "Failed to read YouTube subscriptions.")
      const payload = await response.json().catch(() => null) as {
        items?: Array<{
          snippet?: {
            title?: string
            resourceId?: { channelId?: string }
          }
        }>
        nextPageToken?: string
      } | null

      const items = Array.isArray(payload?.items) ? payload.items : []
      for (const item of items) {
        const channelId = String(item?.snippet?.resourceId?.channelId || "").trim()
        if (!channelId) continue
        const channelTitle = normalizeSourceName(item?.snippet?.title || "")
        map.set(channelId, {
          channelTitle,
          weight: 1,
        })
      }
      pageToken = String(payload?.nextPageToken || "").trim()
      if (!pageToken) break
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/forbidden|scope|permission|quota/i.test(message)) {
      throw error
    }
  }

  setCached(subscriptionsByUser, userId, map, SUBSCRIPTIONS_CACHE_TTL_MS)
  return map
}

function scoreFeedItem(params: {
  item: {
    channelId: string
    channelTitle: string
    title: string
    publishedAt: string
  }
  topic: string
  subscriptions: Map<string, ChannelWeight>
  preferredSources: string[]
  historyChannelIds: Set<string>
}): { score: number; reason: string } {
  const reasons: string[] = []
  let score = 0

  const publishedMs = Date.parse(String(params.item.publishedAt || ""))
  if (Number.isFinite(publishedMs)) {
    const ageHours = Math.max(0, (Date.now() - publishedMs) / 3_600_000)
    const recency = Math.max(0, 1 - Math.min(72, ageHours) / 72)
    score += recency * 30
    if (recency >= 0.66) reasons.push("recent")
  }

  const subscription = params.subscriptions.get(params.item.channelId)
  if (subscription) {
    score += 35
    reasons.push("subscription")
  }

  if (params.historyChannelIds.has(params.item.channelId)) {
    score += 22
    reasons.push("history")
  }

  const channelKey = normalizeSourceKey(params.item.channelTitle)
  const preferredMatch = params.preferredSources.some((source) => {
    const sourceKey = normalizeSourceKey(source)
    return sourceKey.length > 0 && channelKey.includes(sourceKey)
  })
  if (preferredMatch) {
    score += 26
    reasons.push("preferred-source")
  }

  const topicKey = normalizeTopic(params.topic).replace(/-/g, " ")
  const titleKey = String(params.item.title || "").toLowerCase()
  if (topicKey && titleKey.includes(topicKey)) {
    score += 12
    reasons.push("topic-match")
  }

  return {
    score: Math.max(0, Math.round(score)),
    reason: reasons.length > 0 ? reasons.join(", ") : "recent",
  }
}

export async function searchYouTube(
  input: {
    query: string
    type?: YouTubeSearchType
    pageToken?: string
    maxResults?: number
  },
  scope?: YouTubeScope,
): Promise<YouTubeSearchResult> {
  const query = String(input.query || "").trim()
  if (!query) throw youtubeError("youtube.invalid_request", "YouTube search query is required.", { status: 400 })
  const type: YouTubeSearchType = input.type === "channel" ? "channel" : "video"
  const maxResults = parseNonNegativeInt(input.maxResults, 12, 1, 25)
  const pageToken = String(input.pageToken || "").trim()

  const cacheKey = buildSearchCacheKey(scope, { query, type, maxResults, pageToken })
  const cached = getCached(searchCacheByUser, cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type,
    maxResults: String(maxResults),
    safeSearch: "moderate",
  })
  if (type === "video") {
    params.set("videoEmbeddable", "true")
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
}

export async function getYouTubeVideoDetails(videoId: string, scope?: YouTubeScope): Promise<YouTubeVideoDetails> {
  const normalizedVideoId = String(videoId || "").trim()
  if (!normalizedVideoId) {
    throw youtubeError("youtube.invalid_request", "YouTube video id is required.", { status: 400 })
  }

  const cacheKey = buildSearchCacheKey(scope, { videoId: normalizedVideoId })
  const cached = getCached(videoCacheByUser, cacheKey)
  if (cached) return cached

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
}

export async function getYouTubeFeed(options: YouTubeFeedOptions, scope?: YouTubeScope): Promise<YouTubeFeedResult> {
  const mode: YouTubeFeedMode = options.mode === "sources" ? "sources" : "personalized"
  const topic = normalizeTopic(options.topic || "news")
  const pageToken = String(options.pageToken || "").trim()
  const maxResults = parseNonNegativeInt(options.maxResults, 9, 4, 15)
  const preferredSources = Array.isArray(options.preferredSources)
    ? options.preferredSources.map((source) => normalizeSourceName(source)).filter(Boolean)
    : []
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
    preferredSources: preferredSources.join("|"),
    historyChannelIds: Array.from(historyChannelIds).join("|"),
  })
  const cached = getCached(feedCacheByUser, cacheKey)
  if (cached) return cached

  const subscriptions = mode === "personalized"
    ? await getUserSubscriptionWeights(scope)
    : new Map<string, ChannelWeight>()
  const topSubscriptionSources = Array.from(subscriptions.values())
    .map((entry) => entry.channelTitle)
    .filter(Boolean)
    .slice(0, 4)
  const querySources = mode === "personalized"
    ? [...preferredSources, ...topSubscriptionSources]
    : preferredSources

  const query = buildQueryText(mode, topic, querySources)
  const search = await searchYouTube(
    {
      query,
      type: "video",
      pageToken,
      maxResults,
    },
    scope,
  )

  const scoredItems: YouTubeFeedItem[] = search.items
    .map((item) => {
      const scored = scoreFeedItem({
        item,
        topic,
        subscriptions,
        preferredSources,
        historyChannelIds,
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
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return Date.parse(String(b.publishedAt || "")) - Date.parse(String(a.publishedAt || ""))
    })

  const result: YouTubeFeedResult = {
    items: scoredItems,
    nextPageToken: search.nextPageToken,
    prevPageToken: search.prevPageToken,
    mode,
    topic,
    sourceSummary: querySources.slice(0, 8),
  }
  setCached(feedCacheByUser, cacheKey, result, FEED_CACHE_TTL_MS)
  return result
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
