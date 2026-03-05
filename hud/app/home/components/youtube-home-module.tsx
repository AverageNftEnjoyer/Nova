"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { RefreshCw } from "lucide-react"

import { YouTubeIcon } from "@/components/icons"
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

interface YouTubeHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  sectionRef?: RefObject<HTMLElement | null>
  className?: string
  connected: boolean
  onOpenIntegrations: () => void
}

const YOUTUBE_HOME_UPDATED_EVENT = "nova:youtube-home-updated"
const HISTORY_STORAGE_KEY_PREFIX = "nova_home_youtube_history"
const DEFAULT_TOPIC = "news"

function historyStorageKey(): string {
  const userId = getActiveUserId()
  return userId ? `${HISTORY_STORAGE_KEY_PREFIX}:${userId}` : HISTORY_STORAGE_KEY_PREFIX
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
    localStorage.setItem(historyStorageKey(), JSON.stringify(channelIds.slice(0, 20)))
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

function normalizeTopic(value: unknown): string {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  return normalized || DEFAULT_TOPIC
}

function formatTopicLabel(value: string): string {
  const tokens = normalizeTopic(value).split(/\s+/).filter(Boolean)
  const pretty = tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ")
  return pretty || "News"
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

export function YouTubeHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  sectionRef,
  className,
  connected,
  onOpenIntegrations,
}: YouTubeHomeModuleProps) {
  const [items, setItems] = useState<YouTubeFeedItem[]>([])
  const [selectedVideoId, setSelectedVideoId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyChannelIds, setHistoryChannelIds] = useState<string[]>([])
  const [activeTopic, setActiveTopic] = useState(DEFAULT_TOPIC)
  const [commandNonce, setCommandNonce] = useState(0)
  const [hasWatchRequest, setHasWatchRequest] = useState(false)
  const activeTopicRef = useRef(activeTopic)
  const commandNonceRef = useRef(commandNonce)

  useEffect(() => {
    activeTopicRef.current = activeTopic
  }, [activeTopic])

  useEffect(() => {
    commandNonceRef.current = commandNonce
  }, [commandNonce])

  useEffect(() => {
    setHistoryChannelIds(readHistoryChannelIds())
  }, [])

  const selectedItem = useMemo(
    () => items.find((item) => item.videoId === selectedVideoId) || items[0] || null,
    [items, selectedVideoId],
  )

  const fetchControlState = useCallback(async (): Promise<YouTubeControlState | null> => {
    if (!connected) return null
    try {
      const res = await fetch("/api/integrations/youtube/home-control", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({})) as {
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
      const data = await res.json().catch(() => ({})) as {
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

  useEffect(() => {
    if (!connected) {
      setItems([])
      setSelectedVideoId("")
      setError(null)
      setActiveTopic(DEFAULT_TOPIC)
      setCommandNonce(0)
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
        setItems(mergedFromCommand)
        setSelectedVideoId(selectedFromCommand?.videoId || mergedFromCommand[0]?.videoId || "")
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

  const embedUrl = selectedItem
    ? `https://www.youtube.com/embed/${encodeURIComponent(selectedItem.videoId)}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=1`
    : ""

  return (
    <section
      ref={sectionRef}
      style={panelStyle}
      className={cn(`${panelClass} home-spotlight-shell p-0 min-h-0 flex flex-col overflow-hidden`, className)}
    >
      <div className="px-2.5 pt-2 pb-1 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <YouTubeIcon className="w-4 h-4" />
          <h2 className={cn("text-xs uppercase tracking-[0.2em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>YouTube News</h2>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em] inline-flex items-center",
              isLight ? "border-[#d5dce8] text-s-60 bg-white/70" : "border-white/10 text-slate-300 bg-white/5",
            )}
            title={`Topic: ${formatTopicLabel(activeTopic)}`}
          >
            {formatTopicLabel(activeTopic)}
          </span>
          <button
            onClick={() => void fetchFeed({ silent: false, keepSelection: false })}
            disabled={!hasWatchRequest}
            className={cn(
              "group/youtube-refresh h-7 w-7 rounded-md border grid place-items-center transition-colors home-spotlight-card home-border-glow disabled:opacity-50",
              subPanelClass,
            )}
            aria-label="Refresh YouTube feed"
            title="Refresh YouTube feed"
          >
            <RefreshCw className="w-3.5 h-3.5 text-s-50 transition-transform duration-200 group-hover/youtube-refresh:text-accent group-hover/youtube-refresh:rotate-90" />
          </button>
        </div>
      </div>

      {!connected ? (
        <div className={cn("mx-2.5 mb-2 rounded-md border p-2 text-[11px] leading-4", subPanelClass)}>
          <p>YouTube is disconnected.</p>
          <button
            onClick={onOpenIntegrations}
            className={cn("mt-2 h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em]", subPanelClass)}
          >
            Open Integrations
          </button>
        </div>
      ) : (
        <>
          <div className={cn("flex-1 border-y overflow-hidden", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
            {selectedItem ? (
              <div className="grid h-full w-full place-items-center p-1.5">
                <div className="h-full w-full max-w-full">
                  <div className="mx-auto h-full w-auto max-w-full aspect-video overflow-hidden rounded-md">
                    <iframe
                      key={selectedItem.videoId}
                      title={selectedItem.title || "YouTube player"}
                      src={embedUrl}
                      className="h-full w-full"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full grid place-items-center text-[11px] opacity-70 px-3 text-center">
                {loading
                  ? "Loading YouTube feed..."
                  : !hasWatchRequest
                    ? "Ask Nova what to watch to start YouTube."
                    : (error || "No videos available right now.")}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
