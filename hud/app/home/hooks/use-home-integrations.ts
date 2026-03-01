"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  INTEGRATIONS_UPDATED_EVENT,
  loadIntegrationsSettings,
  type IntegrationsSettings,
  type LlmProvider,
} from "@/lib/integrations/client-store"
import { resolveTimezone } from "@/lib/shared/timezone"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { compareMissionPriority, parseMissionWorkflowMeta } from "../helpers"
import type { MissionSummary, NotificationSchedule } from "./types"

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

function launchSpotifyDesktopApp(): void {
  try {
    const iframe = document.createElement("iframe")
    iframe.style.display = "none"
    iframe.setAttribute("aria-hidden", "true")
    iframe.src = "spotify:"
    document.body.appendChild(iframe)
    window.setTimeout(() => {
      iframe.remove()
    }, 1200)
    return
  } catch {}

  try {
    window.location.assign("spotify:")
  } catch {}
}

const SPOTIFY_LAUNCH_TTS_LINES = [
  "Launching Spotify now, what would you like to hear?",
  "Opening Spotify for you. Just tell me what to play.",
  "Spotify is starting up. Let me know what you'd like to listen to.",
  "Absolutely, launching Spotify now. What should I put on?",
  "On it, Spotify is opening. What are we listening to?",
]
const SPOTIFY_DESKTOP_LAUNCH_COOLDOWN_MS = 20_000
const SPOTIFY_DEVICE_WARMUP_MS = 12_000
const SPOTIFY_POLL_INTERVAL_PLAYING_MS = 2_000
const SPOTIFY_POLL_INTERVAL_PLAYING_NEAR_END_MS = 1_000
const SPOTIFY_POLL_INTERVAL_PAUSED_WITH_TRACK_MS = 5_000
const SPOTIFY_POLL_INTERVAL_IDLE_MS = 8_000
const SPOTIFY_REQUEST_TIMEOUT_MS = 12_000

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = SPOTIFY_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutHandle = window.setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs))
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
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

export function useHomeIntegrations({ latestUsage, speakTts }: UseHomeIntegrationsInput) {
  const router = useRouter()
  const cachedShellUi = readShellUiCache()
  const initialSpotifyNowPlaying = normalizeSpotifyNowPlaying(cachedShellUi.spotifyNowPlaying)
  const hasInitialSpotifySnapshot = Boolean(
    initialSpotifyNowPlaying.trackId
      || initialSpotifyNowPlaying.trackName
      || initialSpotifyNowPlaying.albumArtUrl
      || initialSpotifyNowPlaying.playing,
  )
  const initialSpotifyConnectedFromCache = Boolean(initialSpotifyNowPlaying.connected || hasInitialSpotifySnapshot)
  const initialIntegrations = loadIntegrationsSettings()

  const [notificationSchedules, setNotificationSchedules] = useState<NotificationSchedule[]>(() => {
    const cached = readShellUiCache().missionSchedules
    return Array.isArray(cached) ? (cached as NotificationSchedule[]) : []
  })
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [discordConnected, setDiscordConnected] = useState(false)
  const [braveConnected, setBraveConnected] = useState(false)
  const [coinbaseConnected, setCoinbaseConnected] = useState(false)
  const [openaiConnected, setOpenaiConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [grokConnected, setGrokConnected] = useState(false)
  const [geminiConnected, setGeminiConnected] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(
    Boolean(initialIntegrations.spotify?.connected || initialSpotifyConnectedFromCache),
  )
  const [spotifyNowPlaying, setSpotifyNowPlaying] = useState<HomeSpotifyNowPlaying | null>(
    () => (hasInitialSpotifySnapshot ? initialSpotifyNowPlaying : null),
  )
  // Stable ref always pointing at latest nowPlaying — safe to read inside callbacks without deps
  const spotifyNowPlayingRef = useRef<HomeSpotifyNowPlaying | null>(null)
  // Stable ref for connected — avoids refreshSpotifyNowPlaying re-creation on connect change
  const spotifyConnectedRef = useRef(false)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [spotifyBusyAction, setSpotifyBusyAction] = useState<SpotifyPlaybackAction | null>(null)
  const lastSpotifyDesktopLaunchAtRef = useRef(0)
  const spotifyDeviceWarmupUntilRef = useRef(0)
  const preserveSpotifyCacheUntilServerSyncRef = useRef(hasInitialSpotifySnapshot)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gcalendarConnected, setGcalendarConnected] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [activeLlmModel, setActiveLlmModel] = useState("gpt-4.1")

  // Keep refs in sync
  useEffect(() => { spotifyNowPlayingRef.current = spotifyNowPlaying }, [spotifyNowPlaying])
  useEffect(() => { spotifyConnectedRef.current = spotifyConnected }, [spotifyConnected])
  useEffect(() => {
    writeShellUiCache({ spotifyNowPlaying: spotifyNowPlaying ?? null })
  }, [spotifyNowPlaying])

  const applyLocalSettings = useCallback((settings: IntegrationsSettings) => {
    setTelegramConnected(settings.telegram.connected)
    setDiscordConnected(settings.discord.connected)
    setBraveConnected(settings.brave.connected)
    setCoinbaseConnected(Boolean(settings.coinbase?.connected))
    setOpenaiConnected(settings.openai.connected)
    setClaudeConnected(settings.claude.connected)
    setGrokConnected(settings.grok.connected)
    setGeminiConnected(settings.gemini.connected)
    const spotifyIsConnected = Boolean(settings.spotify?.connected)
    setSpotifyConnected(spotifyIsConnected)
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

  const refreshNotificationSchedules = useCallback(() => {
    void fetch("/api/notifications/schedules", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const schedules = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
        setNotificationSchedules(schedules)
        writeShellUiCache({ missionSchedules: schedules })
      })
      .catch(() => {
        const cached = readShellUiCache().missionSchedules
        if (Array.isArray(cached) && cached.length > 0) {
          setNotificationSchedules(cached as NotificationSchedule[])
          return
        }
        setNotificationSchedules([])
      })
  }, [router])

  // Stable callback — uses refs so it never needs to be re-created when state changes.
  // This prevents the polling interval from being torn down on every poll response.
  const refreshSpotifyNowPlaying = useCallback(async (connectedHint?: boolean) => {
    const shouldFetch = typeof connectedHint === "boolean" ? connectedHint : spotifyConnectedRef.current
    if (!shouldFetch) {
      setSpotifyNowPlaying(null)
      setSpotifyLoading(false)
      setSpotifyError(null)
      return
    }

    setSpotifyLoading(true)
    try {
      const { res, data } = await fetchJsonWithTimeout("/api/integrations/spotify/now-playing", {
        cache: "no-store",
        credentials: "include",
      })
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/home")}`)
        throw new Error("Unauthorized")
      }
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to read Spotify status."))
      }
      setSpotifyConnected(Boolean(data?.connected))
      setSpotifyNowPlaying(normalizeSpotifyNowPlaying(data?.nowPlaying))
      setSpotifyError(null)
    } catch (error) {
      setSpotifyNowPlaying((prev) => prev ?? EMPTY_SPOTIFY_NOW_PLAYING)
      setSpotifyError(error instanceof Error ? error.message : "Failed to read Spotify status.")
    } finally {
      setSpotifyLoading(false)
    }
  }, [router])

  const seekSpotify = useCallback(async (positionMs: number): Promise<void> => {
    setSpotifyNowPlaying((prev) => prev ? { ...prev, progressMs: positionMs } : prev)
    try {
      const { res, data } = await fetchJsonWithTimeout("/api/integrations/spotify/playback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seek", positionMs }),
      })
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || "Seek failed."))
    } catch {
      void refreshSpotifyNowPlaying(true)
    }
  }, [refreshSpotifyNowPlaying])

  const spotifyRetryTimerRef = useRef<number | null>(null)
  // After a play/pause command, suppress poll cycles for this many ms to prevent
  // an in-flight poll from overwriting the optimistic state before Spotify propagates.
  const spotifyCommandSentAtRef = useRef(0)

  const runSpotifyPlayback = useCallback(async (action: SpotifyPlaybackAction, _isRetry = false): Promise<SpotifyPlaybackResponse> => {
    const isStartAction = action === "play" || action === "play_liked" || action === "play_smart"
    if (!_isRetry && isStartAction && Date.now() < spotifyDeviceWarmupUntilRef.current) {
      return { ok: false, error: "Spotify is launching. Please wait a moment." }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/home")}`)
        throw new Error("Unauthorized")
      }
      if (!res.ok || !data?.ok) {
        if (data?.code === "spotify.device_unavailable" || data?.fallbackRecommended) {
          const now = Date.now()
          const retryAfterMs = Number.isFinite(Number(data?.retryAfterMs))
            ? Math.max(0, Math.floor(Number(data.retryAfterMs)))
            : 0
          if (now - lastSpotifyDesktopLaunchAtRef.current >= SPOTIFY_DESKTOP_LAUNCH_COOLDOWN_MS) {
            lastSpotifyDesktopLaunchAtRef.current = now
            launchSpotifyDesktopApp()
            if (speakTts) {
              const line = SPOTIFY_LAUNCH_TTS_LINES[Math.floor(Math.random() * SPOTIFY_LAUNCH_TTS_LINES.length)]
              speakTts(line)
            }
          }
          spotifyDeviceWarmupUntilRef.current = Math.max(
            spotifyDeviceWarmupUntilRef.current,
            now + Math.max(retryAfterMs, SPOTIFY_DEVICE_WARMUP_MS),
          )
          if (!_isRetry && action !== "pause") {
            if (spotifyRetryTimerRef.current !== null) window.clearTimeout(spotifyRetryTimerRef.current)
            const autoRetryMs = Math.max(2_500, Math.min(8_000, retryAfterMs || 4_000))
            spotifyRetryTimerRef.current = window.setTimeout(() => {
              spotifyRetryTimerRef.current = null
              void runSpotifyPlayback(action, true)
            }, autoRetryMs)
            return { ok: false, error: "Launching Spotify — will retry automatically." }
          }
        }
        throw new Error(String(data?.error || data?.message || `Spotify action ${action} failed.`))
      }
      spotifyDeviceWarmupUntilRef.current = 0
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
      // Read prevTrackId from ref — always accurate, no stale closure issue.
      // Note: plain "play" (resume) is excluded — trackId won't change, polling is wasteful.
      if ((action === "next" || action === "previous" || action === "play_liked" || action === "play_smart") && data?.skipNowPlayingRefresh) {
        const prevTrackId = spotifyNowPlayingRef.current?.trackId || ""
        let attempts = 0
        const probe = async () => {
          attempts++
          await refreshSpotifyNowPlaying(true)
          // Check ref directly — no React state timing issues
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
      void refreshSpotifyNowPlaying(true)
      return { ok: false, error: message }
    } finally {
      setSpotifyBusyAction(null)
    }
  }, [refreshSpotifyNowPlaying, router, speakTts])

  useLayoutEffect(() => {
    const local = loadIntegrationsSettings()
    applyLocalSettings(local)
    setIntegrationsHydrated(true)
  }, [applyLocalSettings])

  useEffect(() => {
    void fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        preserveSpotifyCacheUntilServerSyncRef.current = false
        const config = data?.config || {}
        const provider = providerFromValue(config?.activeLlmProvider)
        setTelegramConnected(Boolean(config?.telegram?.connected))
        setDiscordConnected(Boolean(config?.discord?.connected))
        setBraveConnected(Boolean(config?.brave?.connected))
        setCoinbaseConnected(Boolean(config?.coinbase?.connected))
        setOpenaiConnected(Boolean(config?.openai?.connected))
        setClaudeConnected(Boolean(config?.claude?.connected))
        setGrokConnected(Boolean(config?.grok?.connected))
        setGeminiConnected(Boolean(config?.gemini?.connected))
        const spotifyIsConnected = Boolean(config?.spotify?.connected)
        setSpotifyConnected(spotifyIsConnected)
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
      .catch(() => {
        // Keep cached spotify snapshot visible if server sync fails during boot.
      })
      .finally(() => {
        preserveSpotifyCacheUntilServerSyncRef.current = false
      })

    refreshNotificationSchedules()
  }, [refreshNotificationSchedules, refreshSpotifyNowPlaying, router])

  useEffect(() => {
    const onUpdate = () => {
      preserveSpotifyCacheUntilServerSyncRef.current = false
      const local = loadIntegrationsSettings()
      applyLocalSettings(local)
      refreshNotificationSchedules()
      if (local.spotify?.connected) {
        void refreshSpotifyNowPlaying(true)
      } else {
        setSpotifyNowPlaying(null)
        setSpotifyError(null)
      }
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [applyLocalSettings, refreshNotificationSchedules, refreshSpotifyNowPlaying])

  useEffect(() => {
    if (!spotifyConnected) return

    const refreshOnForeground = () => {
      if (document.visibilityState === "visible" && Date.now() >= spotifyCommandSentAtRef.current + 2_500) {
        void refreshSpotifyNowPlaying(true)
      }
    }

    const onFocus = () => {
      if (Date.now() >= spotifyCommandSentAtRef.current + 2_500) {
        void refreshSpotifyNowPlaying(true)
      }
    }

    document.addEventListener("visibilitychange", refreshOnForeground)
    window.addEventListener("focus", onFocus)
    return () => {
      document.removeEventListener("visibilitychange", refreshOnForeground)
      window.removeEventListener("focus", onFocus)
    }
  }, [spotifyConnected, refreshSpotifyNowPlaying])

  // Stable polling interval — only restarts when connected state changes, not on every poll.
  // Playing/paused rate is read from ref inside the interval so no teardown needed.
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

    const getNextIntervalMs = (): number => {
      const current = spotifyNowPlayingRef.current
      if (current?.playing) {
        const remainingMs = Math.max(0, (current.durationMs || 0) - (current.progressMs || 0))
        return remainingMs > 0 && remainingMs <= 5_000
          ? SPOTIFY_POLL_INTERVAL_PLAYING_NEAR_END_MS
          : SPOTIFY_POLL_INTERVAL_PLAYING_MS
      }
      return current?.trackId ? SPOTIFY_POLL_INTERVAL_PAUSED_WITH_TRACK_MS : SPOTIFY_POLL_INTERVAL_IDLE_MS
    }

    const scheduleNextPoll = () => {
      if (cancelled) return
      clearPollingTimer()
      pollingTimerRef.current = window.setTimeout(() => {
        void runPollCycle()
      }, getNextIntervalMs())
    }

    const runPollCycle = async () => {
      if (cancelled) return
      // Suppress this poll if a play/pause command was just sent — prevents an in-flight
      // poll from reading stale Spotify state and overwriting the optimistic UI update.
      if (Date.now() < spotifyCommandSentAtRef.current + 2_500) {
        scheduleNextPoll()
        return
      }
      await refreshSpotifyNowPlaying(true)
      scheduleNextPoll()
    }

    void runPollCycle()

    return () => {
      cancelled = true
      clearPollingTimer()
      if (spotifyRetryTimerRef.current !== null) {
        window.clearTimeout(spotifyRetryTimerRef.current)
        spotifyRetryTimerRef.current = null
      }
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

  const goToIntegrations = useCallback(() => router.push("/integrations"), [router])

  const missions = useMemo<MissionSummary[]>(() => {
    const grouped = new Map<string, MissionSummary>()

    for (const schedule of notificationSchedules) {
      const meta = parseMissionWorkflowMeta(schedule.message)
      const title = schedule.label?.trim() || "Scheduled notification"
      const integration = schedule.integration?.trim().toLowerCase() || "unknown"
      const key = `${integration}:${title.toLowerCase()}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: schedule.id,
          integration,
          title,
          description: meta.description,
          priority: meta.priority,
          enabledCount: schedule.enabled ? 1 : 0,
          totalCount: 1,
          times: [schedule.time],
          timezone: resolveTimezone(schedule.timezone),
        })
        continue
      }

      existing.totalCount += 1
      if (schedule.enabled) existing.enabledCount += 1
      existing.times.push(schedule.time)
      if (!existing.description && meta.description) existing.description = meta.description
      if (compareMissionPriority(meta.priority, existing.priority) > 0) existing.priority = meta.priority
    }

    return Array.from(grouped.values())
      .map((mission) => ({ ...mission, times: mission.times.sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => {
        const activeDelta = Number(b.enabledCount > 0) - Number(a.enabledCount > 0)
        if (activeDelta !== 0) return activeDelta
        return b.totalCount - a.totalCount
      })
  }, [notificationSchedules])

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
    missions,
    runningLabel,
    integrationBadgeClass,
    telegramConnected,
    discordConnected,
    braveConnected,
    coinbaseConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    spotifyConnected,
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
