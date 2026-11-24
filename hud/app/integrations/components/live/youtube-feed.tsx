"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link2, RefreshCw } from "lucide-react"

import { YouTubeIcon } from "@/components/icons"
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Tooltip,
} from "@/components/ui"
import { persistUiStorageKey } from "@/lib/settings/ui-storage/client"
import { getActiveUserId } from "@/lib/auth/active-user"
import { cn } from "@/lib/shared/utils"

type YouTubeFeedItem = {
  videoId: string
  title: string
  channelId: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string
  description: string
  score: number
  reason: string
}

type YouTubeControlState = {
  topic: string
  commandNonce: number
}

type YouTubeHomeUpdatedDetail = {
  topic?: string
  commandNonce?: number
  items?: Array<Partial<YouTubeFeedItem>> | null
  selected?: Partial<YouTubeFeedItem> | null
}

interface YouTubeFeedProps {
  className?: string
  connected: boolean
  onOpenIntegrations: () => void
}

const YOUTUBE_HOME_UPDATED_EVENT = "nova:youtube-home-updated"
const HISTORY_STORAGE_KEY_PREFIX = "nova_home_youtube_history"
const MANUAL_VIDEO_STORAGE_KEY_PREFIX = "nova_home_youtube_manual_video"
const DEFAULT_TOPIC = "news"

function historyStorageKey(): string {
  const userId = getActiveUserId()
  return userId ? `${HISTORY_STORAGE_KEY_PREFIX}:${userId}` : HISTORY_STORAGE_KEY_PREFIX
}

function manualVideoStorageKey(): string {
  const userId = getActiveUserId()
  return userId ? `${MANUAL_VIDEO_STORAGE_KEY_PREFIX}:${userId}` : MANUAL_VIDEO_STORAGE_KEY_PREFIX
}

function readHistoryChannelIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(historyStorageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20)
  } catch {
    return []
  }
}

function writeHistoryChannelIds(channelIds: string[]): void {
  if (typeof window === "undefined") return
  try {
    const json = JSON.stringify(channelIds.slice(0, 20))
    localStorage.setItem(historyStorageKey(), json)
    persistUiStorageKey(historyStorageKey(), json)
  } catch {
    // no-op
  }
}

function mergeHistoryChannelIds(current: string[], channelId: string): string[] {
  const normalized = String(channelId || "").trim()
  if (!normalized) return current
  const next = [normalized, ...current.filter((value) => value !== normalized)]
  return next.slice(0, 20)
}

function readManualVideo(): YouTubeFeedItem | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(manualVideoStorageKey())
    if (!raw) return null
    return normalizeSelectedItem(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeManualVideo(item: YouTubeFeedItem | null): void {
  if (typeof window === "undefined") return
  try {
    if (!item) {
      localStorage.removeItem(manualVideoStorageKey())
      persistUiStorageKey(manualVideoStorageKey(), null)
      return
    }
    const json = JSON.stringify(item)
    localStorage.setItem(manualVideoStorageKey(), json)
    persistUiStorageKey(manualVideoStorageKey(), json)
  } catch {
    // no-op
  }
}

function normalizeTopic(value: unknown): string {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  return normalized || DEFAULT_TOPIC
}

function normalizeYouTubeVideoId(value: string): string {
  const match = String(value || "").trim().match(/^[a-zA-Z0-9_-]{11}$/)
  return match ? match[0] : ""
}

function parseYouTubeVideoId(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return ""

  const directId = normalizeYouTubeVideoId(trimmed)
  if (directId) return directId

  try {
    const normalizedUrl = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(normalizedUrl)
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase()

    if (hostname === "youtu.be") {
      return normalizeYouTubeVideoId(url.pathname.split("/").filter(Boolean)[0] || "")
    }

    if (!/(^|\.)youtube\.com$/.test(hostname) && !/(^|\.)youtube-nocookie\.com$/.test(hostname)) {
      return ""
    }

    const watchId = normalizeYouTubeVideoId(url.searchParams.get("v") || "")
    if (watchId) return watchId

    const pathParts = url.pathname.split("/").filter(Boolean)
    if (pathParts[0] === "shorts" || pathParts[0] === "embed" || pathParts[0] === "live" || pathParts[0] === "v") {
      return normalizeYouTubeVideoId(pathParts[1] || "")
    }
  } catch {
    return ""
  }

  return ""
}

function buildManualFeedItem(videoId: string, sourceUrl: string, details?: Partial<YouTubeFeedItem>): YouTubeFeedItem {
  return (
    normalizeSelectedItem({
      videoId,
      title: String(details?.title || "Pinned YouTube video").trim() || "Pinned YouTube video",
      channelId: String(details?.channelId || "").trim(),
      channelTitle: String(details?.channelTitle || "Manual link").trim() || "Manual link",
      publishedAt: String(details?.publishedAt || "").trim(),
      thumbnailUrl: String(details?.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`).trim(),
      description: String(details?.description || sourceUrl).trim() || sourceUrl,
      score: 0,
      reason: "manual-link",
    }) || {
      videoId,
      title: "Pinned YouTube video",
      channelId: "",
      channelTitle: "Manual link",
      publishedAt: "",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: sourceUrl,
      score: 0,
      reason: "manual-link",
    }
  )
}

function normalizeSelectedItem(value: unknown): YouTubeFeedItem | null {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : null
  if (!raw) return null
  const videoId = String(raw.videoId || "").trim()
  if (!videoId) return null
  return {
    videoId,
    title: String(raw.title || "YouTube video").trim() || "YouTube video",
    channelId: String(raw.channelId || "").trim(),
    channelTitle: String(raw.channelTitle || "").trim(),
    publishedAt: String(raw.publishedAt || "").trim(),
    thumbnailUrl: String(raw.thumbnailUrl || "").trim(),
    description: String(raw.description || "").trim(),
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0,
    reason: String(raw.reason || "").trim() || "command-selected",
  }
}

function normalizeFeedItems(value: unknown): YouTubeFeedItem[] {
  if (!Array.isArray(value)) return []
  const out: YouTubeFeedItem[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = normalizeSelectedItem(entry)
    if (!normalized || seen.has(normalized.videoId)) continue
    seen.add(normalized.videoId)
    out.push(normalized)
    if (out.length >= 8) break
  }
  return out
}

function canAutoplayInlinePlayer(): boolean {
  if (typeof document === "undefined") return false
  if (document.visibilityState !== "visible") return false
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false
  return true
}

/** The YouTube player Nova drives from chat ("what should I watch"), with a link box to pin any public video. */
export function YouTubeFeed({
  className,
  connected,
  onOpenIntegrations,
}: YouTubeFeedProps) {
  const [items, setItems] = useState<YouTubeFeedItem[]>([])
  const [selectedVideoId, setSelectedVideoId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyChannelIds, setHistoryChannelIds] = useState<string[]>([])
  const [activeTopic, setActiveTopic] = useState(DEFAULT_TOPIC)
  const [commandNonce, setCommandNonce] = useState(0)
  const [autoplayVideoId, setAutoplayVideoId] = useState("")
  const [hasWatchRequest, setHasWatchRequest] = useState(false)
  const [manualVideo, setManualVideo] = useState<YouTubeFeedItem | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchPending, setSearchPending] = useState(false)
  const activeTopicRef = useRef(activeTopic)
  const commandNonceRef = useRef(commandNonce)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    activeTopicRef.current = activeTopic
  }, [activeTopic])

  useEffect(() => {
    commandNonceRef.current = commandNonce
  }, [commandNonce])

  useEffect(() => {
    setHistoryChannelIds(readHistoryChannelIds())
    setManualVideo(readManualVideo())
  }, [])

  useEffect(() => {
    writeManualVideo(manualVideo)
  }, [manualVideo])

  const selectedItem = useMemo(
    () => manualVideo || items.find((item) => item.videoId === selectedVideoId) || items[0] || null,
    [items, manualVideo, selectedVideoId],
  )

  const fetchControlState = useCallback(async (): Promise<YouTubeControlState | null> => {
    if (!connected) return null
    try {
      const res = await fetch("/api/integrations/youtube/home-control", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        topic?: string
        commandNonce?: number
      }
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to read YouTube control state."))
      }
      return {
        topic: normalizeTopic(data.topic || DEFAULT_TOPIC),
        commandNonce: Number.isFinite(Number(data.commandNonce)) ? Math.max(0, Math.floor(Number(data.commandNonce))) : 0,
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read YouTube control state.")
      return null
    }
  }, [connected])

  const fetchFeed = useCallback(async (options?: {
    topicOverride?: string
    silent?: boolean
    keepSelection?: boolean
    fallbackSelectedItem?: YouTubeFeedItem | null
  }) => {
    const silent = options?.silent === true
    const keepSelection = options?.keepSelection !== false
    const fallbackSelectedItem = options?.fallbackSelectedItem || null
    if (!connected) {
      setItems([])
      setSelectedVideoId("")
      setError(null)
      if (!silent) setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const topic = normalizeTopic(options?.topicOverride || activeTopic || DEFAULT_TOPIC)
      const params = new URLSearchParams({
        mode: "personalized",
        topic,
        maxResults: "8",
      })
      if (historyChannelIds.length > 0) params.set("historyChannelIds", historyChannelIds.join(","))
      const res = await fetch(`/api/integrations/youtube/feed?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        items?: YouTubeFeedItem[]
      }
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to load YouTube feed."))
      }
      const nextItems = Array.isArray(data.items) ? data.items : []
      const mergedItems =
        fallbackSelectedItem?.videoId && nextItems.length > 0 && !nextItems.some((item) => item.videoId === fallbackSelectedItem.videoId)
          ? [fallbackSelectedItem, ...nextItems].slice(0, 8)
          : nextItems
      if (mergedItems.length > 0) {
        setItems(mergedItems)
        setSelectedVideoId((previous) => {
          if (keepSelection && previous && mergedItems.some((item) => item.videoId === previous)) return previous
          return mergedItems[0].videoId
        })
      } else if (fallbackSelectedItem?.videoId) {
        setItems([fallbackSelectedItem])
        setSelectedVideoId(fallbackSelectedItem.videoId)
      } else {
        setItems([])
        setSelectedVideoId("")
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load YouTube feed.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [activeTopic, connected, historyChannelIds])

  const fetchVideoDetails = useCallback(async (videoId: string): Promise<Partial<YouTubeFeedItem> | null> => {
    if (!connected) return null
    try {
      const res = await fetch(`/api/integrations/youtube/video?id=${encodeURIComponent(videoId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        video?: {
          id?: string
          title?: string
          description?: string
          channelId?: string
          channelTitle?: string
          publishedAt?: string
          thumbnailUrl?: string
        }
      }
      if (!res.ok || !data?.ok || !data.video) return null
      return normalizeSelectedItem({
        videoId: String(data.video.id || videoId).trim() || videoId,
        title: String(data.video.title || "").trim(),
        channelId: String(data.video.channelId || "").trim(),
        channelTitle: String(data.video.channelTitle || "").trim(),
        publishedAt: String(data.video.publishedAt || "").trim(),
        thumbnailUrl: String(data.video.thumbnailUrl || "").trim(),
        description: String(data.video.description || "").trim(),
        score: 0,
        reason: "manual-link",
      })
    } catch {
      return null
    }
  }, [connected])

  const handleManualSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const rawValue = searchValue.trim()
    const videoId = parseYouTubeVideoId(rawValue)
    if (!videoId) {
      setSearchError("Paste a valid YouTube link to play it here.")
      setIsSearchOpen(true)
      return
    }

    const fallbackItem = buildManualFeedItem(videoId, rawValue)
    setSearchPending(true)
    setSearchError(null)
    setManualVideo(fallbackItem)
    setSelectedVideoId(videoId)
    setAutoplayVideoId(videoId)
    setIsSearchOpen(false)

    try {
      const details = await fetchVideoDetails(videoId)
      if (details) {
        setManualVideo(buildManualFeedItem(videoId, rawValue, details))
      }
    } finally {
      setSearchPending(false)
    }
  }, [fetchVideoDetails, searchValue])

  const handleRefresh = useCallback(() => {
    setManualVideo(null)
    setAutoplayVideoId("")
    setSearchError(null)
    if (connected && hasWatchRequest) {
      void fetchFeed({ silent: false, keepSelection: false })
    }
  }, [connected, fetchFeed, hasWatchRequest])

  useEffect(() => {
    if (!connected) {
      setItems([])
      setSelectedVideoId("")
      setError(null)
      setActiveTopic(DEFAULT_TOPIC)
      setCommandNonce(0)
      setAutoplayVideoId("")
      setHasWatchRequest(false)
      return
    }
    let stopped = false
    const hydrate = async () => {
      const control = await fetchControlState()
      if (!stopped && control) {
        setActiveTopic(control.topic)
        setCommandNonce(control.commandNonce)
        if (control.commandNonce > 0) {
          setHasWatchRequest(true)
        }
      }
    }
    void hydrate()
    return () => {
      stopped = true
    }
  }, [connected, fetchControlState])

  useEffect(() => {
    if (!connected) return
    const onYouTubeHomeUpdated = (event: Event) => {
      const detail = ((event as CustomEvent<YouTubeHomeUpdatedDetail>).detail || {}) as YouTubeHomeUpdatedDetail
      const nextTopic = normalizeTopic(detail.topic || activeTopicRef.current)
      const nextNonce = Number.isFinite(Number(detail.commandNonce))
        ? Math.max(0, Math.floor(Number(detail.commandNonce)))
        : commandNonceRef.current + 1
      if (nextNonce > 0 && nextNonce <= commandNonceRef.current) return
      const itemsFromCommand = normalizeFeedItems(detail.items)
      const selectedFromCommand = normalizeSelectedItem(detail.selected)
      activeTopicRef.current = nextTopic
      commandNonceRef.current = nextNonce
      setActiveTopic(nextTopic)
      setCommandNonce(nextNonce)
      setHasWatchRequest(true)
      const mergedFromCommand = (() => {
        if (itemsFromCommand.length === 0 && !selectedFromCommand) return []
        const seeded = itemsFromCommand.slice(0, 8)
        if (selectedFromCommand && !seeded.some((item) => item.videoId === selectedFromCommand.videoId)) {
          return [selectedFromCommand, ...seeded].slice(0, 8)
        }
        return seeded
      })()
      if (mergedFromCommand.length > 0) {
        const nextSelectedVideoId = selectedFromCommand?.videoId || mergedFromCommand[0]?.videoId || ""
        setItems(mergedFromCommand)
        setSelectedVideoId(nextSelectedVideoId)
        if (nextSelectedVideoId && canAutoplayInlinePlayer()) {
          setAutoplayVideoId(nextSelectedVideoId)
        }
        return
      }
    }
    window.addEventListener(YOUTUBE_HOME_UPDATED_EVENT, onYouTubeHomeUpdated)
    return () => {
      window.removeEventListener(YOUTUBE_HOME_UPDATED_EVENT, onYouTubeHomeUpdated)
    }
  }, [connected])

  useEffect(() => {
    if (!selectedItem?.channelId) return
    setHistoryChannelIds((previous) => {
      const next = mergeHistoryChannelIds(previous, selectedItem.channelId)
      writeHistoryChannelIds(next)
      return next
    })
  }, [selectedItem?.channelId])

  const shouldAutoplaySelectedItem = Boolean(selectedItem?.videoId && selectedItem.videoId === autoplayVideoId)
  const embedUrl = selectedItem
    ? `https://www.youtube.com/embed/${encodeURIComponent(selectedItem.videoId)}?autoplay=${shouldAutoplaySelectedItem ? "1" : "0"}&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=1`
    : ""

  const closeSearch = () => {
    setIsSearchOpen(false)
    setSearchError(null)
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted">
          {manualVideo ? "Pinned link" : hasWatchRequest ? `Topic: ${activeTopic}` : "Ask Nova in chat what to watch"}
        </p>
        <div className="flex items-center gap-1">
          <Tooltip content={manualVideo ? "Replace the pinned video" : "Play a YouTube link"}>
            <IconButton
              aria-label={manualVideo ? "Replace the pinned video" : "Play a YouTube link"}
              aria-haspopup="dialog"
              onClick={() => {
                setSearchError(null)
                setIsSearchOpen(true)
              }}
              className={cn(manualVideo && "text-accent-text")}
            >
              <Link2 />
            </IconButton>
          </Tooltip>
          <Tooltip content={manualVideo ? "Back to the feed" : "Refresh the feed"}>
            <IconButton
              aria-label={manualVideo ? "Back to the feed" : "Refresh the feed"}
              onClick={handleRefresh}
              disabled={!manualVideo && !hasWatchRequest}
            >
              <RefreshCw />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {!connected && !manualVideo ? (
        <EmptyState
          size="compact"
          icon={<YouTubeIcon className="size-5" />}
          title="YouTube is not connected"
          description="Connect YouTube to load a feed here, or paste a public link to play it."
          action={
            <Button size="sm" variant="outline" onClick={onOpenIntegrations}>
              Open setup
            </Button>
          }
        />
      ) : selectedItem ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-surface-2">
            <iframe
              key={selectedItem.videoId}
              title={selectedItem.title || "YouTube player"}
              src={embedUrl}
              className="size-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{selectedItem.title}</p>
            {selectedItem.channelTitle ? <p className="truncate text-xs text-muted">{selectedItem.channelTitle}</p> : null}
          </div>
          {items.length > 1 && !manualVideo ? (
            <ul className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle" aria-label="More videos">
              {items
                .filter((item) => item.videoId !== selectedItem.videoId)
                .map((item) => (
                  <li key={item.videoId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVideoId(item.videoId)
                        setAutoplayVideoId(item.videoId)
                      }}
                      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-hover"
                    >
                      <span className="w-full truncate text-sm text-fg">{item.title}</span>
                      <span className="w-full truncate text-xs text-muted">{item.channelTitle}</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <EmptyState
          size="compact"
          tone={error && hasWatchRequest ? "danger" : "neutral"}
          title={loading ? "Loading the feed" : !hasWatchRequest ? "Nothing to watch yet" : error ? "The feed did not load" : "Waiting for a video"}
          description={
            loading
              ? "Fetching videos for your topic."
              : !hasWatchRequest
                ? "Ask Nova in chat what to watch, or paste a link with the link button."
                : error || "Nova has not picked a video yet."
          }
        />
      )}

      <Dialog open={isSearchOpen} onOpenChange={(open) => (open ? setIsSearchOpen(true) : closeSearch())} size="md" initialFocus={searchInputRef}>
        <form onSubmit={handleManualSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Play a YouTube link</DialogTitle>
            <DialogDescription>Paste a public YouTube link and Nova pins it in the player.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field
              label="Video link"
              hint="Watch, shorts, live, embed and youtu.be links work."
              error={searchError ?? undefined}
            >
              <Input
                ref={searchInputRef}
                value={searchValue}
                onChange={(event) => {
                  setSearchValue(event.target.value)
                  if (searchError) setSearchError(null)
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                mono
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeSearch}>
              Cancel
            </Button>
            <Button type="submit" loading={searchPending} disabled={searchValue.trim().length === 0}>
              {manualVideo ? "Replace video" : "Play video"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}
