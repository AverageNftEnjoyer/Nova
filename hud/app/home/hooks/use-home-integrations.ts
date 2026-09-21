"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  INTEGRATIONS_UPDATED_EVENT,
  loadIntegrationsSettings,
  type IntegrationsSettings,
  type LlmProvider,
} from "@/lib/integrations/store/client-store"
import { buildIntegrationsHref, type IntegrationSetupKey } from "@/lib/integrations/navigation"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"

interface UseHomeIntegrationsInput {
  latestUsage?: { provider?: string; model?: string } | null
  speakTts?: (text: string) => void
}

interface IntegrationConfigShape {
  openai?: { defaultModel?: unknown }
  claude?: { defaultModel?: unknown }
  grok?: { defaultModel?: unknown }
  gemini?: { defaultModel?: unknown }
}

type SpotifyPlaybackAction = "play" | "pause" | "next" | "previous" | "play_liked" | "play_smart" | "seek"

type SpotifyPlaybackResponse = {
  ok?: boolean
  message?: string
  error?: string
  nowPlaying?: unknown
}

export interface HomeSpotifyNowPlaying {
  connected: boolean
  playing: boolean
  progressMs: number
  durationMs: number
  trackId: string
  trackName: string
  artistName: string
  albumName: string
  albumArtUrl: string
  deviceId: string
  deviceName: string
}

const EMPTY_SPOTIFY_NOW_PLAYING: HomeSpotifyNowPlaying = {
  connected: false,
  playing: false,
  progressMs: 0,
  durationMs: 0,
  trackId: "",
  trackName: "",
  artistName: "",
  albumName: "",
  albumArtUrl: "",
  deviceId: "",
  deviceName: "",
}

function normalizeSpotifyNowPlaying(raw: unknown): HomeSpotifyNowPlaying {
  if (!raw || typeof raw !== "object") return EMPTY_SPOTIFY_NOW_PLAYING
  const value = raw as Partial<HomeSpotifyNowPlaying>
  return {
    connected: Boolean(value.connected),
    playing: Boolean(value.playing),
    progressMs: Number.isFinite(Number(value.progressMs)) ? Math.max(0, Math.floor(Number(value.progressMs))) : 0,
    durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.floor(Number(value.durationMs))) : 0,
    trackId: String(value.trackId || "").trim(),
    trackName: String(value.trackName || "").trim(),
    artistName: String(value.artistName || "").trim(),
    albumName: String(value.albumName || "").trim(),
    albumArtUrl: String(value.albumArtUrl || "").trim(),
    deviceId: String(value.deviceId || "").trim(),
    deviceName: String(value.deviceName || "").trim(),
  }
}

function modelForProvider(provider: LlmProvider, config: IntegrationConfigShape): string {
  if (provider === "claude") return String(config?.claude?.defaultModel || "claude-sonnet-4-20250514")
  if (provider === "grok") return String(config?.grok?.defaultModel || "grok-4-0709")
  if (provider === "gemini") return String(config?.gemini?.defaultModel || "gemini-2.5-pro")
  return String(config?.openai?.defaultModel || "gpt-4.1")
}

function providerFromValue(value: unknown): LlmProvider {
  return value === "claude" || value === "grok" || value === "gemini" ? value : "openai"
}

// The client interpolates progress between polls (see spotify-home-module), so polls only
// need to detect track/play-state changes and correct drift.
const SPOTIFY_POLL_INTERVAL_PLAYING_MS = 4_000
const SPOTIFY_POLL_INTERVAL_PLAYING_NEAR_END_MS = 2_000
const SPOTIFY_POLL_INTERVAL_PAUSED_WITH_TRACK_MS = 5_000
const SPOTIFY_POLL_INTERVAL_IDLE_MS = 8_000
const SPOTIFY_REQUEST_TIMEOUT_MS = 12_000
const SPOTIFY_UNAUTHORIZED_REDIRECT_COOLDOWN_MS = 2_500
// Only replace the now-playing snapshot when the server progress differs from the
// client-interpolated progress by more than this (avoids re-rendering on every poll).
const SPOTIFY_PROGRESS_DRIFT_THRESHOLD_MS = 1_500
// Minimum gap between poll cycles triggered by visibility/focus events.
const SPOTIFY_FOREGROUND_POLL_MIN_GAP_MS = 1_000

interface RefreshSpotifyOptions {
  /** Background poll: do not toggle the loading flag once a snapshot exists. */
  silent?: boolean
}

function expectedSpotifyProgressMs(prev: HomeSpotifyNowPlaying, snapshotAt: number, now: number): number {
  if (!prev.playing) return prev.progressMs
  const projected = prev.progressMs + Math.max(0, now - snapshotAt)
  return prev.durationMs > 0 ? Math.min(prev.durationMs, projected) : projected
}

function hasMeaningfulSpotifyChange(
  prev: HomeSpotifyNowPlaying | null,
  next: HomeSpotifyNowPlaying,
  snapshotAt: number,
  now: number,
): boolean {
  if (!prev) return true
  if (
    prev.connected !== next.connected
    || prev.playing !== next.playing
    || prev.trackId !== next.trackId
    || prev.durationMs !== next.durationMs
    || prev.trackName !== next.trackName
    || prev.artistName !== next.artistName
    || prev.albumName !== next.albumName
    || prev.albumArtUrl !== next.albumArtUrl
    || prev.deviceId !== next.deviceId
    || prev.deviceName !== next.deviceName
  ) {
    return true
  }
  return Math.abs(next.progressMs - expectedSpotifyProgressMs(prev, snapshotAt, now)) > SPOTIFY_PROGRESS_DRIFT_THRESHOLD_MS
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = SPOTIFY_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutHandle = window.setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs))
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    const data = await res.json()
    return { res, data }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Spotify request timed out.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutHandle)
  }
}

export function useHomeIntegrations({ latestUsage }: UseHomeIntegrationsInput) {
  const router = useRouter()
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [discordConnected, setDiscordConnected] = useState(false)
  const [slackConnected, setSlackConnected] = useState(false)
  const [braveConnected, setBraveConnected] = useState(false)
  const [coinbaseConnected, setCoinbaseConnected] = useState(false)
  const [phantomConnected, setPhantomConnected] = useState(false)
  const [polymarketConnected, setPolymarketConnected] = useState(false)
  const [openaiConnected, setOpenaiConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [grokConnected, setGrokConnected] = useState(false)
  const [geminiConnected, setGeminiConnected] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [youtubeConnected, setYouTubeConnected] = useState(false)
  const [spotifyNowPlaying, setSpotifyNowPlaying] = useState<HomeSpotifyNowPlaying | null>(null)
  // Stable ref always pointing at latest nowPlaying — safe to read inside callbacks without deps
  const spotifyNowPlayingRef = useRef<HomeSpotifyNowPlaying | null>(null)
  // Stable ref for connected — avoids refreshSpotifyNowPlaying re-creation on connect change
  const spotifyConnectedRef = useRef(false)
  const spotifyUnauthorizedRef = useRef(false)
  const spotifyUnauthorizedRedirectAtRef = useRef(0)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [spotifyBusyAction, setSpotifyBusyAction] = useState<SpotifyPlaybackAction | null>(null)
  const preserveSpotifyCacheUntilServerSyncRef = useRef(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gcalendarConnected, setGcalendarConnected] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [activeLlmModel, setActiveLlmModel] = useState("gpt-4.1")

  // Keep refs in sync
  // Time the current snapshot was committed; used to project client-side progress for drift checks.
  const spotifySnapshotAtRef = useRef(0)
  useEffect(() => {
    spotifyNowPlayingRef.current = spotifyNowPlaying
    spotifySnapshotAtRef.current = Date.now()
  }, [spotifyNowPlaying])
  useEffect(() => { spotifyConnectedRef.current = spotifyConnected }, [spotifyConnected])
  useEffect(() => {
    writeShellUiCache({ spotifyNowPlaying: spotifyNowPlaying ?? null })
  }, [spotifyNowPlaying])

  const applyLocalSettings = useCallback((settings: IntegrationsSettings) => {
    setTelegramConnected(settings.telegram.connected)
    setDiscordConnected(settings.discord.connected)
    setSlackConnected(Boolean(settings.slack?.connected))
    setBraveConnected(settings.brave.connected)
    setCoinbaseConnected(Boolean(settings.coinbase?.connected))
    setPhantomConnected(Boolean(settings.phantom?.connected))
    setPolymarketConnected(Boolean(settings.polymarket?.connected))
    setOpenaiConnected(settings.openai.connected)
    setClaudeConnected(settings.claude.connected)
    setGrokConnected(settings.grok.connected)
    setGeminiConnected(settings.gemini.connected)
    const spotifyIsConnected = Boolean(settings.spotify?.connected)
    setSpotifyConnected(spotifyIsConnected)
    setYouTubeConnected(Boolean(settings.youtube?.connected))
    if (!spotifyIsConnected) {
      if (!preserveSpotifyCacheUntilServerSyncRef.current) {
        setSpotifyNowPlaying(null)
      }
      setSpotifyError(null)
    }
    setGmailConnected(settings.gmail.connected)
    setGcalendarConnected(Boolean(settings.gcalendar?.connected))
    setActiveLlmProvider(settings.activeLlmProvider)
    setActiveLlmModel(
      settings.activeLlmProvider === "claude"
        ? settings.claude.defaultModel
        : settings.activeLlmProvider === "grok"
          ? settings.grok.defaultModel
          : settings.activeLlmProvider === "gemini"
            ? settings.gemini.defaultModel
            : settings.openai.defaultModel,
    )
  }, [])

  // Stable callback — uses refs so it never needs to be re-created when state changes.
  // This prevents the polling interval from being torn down on every poll response.
  const markSpotifyUnauthorized = useCallback(() => {
    spotifyUnauthorizedRef.current = true
    setSpotifyConnected(false)
    setSpotifyNowPlaying(null)
    setSpotifyError("Spotify session expired. Reconnect in Integrations.")
    const onLoginRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/login")
    if (onLoginRoute) return
    const now = Date.now()
    if (now - spotifyUnauthorizedRedirectAtRef.current < SPOTIFY_UNAUTHORIZED_REDIRECT_COOLDOWN_MS) return
    spotifyUnauthorizedRedirectAtRef.current = now
    router.push("/login")
  }, [router])

  const refreshSpotifyNowPlaying = useCallback(async (connectedHint?: boolean, options?: RefreshSpotifyOptions) => {
    if (spotifyUnauthorizedRef.current) {
      setSpotifyLoading(false)
      return
    }

    const shouldFetch = typeof connectedHint === "boolean" ? connectedHint : spotifyConnectedRef.current
    if (!shouldFetch) {
      setSpotifyNowPlaying(null)
      setSpotifyLoading(false)
      setSpotifyError(null)
      return
    }

    // Silent polls (after the first snapshot exists) must not flip the loading flag.
    const showLoading = !(options?.silent && spotifyNowPlayingRef.current)
    if (showLoading) setSpotifyLoading(true)
    try {
      const { res, data } = await fetchJsonWithTimeout("/api/integrations/spotify/now-playing", {
        cache: "no-store",
        credentials: "include",
      })
      if (res.status === 401) {
        markSpotifyUnauthorized()
        return
      }
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to read Spotify status."))
      }
      setSpotifyConnected(Boolean(data?.connected))
      const incoming = normalizeSpotifyNowPlaying(data?.nowPlaying)
      if (hasMeaningfulSpotifyChange(spotifyNowPlayingRef.current, incoming, spotifySnapshotAtRef.current, Date.now())) {
        setSpotifyNowPlaying(incoming)
      }
      setSpotifyError(null)
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        markSpotifyUnauthorized()
        return
      }
      setSpotifyNowPlaying((prev) => prev ?? EMPTY_SPOTIFY_NOW_PLAYING)
      setSpotifyError(error instanceof Error ? error.message : "Failed to read Spotify status.")
    } finally {
      if (showLoading) setSpotifyLoading(false)
    }
  }, [markSpotifyUnauthorized])

  const seekSpotify = useCallback(async (positionMs: number): Promise<void> => {
    if (spotifyUnauthorizedRef.current) {
      setSpotifyError("Spotify session expired. Reconnect in Integrations.")
      return
    }

    setSpotifyNowPlaying((prev) => prev ? { ...prev, progressMs: positionMs } : prev)
    try {
      const { res, data } = await fetchJsonWithTimeout("/api/integrations/spotify/playback", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "seek", positionMs }),
      })
      if (res.status === 401) {
        markSpotifyUnauthorized()
        return
      }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || "Seek failed."))
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        markSpotifyUnauthorized()
        return
      }
      void refreshSpotifyNowPlaying(true)
    }
  }, [markSpotifyUnauthorized, refreshSpotifyNowPlaying])

  // After a play/pause command, suppress poll cycles for this many ms to prevent
  // an in-flight poll from overwriting the optimistic state before Spotify propagates.
  const spotifyCommandSentAtRef = useRef(0)

  const runSpotifyPlayback = useCallback(async (action: SpotifyPlaybackAction): Promise<SpotifyPlaybackResponse> => {
    if (spotifyUnauthorizedRef.current) {
      const message = "Spotify session expired. Reconnect in Integrations."
      setSpotifyError(message)
      return { ok: false, error: message }
    }

    setSpotifyBusyAction(action)
    setSpotifyError(null)

    if (action === "pause") {
      setSpotifyNowPlaying((prev) => prev ? { ...prev, playing: false } : prev)
    } else if (action === "play") {
      setSpotifyNowPlaying((prev) => prev ? { ...prev, playing: true } : prev)
    } else if (action === "next" || action === "previous" || action === "play_liked" || action === "play_smart") {
      // Keep existing metadata visible until the next track snapshot arrives.
      setSpotifyNowPlaying((prev) => prev ? { ...prev, playing: true } : prev)
    }

    try {
      const { res, data } = await fetchJsonWithTimeout("/api/integrations/spotify/playback", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      })
      if (res.status === 401) {
        markSpotifyUnauthorized()
        return { ok: false, error: "Spotify session expired. Reconnect in Integrations." }
      }
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || data?.message || `Spotify action ${action} failed.`))
      }
      // Stamp command time BEFORE updating state so the poll suppression window is in place
      // before any in-flight poll cycle can fire.
      if (action === "pause" || action === "play") {
        spotifyCommandSentAtRef.current = Date.now()
      }
      if (data?.nowPlaying) {
        setSpotifyNowPlaying(normalizeSpotifyNowPlaying(data.nowPlaying))
      } else if (!data?.skipNowPlayingRefresh) {
        await refreshSpotifyNowPlaying(true)
      }
      // For plain play (resume): verify Spotify actually started after a short delay.
      // Catches silent device failures without waiting for the full 2s poll cycle.
      if (action === "play" && data?.skipNowPlayingRefresh) {
        window.setTimeout(() => { void refreshSpotifyNowPlaying(true) }, 1_500)
      }
      // For track-change actions: poll every 600ms until trackId changes or 5 attempts pass.
      // Read prevTrackId from ref - always accurate, no stale closure issue.
      // Note: plain "play" (resume) is excluded - trackId won't change, polling is wasteful.
      if ((action === "next" || action === "previous" || action === "play_liked" || action === "play_smart") && data?.skipNowPlayingRefresh) {
        const prevTrackId = spotifyNowPlayingRef.current?.trackId || ""
        let attempts = 0
        const probe = async () => {
          attempts++
          await refreshSpotifyNowPlaying(true)
          // Check ref directly - no React state timing issues
          const newTrackId = spotifyNowPlayingRef.current?.trackId || ""
          if (newTrackId && newTrackId !== prevTrackId) return // track changed, done
          if (attempts < 5) window.setTimeout(() => { void probe() }, 600)
        }
        window.setTimeout(() => { void probe() }, 600)
      }
      return {
        ok: true,
        message: String(data?.message || ""),
        nowPlaying: data?.nowPlaying,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Spotify playback failed."
      setSpotifyError(message)
      if (message !== "Unauthorized") {
        void refreshSpotifyNowPlaying(true)
      } else {
        markSpotifyUnauthorized()
      }
      return { ok: false, error: message }
    } finally {
      setSpotifyBusyAction(null)
    }
  }, [markSpotifyUnauthorized, refreshSpotifyNowPlaying])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const initialSpotifyNowPlaying = normalizeSpotifyNowPlaying(cached.spotifyNowPlaying)
    const hasInitialSpotifySnapshot = Boolean(
      initialSpotifyNowPlaying.trackId
        || initialSpotifyNowPlaying.trackName
        || initialSpotifyNowPlaying.albumArtUrl
        || initialSpotifyNowPlaying.playing,
    )
    preserveSpotifyCacheUntilServerSyncRef.current = hasInitialSpotifySnapshot
    if (hasInitialSpotifySnapshot) {
      setSpotifyNowPlaying(initialSpotifyNowPlaying)
    }

    const local = loadIntegrationsSettings()
    applyLocalSettings(local)
    setIntegrationsHydrated(true)
  }, [applyLocalSettings])

  useEffect(() => {
    void fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        spotifyUnauthorizedRef.current = false
        spotifyUnauthorizedRedirectAtRef.current = 0
        preserveSpotifyCacheUntilServerSyncRef.current = false
        const config = data?.config || {}
        const provider = providerFromValue(config?.activeLlmProvider)
        setTelegramConnected(Boolean(config?.telegram?.connected))
        setDiscordConnected(Boolean(config?.discord?.connected))
        setSlackConnected(Boolean(config?.slack?.connected))
        setBraveConnected(Boolean(config?.brave?.connected))
        setCoinbaseConnected(Boolean(config?.coinbase?.connected))
        setOpenaiConnected(Boolean(config?.openai?.connected))
        setClaudeConnected(Boolean(config?.claude?.connected))
        setGrokConnected(Boolean(config?.grok?.connected))
        setGeminiConnected(Boolean(config?.gemini?.connected))
        const spotifyIsConnected = Boolean(config?.spotify?.connected)
        setSpotifyConnected(spotifyIsConnected)
        setYouTubeConnected(Boolean(config?.youtube?.connected))
        if (!spotifyIsConnected) {
          setSpotifyNowPlaying(null)
          setSpotifyError(null)
        } else {
          void refreshSpotifyNowPlaying(true)
        }
        setGmailConnected(Boolean(config?.gmail?.connected))
        setGcalendarConnected(Boolean(config?.gcalendar?.connected))
        setActiveLlmProvider(provider)
        setActiveLlmModel(modelForProvider(provider, config))
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "Unauthorized") {
          markSpotifyUnauthorized()
        }
        // Keep cached spotify snapshot visible if server sync fails during boot.
      })
      .finally(() => {
        preserveSpotifyCacheUntilServerSyncRef.current = false
      })
  }, [markSpotifyUnauthorized, refreshSpotifyNowPlaying])

  useEffect(() => {
    const onUpdate = () => {
      spotifyUnauthorizedRef.current = false
      spotifyUnauthorizedRedirectAtRef.current = 0
      preserveSpotifyCacheUntilServerSyncRef.current = false
      const local = loadIntegrationsSettings()
      applyLocalSettings(local)
      if (local.spotify?.connected) {
        void refreshSpotifyNowPlaying(true)
      } else {
        setSpotifyNowPlaying(null)
        setSpotifyError(null)
      }
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [applyLocalSettings, refreshSpotifyNowPlaying])

  // Stable polling loop — only restarts when connected state changes, not on every poll.
  // The loop is parked while the page is hidden and resumes with an immediate poll when the
  // page becomes visible or focused again. Poll cadence is read from refs, so no teardown per poll.
  const pollingTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const clearPollingTimer = () => {
      if (pollingTimerRef.current !== null) {
        window.clearTimeout(pollingTimerRef.current)
        pollingTimerRef.current = null
      }
    }

    if (!spotifyConnected) {
      clearPollingTimer()
      return
    }

    let cancelled = false
    let lastPollStartedAt = 0

    const isPageHidden = () => document.visibilityState === "hidden"

    const getNextIntervalMs = (): number => {
      const current = spotifyNowPlayingRef.current
      if (current?.playing) {
        const projectedProgressMs = expectedSpotifyProgressMs(current, spotifySnapshotAtRef.current, Date.now())
        const remainingMs = Math.max(0, (current.durationMs || 0) - projectedProgressMs)
        return remainingMs > 0 && remainingMs <= 5_000
          ? SPOTIFY_POLL_INTERVAL_PLAYING_NEAR_END_MS
          : SPOTIFY_POLL_INTERVAL_PLAYING_MS
      }
      return current?.trackId ? SPOTIFY_POLL_INTERVAL_PAUSED_WITH_TRACK_MS : SPOTIFY_POLL_INTERVAL_IDLE_MS
    }

    const scheduleNextPoll = () => {
      if (cancelled) return
      clearPollingTimer()
      // Hidden page: park the loop. The visibility/focus handler restarts it.
      if (isPageHidden()) return
      pollingTimerRef.current = window.setTimeout(() => {
        void runPollCycle()
      }, getNextIntervalMs())
    }

    const runPollCycle = async () => {
      if (cancelled) return
      if (isPageHidden()) {
        clearPollingTimer()
        return
      }
      // Suppress this poll if a play/pause command was just sent — prevents an in-flight
      // poll from reading stale Spotify state and overwriting the optimistic UI update.
      if (Date.now() < spotifyCommandSentAtRef.current + 2_500) {
        scheduleNextPoll()
        return
      }
      lastPollStartedAt = Date.now()
      await refreshSpotifyNowPlaying(true, { silent: true })
      scheduleNextPoll()
    }

    // Visibility/focus return: poll once right away (deduped) and restart the loop.
    const resumeOnForeground = () => {
      if (cancelled || isPageHidden()) return
      if (Date.now() - lastPollStartedAt < SPOTIFY_FOREGROUND_POLL_MIN_GAP_MS) {
        // A poll just ran; skip the duplicate but make sure the loop is not left parked after a
        // quick hide/show (the hidden handler cleared the timer).
        if (pollingTimerRef.current === null) scheduleNextPoll()
        return
      }
      clearPollingTimer()
      void runPollCycle()
    }

    const onVisibilityChange = () => {
      if (isPageHidden()) {
        clearPollingTimer()
        return
      }
      resumeOnForeground()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", resumeOnForeground)

    void runPollCycle()

    return () => {
      cancelled = true
      clearPollingTimer()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", resumeOnForeground)
    }
  }, [spotifyConnected, refreshSpotifyNowPlaying])

  const toggleSpotifyPlayback = useCallback(() => {
    if (spotifyNowPlaying?.playing) {
      void runSpotifyPlayback("pause")
    } else if (spotifyNowPlaying?.trackId) {
      // There is a known track (paused) — resume it
      void runSpotifyPlayback("play")
    } else {
      // Nothing is playing and no active track — use smart play (favorite playlist or liked songs)
      void runSpotifyPlayback("play_smart")
    }
  }, [runSpotifyPlayback, spotifyNowPlaying?.playing, spotifyNowPlaying?.trackId])

  const spotifyNextTrack = useCallback(() => {
    void runSpotifyPlayback("next")
  }, [runSpotifyPlayback])

  const spotifyPreviousTrack = useCallback(() => {
    void runSpotifyPlayback("previous")
  }, [runSpotifyPlayback])

  const spotifyPlaySmart = useCallback(() => {
    void runSpotifyPlayback("play_smart")
  }, [runSpotifyPlayback])

  const goToIntegrations = useCallback((setup?: IntegrationSetupKey) => {
    router.push(buildIntegrationsHref(setup))
  }, [router])

  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"

  const runningProvider = latestUsage?.provider
    ? providerFromValue(latestUsage.provider)
    : activeLlmProvider
  const runningModel = latestUsage?.model ?? activeLlmModel
  const hasAnyLlmConnected = openaiConnected || claudeConnected || grokConnected || geminiConnected
  const runningLabel = !latestUsage && !hasAnyLlmConnected
    ? "Needs Setup"
    : `${runningProvider === "claude" ? "Claude" : runningProvider === "grok" ? "Grok" : runningProvider === "gemini" ? "Gemini" : "OpenAI"} - ${runningModel || "N/A"}`

  return {
    runningLabel,
    integrationBadgeClass,
    telegramConnected,
    discordConnected,
    slackConnected,
    braveConnected,
    coinbaseConnected,
    phantomConnected,
    polymarketConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    spotifyConnected,
    youtubeConnected,
    spotifyNowPlaying,
    spotifyLoading,
    spotifyError,
    spotifyBusyAction,
    refreshSpotifyNowPlaying,
    toggleSpotifyPlayback,
    spotifyNextTrack,
    spotifyPreviousTrack,
    spotifyPlaySmart,
    seekSpotify,
    gmailConnected,
    gcalendarConnected,
    goToIntegrations,
  }
}



