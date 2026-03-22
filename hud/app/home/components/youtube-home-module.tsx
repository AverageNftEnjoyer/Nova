"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import { RefreshCw, Search, X } from "lucide-react"

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
      return
    }
    localStorage.setItem(manualVideoStorageKey(), JSON.stringify(item))
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

  useEffect(() => {
    if (!isSearchOpen) return
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isSearchOpen])

  useEffect(() => {
    if (!isSearchOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchOpen(false)
        setSearchError(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isSearchOpen])

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

  const searchModal = isSearchOpen && typeof document !== "undefined"
    ? createPortal(
        <div className="youtube-popup-shell fixed inset-0 z-[125] flex items-center justify-center bg-black/56 p-4">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => {
              setIsSearchOpen(false)
              setSearchError(null)
            }}
            aria-label="Close YouTube link popup"
          />
          <div
            style={panelStyle}
            className={cn(
              "youtube-compositor-safe relative z-10 w-full max-w-xl overflow-hidden rounded-[1.25rem] border home-spotlight-shell shadow-[0_28px_84px_-34px_rgba(0,0,0,0.68)]",
              panelClass,
              isLight ? "bg-white/96" : "bg-black/88",
            )}
          >
            {!isLight ? (
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(67,211,255,0.15),_transparent_58%),linear-gradient(160deg,rgba(15,23,42,0.94),rgba(2,6,23,0.98))]" />
            ) : null}
            <div className={cn("relative z-10 border-b px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")}>YouTube Link</p>
                  <h3 className={cn("mt-1 text-base font-semibold", isLight ? "text-s-90" : "text-slate-100")}>Play a Video in the Module</h3>
                  <p className={cn("mt-1 text-sm leading-5", isLight ? "text-s-60" : "text-slate-300")}>
                    Paste any public YouTube URL and Nova will pin it in the player without changing the module size.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(false)
                    setSearchError(null)
                  }}
                  className={cn(
                    "home-spotlight-card home-border-glow inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                    subPanelClass,
                    isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                  )}
                  aria-label="Close YouTube link popup"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="relative z-10 p-4">
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <label className={cn("home-spotlight-card home-border-glow flex h-12 items-center rounded-xl border px-3", subPanelClass)}>
                  <Search className="mr-2 h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    ref={searchInputRef}
                    value={searchValue}
                    onChange={(event) => {
                      setSearchValue(event.target.value)
                      if (searchError) setSearchError(null)
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className={cn(
                      "h-full w-full bg-transparent text-sm outline-none placeholder:opacity-100",
                      isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                </label>
                {searchError ? (
                  <p className={cn("text-[11px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{searchError}</p>
                ) : (
                  <p className={cn("text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Supports `watch`, `shorts`, `live`, `embed`, and `youtu.be` links.
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false)
                      setSearchError(null)
                    }}
                    className={cn(
                      "h-10 rounded-lg border px-3 text-[10px] uppercase tracking-[0.16em] home-spotlight-card home-border-glow",
                      subPanelClass,
                    )}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={searchPending || searchValue.trim().length === 0}
                    className={cn(
                      "h-10 rounded-lg border px-4 text-[10px] uppercase tracking-[0.16em] transition-colors disabled:opacity-50",
                      isLight
                        ? "border-[#9ac5ff] bg-[#e8f2ff] text-[#1b5eb6] hover:bg-[#d7ebff]"
                        : "border-accent/35 bg-accent/15 text-slate-100 hover:bg-accent/22",
                    )}
                  >
                    {searchPending ? "Loading" : manualVideo ? "Replace Video" : "Play Video"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <section
        ref={sectionRef}
        style={panelStyle}
        className={cn(
          `${panelClass} home-spotlight-shell p-0 min-h-0 flex flex-col overflow-hidden`,
          selectedItem ? "youtube-compositor-safe" : null,
          className,
        )}
      >
        <div className="px-2.5 pt-2 pb-1 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">
            <YouTubeIcon className="w-4 h-4" />
            <h2 className={cn("text-xs uppercase tracking-[0.2em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>YouTube News</h2>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <button
              className={cn(
                "group/youtube-search h-7 w-7 rounded-md border grid place-items-center transition-colors home-spotlight-card home-border-glow",
                subPanelClass,
              )}
              onClick={() => {
                setSearchError(null)
                setIsSearchOpen(true)
              }}
              aria-label="Open YouTube link popup"
              aria-haspopup="dialog"
              aria-expanded={isSearchOpen}
              title={manualVideo ? "Replace YouTube video" : "Open YouTube link popup"}
            >
              <Search
                className={cn(
                  "w-3.5 h-3.5 transition-colors duration-200",
                  isSearchOpen || manualVideo ? "text-accent" : "text-s-50 group-hover/youtube-search:text-accent",
                )}
              />
            </button>
            <button
              onClick={handleRefresh}
              disabled={!manualVideo && !hasWatchRequest}
              className={cn(
                "group/youtube-refresh h-7 w-7 rounded-md border grid place-items-center transition-colors home-spotlight-card home-border-glow disabled:opacity-50",
                subPanelClass,
              )}
              aria-label={manualVideo ? "Return to YouTube feed" : "Refresh YouTube feed"}
              title={manualVideo ? "Return to YouTube feed" : "Refresh YouTube feed"}
            >
              <RefreshCw className="w-3.5 h-3.5 text-s-50 transition-transform duration-200 group-hover/youtube-refresh:text-accent group-hover/youtube-refresh:rotate-90" />
            </button>
          </div>
        </div>

        {!connected && !manualVideo ? (
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
          <div className={cn("flex-1 border-y overflow-hidden", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
            {selectedItem ? (
              <div className="grid h-full w-full place-items-center p-1.5">
                <div className="h-full w-full max-w-full">
                  <div className="youtube-player-shell mx-auto h-full w-auto max-w-full aspect-video overflow-hidden rounded-md">
                    <iframe
                      key={selectedItem.videoId}
                      title={selectedItem.title || "YouTube player"}
                      src={embedUrl}
                      className="youtube-player-frame h-full w-full"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center text-[11px] opacity-70">
                {loading
                  ? "Loading YouTube feed..."
                  : !hasWatchRequest
                    ? "Ask Nova what to watch to start YouTube."
                    : (error || "Waiting for a video...")}
              </div>
            )}
          </div>
        )}
      </section>
      {searchModal}
    </>
  )
}
