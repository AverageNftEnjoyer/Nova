"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { RefreshCw, SkipForward, VolumeX } from "lucide-react"

import { YouTubeIcon } from "@/components/icons"
import { getActiveUserId } from "@/lib/auth/active-user"
import { cn } from "@/lib/shared/utils"

type YouTubeFeedMode = "personalized" | "sources"

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

const HISTORY_STORAGE_KEY_PREFIX = "nova_home_youtube_history"
const DEFAULT_FEED_MODE: YouTubeFeedMode = "personalized"
const POLL_INTERVAL_MS = 5 * 60_000
const CONTROL_POLL_INTERVAL_MS = 10_000

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

function formatRelative(value: string): string {
  const parsed = Date.parse(String(value || ""))
  if (!Number.isFinite(parsed)) return "unknown time"
  const diffMs = Date.now() - parsed
  const minutes = Math.max(1, Math.floor(diffMs / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function normalizeTopic(value: unknown): string {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  return normalized || "news"
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
  const [feedMode, setFeedMode] = useState<YouTubeFeedMode>(DEFAULT_FEED_MODE)
  const [items, setItems] = useState<YouTubeFeedItem[]>([])
  const [selectedVideoId, setSelectedVideoId] = useState("")
  const [nextPageToken, setNextPageToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyChannelIds, setHistoryChannelIds] = useState<string[]>([])
  const [homeTopic, setHomeTopic] = useState("news")
  const homeTopicRef = useRef("news")
  const homeCommandNonceRef = useRef(0)

  useEffect(() => {
    setHistoryChannelIds(readHistoryChannelIds())
  }, [])

  useEffect(() => {
    homeTopicRef.current = homeTopic
  }, [homeTopic])

  const selectedItem = useMemo(
    () => items.find((item) => item.videoId === selectedVideoId) || items[0] || null,
    [items, selectedVideoId],
  )

  const fetchFeed = useCallback(async (pageToken = "", silent = false, topicOverride?: string) => {
    if (!connected) {
      setItems([])
      setSelectedVideoId("")
      setNextPageToken("")
      setError(null)
      if (!silent) setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const topic = normalizeTopic(topicOverride || homeTopic)
      const params = new URLSearchParams({
        mode: feedMode,
        topic,
        maxResults: "8",
      })
      if (pageToken) params.set("pageToken", pageToken)
      if (historyChannelIds.length > 0) params.set("historyChannelIds", historyChannelIds.join(","))
      const res = await fetch(`/api/integrations/youtube/feed?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean
        error?: string
        nextPageToken?: string
        items?: YouTubeFeedItem[]
      }
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          throw new Error("Session expired. Sign in again to load YouTube.")
        }
        throw new Error(String(data?.error || "Failed to load YouTube feed."))
      }
      const nextItems = Array.isArray(data.items) ? data.items : []
      setItems(nextItems)
      setNextPageToken(String(data.nextPageToken || ""))
      if (nextItems.length > 0) {
        setSelectedVideoId((previous) => {
          if (previous && nextItems.some((item) => item.videoId === previous)) return previous
          return nextItems[0].videoId
        })
      } else {
        setSelectedVideoId("")
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load YouTube feed.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [connected, feedMode, historyChannelIds, homeTopic])

  useEffect(() => {
    void fetchFeed("", false)
  }, [fetchFeed])

  const syncHomeControl = useCallback(async (triggerFeedRefresh: boolean) => {
    if (!connected) {
      homeCommandNonceRef.current = 0
      setHomeTopic("news")
      return
    }
    try {
      const res = await fetch("/api/integrations/youtube/home-control", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean
        topic?: string
        commandNonce?: number
      }
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          setError("Session expired. Sign in again to load YouTube.")
        }
        return
      }
      const topic = normalizeTopic(data.topic || "news")
      const nextNonce = Number.isFinite(Number(data.commandNonce))
        ? Math.max(0, Math.floor(Number(data.commandNonce)))
        : 0
      const topicChanged = topic !== homeTopicRef.current
      const nonceChanged = nextNonce > homeCommandNonceRef.current
      if (topicChanged) {
        setHomeTopic(topic)
      }
      if (nextNonce > homeCommandNonceRef.current) {
        homeCommandNonceRef.current = nextNonce
      }
      if (triggerFeedRefresh && (topicChanged || nonceChanged)) {
        await fetchFeed("", true, topic)
      }
    } catch {
      // no-op
    }
  }, [connected, fetchFeed])

  useEffect(() => {
    if (!connected) {
      homeCommandNonceRef.current = 0
      setHomeTopic("news")
      return
    }
    let cancelled = false
    const run = async (triggerFeedRefresh: boolean) => {
      if (cancelled) return
      await syncHomeControl(triggerFeedRefresh)
    }
    void run(true)
    const timer = window.setInterval(() => {
      void run(true)
    }, CONTROL_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connected, syncHomeControl])

  useEffect(() => {
    if (!connected) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const schedule = () => {
      timer = setTimeout(async () => {
        if (stopped) return
        if (document.visibilityState === "visible") {
          await fetchFeed("", true)
        }
        schedule()
      }, POLL_INTERVAL_MS)
    }
    schedule()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [connected, fetchFeed])

  useEffect(() => {
    if (!selectedItem?.channelId) return
    setHistoryChannelIds((previous) => {
      const next = mergeHistoryChannelIds(previous, selectedItem.channelId)
      writeHistoryChannelIds(next)
      return next
    })
  }, [selectedItem?.channelId])

  const embedUrl = selectedItem
    ? `https://www.youtube.com/embed/${encodeURIComponent(selectedItem.videoId)}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1`
    : ""

  return (
    <section
      ref={sectionRef}
      style={panelStyle}
      className={cn(`${panelClass} home-spotlight-shell p-2.5 min-h-0 flex flex-col`, className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <YouTubeIcon className="w-4 h-4" />
          <h2 className={cn("text-xs uppercase tracking-[0.2em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>YouTube News</h2>
          <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
            Topic: {homeTopic.replace(/-/g, " ")}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={() => setFeedMode("personalized")}
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em]",
              feedMode === "personalized"
                ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                : subPanelClass,
            )}
            title="Subscriptions + history weighted"
          >
            Personal
          </button>
          <button
            onClick={() => setFeedMode("sources")}
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em]",
              feedMode === "sources"
                ? "border-sky-300/40 bg-sky-500/15 text-sky-200"
                : subPanelClass,
            )}
            title="Preferred-source weighting"
          >
            Sources
          </button>
          <button
            onClick={() => void fetchFeed("", false)}
            className={cn("h-7 w-7 rounded-md border grid place-items-center home-spotlight-card home-border-glow", subPanelClass)}
            aria-label="Refresh YouTube feed"
            title="Refresh YouTube feed"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!connected ? (
        <div className={cn("mt-2 rounded-md border p-2 text-[11px] leading-4", subPanelClass)}>
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
          <div className={cn("mt-2 rounded-md border overflow-hidden", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
            {selectedItem ? (
              <iframe
                key={selectedItem.videoId}
                title={selectedItem.title || "YouTube player"}
                src={embedUrl}
                className="w-full h-28"
                allow="autoplay; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="h-28 grid place-items-center text-[11px] opacity-70">
                {loading ? "Loading YouTube feed..." : "No feed items available."}
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className={cn("text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1", isLight ? "text-s-50" : "text-slate-500")}>
              <VolumeX className="w-3 h-3" />
              Always muted
            </p>
            <button
              onClick={() => void fetchFeed(nextPageToken, false)}
              disabled={!nextPageToken || loading}
              className={cn(
                "h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1 disabled:opacity-50",
                subPanelClass,
              )}
            >
              <SkipForward className="w-3 h-3" />
              Next
            </button>
          </div>

          {error ? (
            <p className="mt-2 rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{error}</p>
          ) : null}

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1">
            {items.slice(0, 3).map((item) => (
              <button
                key={item.videoId}
                onClick={() => setSelectedVideoId(item.videoId)}
                className={cn(
                  "w-full text-left rounded-md border px-2 py-1.5 home-spotlight-card home-border-glow",
                  selectedItem?.videoId === item.videoId
                    ? "border-accent-30 bg-accent-10"
                    : subPanelClass,
                )}
              >
                <p className={cn("text-[11px] line-clamp-2", isLight ? "text-s-90" : "text-slate-100")}>{item.title}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className={cn("text-[10px] truncate", isLight ? "text-s-60" : "text-slate-400")}>{item.channelTitle}</p>
                  <p className={cn("text-[9px] uppercase tracking-[0.1em] whitespace-nowrap", isLight ? "text-s-50" : "text-slate-500")}>
                    {formatRelative(item.publishedAt)}
                  </p>
                </div>
              </button>
            ))}
            {!loading && items.length === 0 && !error ? (
              <div className={cn("rounded-md border p-2 text-[11px] leading-4", subPanelClass)}>
                No videos found for the current mode.
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
