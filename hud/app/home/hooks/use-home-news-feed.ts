"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"

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

const TOPIC_STORAGE_KEY_PREFIX = "nova_home_news_topic"
const DEFAULT_TOPIC = "all"
const POLL_INTERVAL_MS = 10 * 60_000
const DEFAULT_TOPICS = ["all", "world", "business", "technology", "markets", "crypto"]
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
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeTopicId(value: unknown): string {
  const normalized = normalizeTagToken(value)
  return normalized || DEFAULT_TOPIC
}

function shouldIgnoreTag(value: string): boolean {
  const normalized = normalizeTagToken(value)
  if (!normalized || normalized === DEFAULT_TOPIC) return true
  if (normalized.length < 2 || normalized.length > 24) return true
  const words = normalized.split("-").filter(Boolean)
  if (words.length === 0 || words.length > 3) return true
  if (words.every((word) => /^\d+$/.test(word))) return true
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

function readPersistedTopic(): string {
  if (typeof window === "undefined") return DEFAULT_TOPIC
  try {
    return normalizeTopicId(localStorage.getItem(topicStorageKey()))
  } catch {
    return DEFAULT_TOPIC
  }
}

function writePersistedTopic(topic: string): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(topicStorageKey(), normalizeTopicId(topic))
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
  const items = Array.isArray(raw) ? raw : DEFAULT_TOPICS
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

function normalizeArticles(raw: NewsFeedApiResponse["articles"], fallbackTopic: string): HomeNewsArticle[] {
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
    const resolvedTopic = normalizeTopicId(item?.topic || dedupedTags[0] || fallbackTopic)
    if (!dedupedTags.length && resolvedTopic !== DEFAULT_TOPIC) dedupedTags.push(resolvedTopic)
    articles.push({
      id,
      title,
      summary: String(item?.summary || "").trim(),
      source: String(item?.source || "").trim() || "News",
      url,
      publishedAt: String(item?.publishedAt || "").trim(),
      topic: resolvedTopic,
      tags: dedupedTags,
      imageUrl: String(item?.imageUrl || "").trim(),
    })
  }
  return articles
}

export function useHomeNewsFeed({ enabled = true }: UseHomeNewsFeedInput = {}) {
  const [selectedTopic, setSelectedTopicState] = useState(DEFAULT_TOPIC)
  const [topics, setTopics] = useState<HomeNewsTopic[]>(() => normalizeTopics(DEFAULT_TOPICS))
  const [articles, setArticles] = useState<HomeNewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [fetchedAt, setFetchedAt] = useState("")

  const selectedTopicValid = useMemo(() => {
    return topics.some((topic) => topic.id === selectedTopic) ? selectedTopic : DEFAULT_TOPIC
  }, [selectedTopic, topics])

  const setSelectedTopic = useCallback((topic: string) => {
    const normalized = normalizeTopicId(topic)
    setSelectedTopicState(normalized)
    writePersistedTopic(normalized)
  }, [])

  useLayoutEffect(() => {
    setSelectedTopicState(readPersistedTopic())
  }, [])

  useEffect(() => {
    const handleActiveUserChanged = () => {
      const topic = readPersistedTopic()
      setSelectedTopicState(topic)
      setArticles([])
      setError(null)
      setStale(false)
      setFetchedAt("")
    }
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
    return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
  }, [])

  const refreshNewsFeed = useCallback(async (silent = false, forceRefresh = false) => {
    if (!enabled) {
      setError(null)
      setStale(false)
      setFetchedAt("")
      if (!silent) setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({
        topic: selectedTopicValid,
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
      let data = (await res.json().catch(() => ({}))) as NewsFeedApiResponse

      if (forceRefresh && res.status === 429) {
        const fallbackParams = new URLSearchParams({
          topic: selectedTopicValid,
          limit: "12",
        })
        res = await fetch(`/api/news/feed?${fallbackParams.toString()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        })
        data = (await res.json().catch(() => ({}))) as NewsFeedApiResponse
      }

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to fetch News feed."))
      }
      const nextTopics = normalizeTopics(data.availableTopics)
      const requestedTopic = normalizeTopicId(data.topic || selectedTopicValid)
      const normalized = normalizeArticles(data.articles, requestedTopic)
      setTopics(nextTopics)
      setArticles(normalized)
      setStale(Boolean(data.stale))
      setFetchedAt(String(data.fetchedAt || ""))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch News feed.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [enabled, selectedTopicValid])

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
    selectedNewsTopic: selectedTopicValid,
    setSelectedNewsTopic: setSelectedTopic,
    newsArticles: articles,
    newsLoading: loading,
    newsError: error,
    newsStale: stale,
    newsFetchedAt: fetchedAt,
    refreshNewsFeed: () => refreshNewsFeed(false, true),
  }
}
