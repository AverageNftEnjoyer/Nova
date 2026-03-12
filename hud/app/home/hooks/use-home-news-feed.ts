"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"
import {
  matchesRequestedNewsTopics,
  normalizeNewsTopicToken,
  resolveNewsArticleClassification,
  shouldIgnoreNewsTag,
} from "@/lib/news/topic-classification"

export type HomeNewsArticle = {
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

export type HomeNewsTopic = {
  id: string
  label: string
}

interface UseHomeNewsFeedInput {
  enabled?: boolean
}

type NewsFeedApiResponse = {
  ok?: boolean
  topic?: unknown
  topics?: unknown
  availableTopics?: unknown
  fetchedAt?: unknown
  stale?: unknown
  articles?: Array<{
    id?: unknown
    title?: unknown
    summary?: unknown
    source?: unknown
    url?: unknown
    publishedAt?: unknown
    topic?: unknown
    tags?: unknown
    imageUrl?: unknown
  }>
  error?: unknown
}

const TOPIC_STORAGE_KEY_PREFIX = "nova_home_news_topics"
const FEED_STORAGE_KEY_PREFIX = "nova_home_news_feed"
const DEFAULT_TOPIC = "all"
const DEFAULT_TOPIC_SELECTION = [DEFAULT_TOPIC]
const POLL_INTERVAL_MS = 60 * 60_000
const FEED_CACHE_TTL_MS = 60 * 60_000
const DEFAULT_TOPICS = [
  "all",
  "top",
  "world",
  "business",
  "technology",
  "science",
  "health",
  "sports",
  "entertainment",
  "politics",
  "environment",
  "food",
  "tourism",
  "markets",
  "crypto",
]
const TAG_BLOCKLIST_SNIPPETS = [
  "only-available",
  "available-only",
  "premium",
  "subscriber",
  "subscribers",
  "professional",
  "corporate",
  "plans",
  "subscribe",
  "subscription",
  "newsletter",
  "sponsored",
  "advertisement",
]

function normalizeTagToken(value: unknown): string {
  return normalizeNewsTopicToken(value)
}

function normalizeTopicId(value: unknown): string {
  const normalized = normalizeTagToken(value)
  return normalized || DEFAULT_TOPIC
}

function normalizeTopicSelection(raw: unknown, allowedTopics?: string[]): string[] {
  const allowed = new Set((allowedTopics || []).map((topic) => normalizeTopicId(topic)))
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((value) => value.trim().replace(/^"|"$/g, ""))
      : []
  const selected: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const topic = normalizeTopicId(value)
    if (allowed.size > 0 && !allowed.has(topic)) continue
    if (seen.has(topic)) continue
    seen.add(topic)
    selected.push(topic)
  }
  if (selected.length === 0 || selected.includes(DEFAULT_TOPIC)) return [...DEFAULT_TOPIC_SELECTION]
  return selected
}

function shouldIgnoreTag(value: string): boolean {
  const normalized = normalizeTagToken(value)
  if (shouldIgnoreNewsTag(normalized)) return true
  for (const snippet of TAG_BLOCKLIST_SNIPPETS) {
    if (normalized.includes(snippet)) return true
  }
  return false
}

function buildStoryDedupKey(title: string): string {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function topicStorageKey(): string {
  const userId = getActiveUserId()
  return userId ? `${TOPIC_STORAGE_KEY_PREFIX}:${userId}` : TOPIC_STORAGE_KEY_PREFIX
}

function topicSelectionCacheKey(topics: string[]): string {
  const normalized = normalizeTopicSelection(topics)
  if (normalized.length === 1 && normalized[0] === DEFAULT_TOPIC) return DEFAULT_TOPIC
  return [...normalized].sort().join(",")
}

function feedStorageKey(topics: string[]): string {
  const userId = getActiveUserId()
  const scoped = userId ? `${FEED_STORAGE_KEY_PREFIX}:${userId}` : FEED_STORAGE_KEY_PREFIX
  return `${scoped}:${topicSelectionCacheKey(topics)}`
}

function isFreshFetchedAt(value: unknown): boolean {
  const ts = Date.parse(String(value || "").trim())
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts <= FEED_CACHE_TTL_MS
}

function readPersistedFeed(topics: string[]): {
  topics: HomeNewsTopic[]
  articles: HomeNewsArticle[]
  stale: boolean
  fetchedAt: string
} | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(feedStorageKey(topics))
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      availableTopics?: unknown
      articles?: unknown
      stale?: unknown
      fetchedAt?: unknown
    }
    const fetchedAt = String(parsed?.fetchedAt || "").trim()
    if (!fetchedAt) return null
    return {
      topics: normalizeTopics(parsed?.availableTopics),
      articles: normalizeArticles(
        Array.isArray(parsed?.articles) ? (parsed.articles as NewsFeedApiResponse["articles"]) : [],
        normalizeTopicSelection(topics),
      ),
      stale: Boolean(parsed?.stale),
      fetchedAt,
    }
  } catch {
    return null
  }
}

function writePersistedFeed(input: {
  topics: string[]
  availableTopics: HomeNewsTopic[]
  articles: HomeNewsArticle[]
  stale: boolean
  fetchedAt: string
}): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(
      feedStorageKey(input.topics),
      JSON.stringify({
        availableTopics: input.availableTopics.map((topic) => topic.id),
        articles: input.articles,
        stale: input.stale,
        fetchedAt: input.fetchedAt,
      }),
    )
  } catch {
    // no-op
  }
}

function readPersistedTopic(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_TOPIC_SELECTION]
  try {
    const raw = localStorage.getItem(topicStorageKey())
    if (!raw) return [...DEFAULT_TOPIC_SELECTION]
    try {
      return normalizeTopicSelection(JSON.parse(raw))
    } catch {
      return normalizeTopicSelection(raw)
    }
  } catch {
    return [...DEFAULT_TOPIC_SELECTION]
  }
}

function writePersistedTopic(topics: string[]): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(topicStorageKey(), JSON.stringify(normalizeTopicSelection(topics)))
  } catch {
    // no-op
  }
}

function toTopicLabel(topic: string): string {
  if (topic === "all") return "All"
  return topic
    .split(/[-_]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
}

function normalizeTopics(raw: unknown): HomeNewsTopic[] {
  const seen = new Set<string>()
  const items = [...DEFAULT_TOPICS, ...(Array.isArray(raw) ? raw : [])]
  const topics: HomeNewsTopic[] = []
  for (const value of items) {
    const id = normalizeTopicId(value)
    if (seen.has(id)) continue
    seen.add(id)
    topics.push({ id, label: toTopicLabel(id) })
  }
  if (!seen.has(DEFAULT_TOPIC)) {
    topics.unshift({ id: DEFAULT_TOPIC, label: "All" })
  }
  return topics
}

function normalizeArticles(raw: NewsFeedApiResponse["articles"], requestedTopics: string[]): HomeNewsArticle[] {
  if (!Array.isArray(raw)) return []
  const articles: HomeNewsArticle[] = []
  const seenStoryKeys = new Set<string>()
  for (const item of raw) {
    const title = String(item?.title || "").trim()
    const url = String(item?.url || "").trim()
    if (!title || !url) continue
    const storyKey = buildStoryDedupKey(title)
    if (storyKey && seenStoryKeys.has(storyKey)) continue
    if (storyKey) seenStoryKeys.add(storyKey)
    const id = String(item?.id || "").trim() || `${title}:${url}`
    const tags = Array.isArray(item?.tags)
      ? item.tags.map((value) => normalizeTagToken(value)).filter(Boolean)
      : String(item?.tags || "")
          .split(/[|,/]/)
          .map((value) => normalizeTagToken(value))
          .filter(Boolean)
    const dedupedTags = Array.from(new Set(tags)).filter((tag) => !shouldIgnoreTag(tag))
    const classification = resolveNewsArticleClassification({
      title,
      summary: String(item?.summary || "").trim(),
      rawTopic: item?.topic || dedupedTags[0] || requestedTopics[0] || DEFAULT_TOPIC,
      rawTags: dedupedTags,
      fallbackTopic: requestedTopics[0] || DEFAULT_TOPIC,
    })
    if (!matchesRequestedNewsTopics(requestedTopics, classification)) continue
    const resolvedTopic = normalizeTopicId(classification.topic)
    const normalizedTags = Array.from(new Set(classification.tags)).filter((tag) => !shouldIgnoreTag(tag))
    if (!normalizedTags.length && resolvedTopic !== DEFAULT_TOPIC) normalizedTags.push(resolvedTopic)
    articles.push({
      id,
      title,
      summary: String(item?.summary || "").trim(),
      source: String(item?.source || "").trim() || "News",
      url,
      publishedAt: String(item?.publishedAt || "").trim(),
      topic: resolvedTopic,
      tags: normalizedTags,
      imageUrl: String(item?.imageUrl || "").trim(),
    })
  }
  return articles
}

export function useHomeNewsFeed({ enabled = true }: UseHomeNewsFeedInput = {}) {
  const [selectedTopics, setSelectedTopicsState] = useState<string[]>(() => [...DEFAULT_TOPIC_SELECTION])
  const [topics, setTopics] = useState<HomeNewsTopic[]>(() => normalizeTopics(DEFAULT_TOPICS))
  const [articles, setArticles] = useState<HomeNewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [fetchedAt, setFetchedAt] = useState("")

  const selectedTopicsValid = useMemo(() => {
    return normalizeTopicSelection(
      selectedTopics,
      topics.map((topic) => topic.id),
    )
  }, [selectedTopics, topics])
  const selectedTopicsKey = useMemo(() => topicSelectionCacheKey(selectedTopicsValid), [selectedTopicsValid])
  const selectedTopicsParam = useMemo(
    () => (selectedTopicsKey === DEFAULT_TOPIC ? DEFAULT_TOPIC : selectedTopicsKey),
    [selectedTopicsKey],
  )

  const setSelectedTopics = useCallback((nextTopics: string[]) => {
    const normalized = normalizeTopicSelection(nextTopics)
    setSelectedTopicsState(normalized)
    writePersistedTopic(normalized)
  }, [])

  useLayoutEffect(() => {
    setSelectedTopicsState(readPersistedTopic())
  }, [])

  useEffect(() => {
    const handleActiveUserChanged = () => {
      const nextTopics = readPersistedTopic()
      setSelectedTopicsState(nextTopics)
      setArticles([])
      setError(null)
      setStale(false)
      setFetchedAt("")
    }
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
    return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
  }, [])

  const refreshNewsFeed = useCallback(async (silent = false, forceRefresh = false) => {
    const currentSelectedTopics = normalizeTopicSelection(selectedTopicsParam)
    if (!enabled) {
      setError(null)
      setStale(false)
      setFetchedAt("")
      if (!silent) setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      if (!forceRefresh) {
        const cached = readPersistedFeed(currentSelectedTopics)
        if (cached && isFreshFetchedAt(cached.fetchedAt)) {
          setTopics(cached.topics)
          setArticles(cached.articles)
          setStale(cached.stale)
          setFetchedAt(cached.fetchedAt)
          setError(null)
          if (!silent) setLoading(false)
          return
        }
      }

      const params = new URLSearchParams({
        topics: selectedTopicsParam,
        limit: "12",
      })
      if (forceRefresh) {
        params.set("forceRefresh", "1")
      }
      let res = await fetch(`/api/news/feed?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      let data = (await res.json()) as NewsFeedApiResponse

      if (forceRefresh && res.status === 429) {
        const fallbackParams = new URLSearchParams({
          topics: selectedTopicsParam,
          limit: "12",
        })
        res = await fetch(`/api/news/feed?${fallbackParams.toString()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        })
        data = (await res.json()) as NewsFeedApiResponse
      }

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to fetch News feed."))
      }
      const nextTopics = normalizeTopics(data.availableTopics)
      const requestedTopics = normalizeTopicSelection(
        data.topics ?? data.topic ?? selectedTopicsParam,
        nextTopics.map((topic) => topic.id),
      )
      const normalized = normalizeArticles(data.articles, requestedTopics)
      setTopics(nextTopics)
      if (topicSelectionCacheKey(requestedTopics) !== selectedTopicsKey) {
        setSelectedTopicsState(requestedTopics)
        writePersistedTopic(requestedTopics)
      }
      setArticles(normalized)
      setStale(Boolean(data.stale))
      setFetchedAt(String(data.fetchedAt || ""))
      setError(null)
      writePersistedFeed({
        topics: requestedTopics,
        availableTopics: nextTopics,
        articles: normalized,
        stale: Boolean(data.stale),
        fetchedAt: String(data.fetchedAt || ""),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch News feed.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [enabled, selectedTopicsKey, selectedTopicsParam])

  useEffect(() => {
    void refreshNewsFeed(false)
  }, [refreshNewsFeed])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const schedule = () => {
      timer = setTimeout(async () => {
        if (stopped) return
        if (document.visibilityState === "visible") {
          await refreshNewsFeed(true)
        }
        schedule()
      }, POLL_INTERVAL_MS)
    }

    schedule()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, refreshNewsFeed])

  return {
    newsTopics: topics,
    selectedNewsTopics: selectedTopicsValid,
    setSelectedNewsTopics: setSelectedTopics,
    newsArticles: articles,
    newsLoading: loading,
    newsError: error,
    newsStale: stale,
    newsFetchedAt: fetchedAt,
    refreshNewsFeed: () => refreshNewsFeed(false, true),
  }
}
