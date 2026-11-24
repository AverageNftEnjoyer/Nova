"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { SpotifyNowPlayingState } from "../components/live/spotify-now-playing"

export type SpotifyPlaybackCommand = "play" | "pause" | "next" | "previous" | "play_smart"

const POLL_PLAYING_MS = 4_000
const POLL_IDLE_MS = 8_000
const REQUEST_TIMEOUT_MS = 12_000
const EXPIRED_MESSAGE = "Spotify session expired. Reconnect Spotify on the Setup tab."

function normalizeNowPlaying(raw: unknown): SpotifyNowPlayingState | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Partial<Record<keyof SpotifyNowPlayingState, unknown>>
  const text = (input: unknown) => String(input ?? "").trim()
  const ms = (input: unknown) => (Number.isFinite(Number(input)) ? Math.max(0, Math.floor(Number(input))) : 0)
  return {
    connected: Boolean(value.connected),
    playing: Boolean(value.playing),
    progressMs: ms(value.progressMs),
    durationMs: ms(value.durationMs),
    trackId: text(value.trackId),
    trackName: text(value.trackName),
    artistName: text(value.artistName),
    albumName: text(value.albumName),
    albumArtUrl: text(value.albumArtUrl),
    deviceId: text(value.deviceId),
    deviceName: text(value.deviceName),
  }
}

async function requestJson(input: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(input, { cache: "no-store", credentials: "include", ...init, signal: controller.signal })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, ok: res.ok && data?.ok !== false, data }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Spotify request timed out.")
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

/**
 * Live Spotify state for the Integrations "Live" tab: polls now-playing while the tab is visible (faster while a track
 * plays) and sends playback commands through /api/integrations/spotify/playback.
 */
export function useSpotifyPlayback(connected: boolean) {
  const [nowPlaying, setNowPlaying] = useState<SpotifyNowPlayingState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<SpotifyPlaybackCommand | "seek" | null>(null)
  const [loading, setLoading] = useState(connected)
  const expiredRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!connected || expiredRef.current) return
    try {
      const { status, ok, data } = await requestJson("/api/integrations/spotify/now-playing")
      if (status === 401) {
        expiredRef.current = true
        setNowPlaying(null)
        setError(EXPIRED_MESSAGE)
        return
      }
      if (!ok) throw new Error(String(data?.error || "Could not read Spotify playback."))
      setNowPlaying(normalizeNowPlaying(data?.nowPlaying))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read Spotify playback.")
    } finally {
      setLoading(false)
    }
  }, [connected])

  const playing = Boolean(nowPlaying?.playing)
  useEffect(() => {
    if (!connected) {
      setNowPlaying(null)
      setLoading(false)
      return
    }
    let timer: number | null = null
    let stopped = false
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh()
      if (!stopped) timer = window.setTimeout(tick, playing ? POLL_PLAYING_MS : POLL_IDLE_MS)
    }
    void tick()
    return () => {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [connected, playing, refresh])

  const send = useCallback(
    async (action: SpotifyPlaybackCommand | "seek", extra?: Record<string, unknown>) => {
      if (expiredRef.current) {
        setError(EXPIRED_MESSAGE)
        return
      }
      setBusyAction(action)
      setError(null)
      if (action === "pause") setNowPlaying((prev) => (prev ? { ...prev, playing: false } : prev))
      if (action === "play") setNowPlaying((prev) => (prev ? { ...prev, playing: true } : prev))
      if (action === "seek" && typeof extra?.positionMs === "number") {
        const positionMs = extra.positionMs
        setNowPlaying((prev) => (prev ? { ...prev, progressMs: positionMs } : prev))
      }
      try {
        const { status, ok, data } = await requestJson("/api/integrations/spotify/playback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        })
        if (status === 401) {
          expiredRef.current = true
          setError(EXPIRED_MESSAGE)
          return
        }
        if (!ok) throw new Error(String(data?.error || data?.message || "Spotify did not accept the command."))
        const next = normalizeNowPlaying(data?.nowPlaying)
        if (next) setNowPlaying(next)
        else window.setTimeout(() => void refresh(), 700)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Spotify did not accept the command.")
        void refresh()
      } finally {
        setBusyAction(null)
      }
    },
    [refresh],
  )

  return {
    nowPlaying,
    loading,
    error,
    busyAction,
    togglePlayPause: () => void send(nowPlaying?.playing ? "pause" : "play"),
    next: () => void send("next"),
    previous: () => void send("previous"),
    playSmart: () => void send("play_smart"),
    seek: (positionMs: number) => void send("seek", { positionMs }),
  }
}
