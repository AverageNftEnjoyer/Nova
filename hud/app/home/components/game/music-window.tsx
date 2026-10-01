"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Pause, Play, RefreshCw, Shuffle, SkipBack, SkipForward } from "lucide-react"
import { SpotifyIcon } from "@/components/icons"
import { EqualizerBars } from "@/components/equalizer-bars"
import type { HomeSpotifyNowPlaying } from "../../hooks/use-home-integrations"
import { PixelWindow } from "../pixel/pixel-window"

interface MusicWindowProps {
  connected: boolean
  connecting: boolean
  nowPlaying: HomeSpotifyNowPlaying | null
  error: string | null
  busyAction: string | null
  onConnectSpotify: () => void
  onOpenIntegrations: () => void
  onTogglePlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onPlaySmart: () => void
  onSeek: (positionMs: number) => void
  onClose: () => void
}

/** Progress is written straight to the DOM once a second (no React state), and only while the page is visible. */
const PROGRESS_TICK_MS = 1_000

interface ProgressSnapshot {
  advancing: boolean
  progressMs: number
  durationMs: number
  trackId: string
  at: number
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function projectProgressMs(snapshot: ProgressSnapshot, now: number): number {
  if (snapshot.durationMs <= 0) return 0
  const projected = snapshot.advancing ? snapshot.progressMs + Math.max(0, now - snapshot.at) : snapshot.progressMs
  return Math.max(0, Math.min(snapshot.durationMs, projected))
}

/** The music popup opened from the HUD: every Spotify control the old footer bar had (connect, setup, shuffle-from-favorites, previous, play/pause, next, repeat, seek, launch, errors). */
export function MusicWindow({
  connected,
  connecting,
  nowPlaying,
  error,
  busyAction,
  onConnectSpotify,
  onOpenIntegrations,
  onTogglePlayPause,
  onNext,
  onPrevious,
  onPlaySmart,
  onSeek,
  onClose,
}: MusicWindowProps) {
  const [repeatTrack, setRepeatTrack] = useState(false)
  const [seekDragPct, setSeekDragPct] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const snapshotRef = useRef<ProgressSnapshot>({ advancing: false, progressMs: 0, durationMs: 0, trackId: "", at: 0 })
  const dragRef = useRef<number | null>(null)
  const repeatRef = useRef(false)
  const repeatFiredRef = useRef(false)
  const onSeekRef = useRef(onSeek)

  const playing = Boolean(connected && nowPlaying?.playing)
  const deviceUnavailable = Boolean(error && /device|playback device/i.test(error))
  const timedOut = Boolean(error && /timed out/i.test(error))

  const paint = useCallback(() => {
    const snapshot = snapshotRef.current
    const drag = dragRef.current
    const liveMs = projectProgressMs(snapshot, Date.now())
    const pct = drag !== null ? drag * 100 : snapshot.durationMs > 0 ? (liveMs / snapshot.durationMs) * 100 : 0
    const width = `${pct}%`
    if (fillRef.current) fillRef.current.style.width = width
    if (thumbRef.current) thumbRef.current.style.left = width
    barRef.current?.setAttribute("aria-valuenow", String(Math.round(pct)))
    if (timeRef.current) timeRef.current.textContent = formatTime(drag !== null ? drag * snapshot.durationMs : liveMs)
    // Repeat: seek back to the start once when the track ends.
    if (repeatRef.current && snapshot.advancing && snapshot.durationMs > 0 && liveMs >= snapshot.durationMs && !repeatFiredRef.current) {
      repeatFiredRef.current = true
      onSeekRef.current(0)
    }
  }, [])

  useLayoutEffect(() => {
    const prev = snapshotRef.current
    const advancing = Boolean(connected && nowPlaying?.playing && (nowPlaying?.durationMs || 0) > 0)
    const progressMs = nowPlaying?.progressMs || 0
    const durationMs = nowPlaying?.durationMs || 0
    const trackId = nowPlaying?.trackId || ""
    if (prev.advancing !== advancing || prev.progressMs !== progressMs || prev.durationMs !== durationMs || prev.trackId !== trackId) {
      snapshotRef.current = { advancing, progressMs, durationMs, trackId, at: Date.now() }
    }
    if (trackId && prev.trackId !== trackId) repeatFiredRef.current = false
    dragRef.current = seekDragPct
    repeatRef.current = repeatTrack
    onSeekRef.current = onSeek
    paint()
  })

  useEffect(() => {
    if (!playing || (nowPlaying?.durationMs || 0) <= 0) return
    let interval: number | null = null
    const start = () => {
      if (interval === null) interval = window.setInterval(paint, PROGRESS_TICK_MS)
    }
    const stop = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return stop()
      paint()
      start()
    }
    if (document.visibilityState !== "hidden") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [playing, nowPlaying?.durationMs, nowPlaying?.trackId, nowPlaying?.progressMs, paint])

  const pctFromX = (clientX: number): number => {
    const bar = barRef.current
    if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }

  const handleSeekDown = (event: React.PointerEvent) => {
    const duration = nowPlaying?.durationMs || 0
    if (!duration) return
    event.preventDefault()
    setSeekDragPct(pctFromX(event.clientX))
    const onMove = (ev: PointerEvent) => setSeekDragPct(pctFromX(ev.clientX))
    const onUp = (ev: PointerEvent) => {
      setSeekDragPct(null)
      onSeek(Math.floor(pctFromX(ev.clientX) * duration))
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const handleSeekKey = (event: React.KeyboardEvent) => {
    const duration = nowPlaying?.durationMs || 0
    if (!duration) return
    const step = event.key === "ArrowRight" ? 5_000 : event.key === "ArrowLeft" ? -5_000 : 0
    if (!step) return
    event.preventDefault()
    onSeek(Math.max(0, Math.min(duration, projectProgressMs(snapshotRef.current, Date.now()) + step)))
  }

  const busy = Boolean(busyAction)
  const art = nowPlaying?.albumArtUrl || ""

  return (
    <PixelWindow place="Music" role="Spotify" theme="default" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden border-2 border-(--px-border) bg-(--px-bg-2)">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={art} alt="Album art" className="h-full w-full object-cover [image-rendering:pixelated]" />
            ) : (
              <SpotifyIcon className="absolute inset-0 m-auto h-8 w-8" />
            )}
          </div>
          {!connected ? (
            <div className="min-w-0">
              <p className="pixel-label text-(--px-text)">Spotify disconnected</p>
              <p className="font-pixel mt-1 text-[14px] leading-snug text-(--px-muted)">{error || "Connect Spotify to play music over the city."}</p>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <EqualizerBars isPlaying={playing} className="h-3 shrink-0" />
                <p className="font-pixel truncate text-[17px] leading-tight text-(--px-text)">{nowPlaying?.trackName || "No active track"}</p>
              </div>
              <p className="font-pixel mt-1 truncate text-[14px] leading-tight text-(--px-muted)">
                {timedOut ? "Reconnecting Spotify..." : nowPlaying?.artistName || "Start playback on a Spotify device."}
              </p>
            </div>
          )}
        </div>

        {!connected ? (
          <div className="flex gap-2">
            <button type="button" onClick={onConnectSpotify} disabled={connecting} className="pixel-chip disabled:cursor-wait disabled:opacity-60">
              {connecting ? "Opening..." : "Connect"}
            </button>
            <button type="button" onClick={onOpenIntegrations} className="pixel-chip">
              Setup
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={onPlaySmart} disabled={busy} className="pixel-chip pixel-chip--icon" aria-label="Play from favorite playlist" title="Play from favorite playlist">
                <Shuffle className="h-4 w-4" />
              </button>
              <button type="button" onClick={onPrevious} disabled={busy} className="pixel-chip pixel-chip--icon" aria-label="Previous track">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePlayPause}
                disabled={busy && !deviceUnavailable}
                data-active="true"
                className="pixel-chip pixel-chip--icon h-11! w-11!"
                aria-label={deviceUnavailable ? "Launch Spotify" : playing ? "Pause Spotify" : "Play Spotify"}
                title={deviceUnavailable ? "Launch Spotify" : undefined}
              >
                {deviceUnavailable ? <SpotifyIcon className="h-5 w-5" /> : playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button type="button" onClick={onNext} disabled={busy} className="pixel-chip pixel-chip--icon" aria-label="Next track">
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setRepeatTrack((value) => !value)}
                data-active={repeatTrack}
                className="pixel-chip pixel-chip--icon"
                aria-label={repeatTrack ? "Disable repeat" : "Repeat song"}
                title={repeatTrack ? "Repeat: on" : "Repeat: off"}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span ref={timeRef} className="font-pixel w-10 shrink-0 text-right text-[13px] tabular-nums text-(--px-muted)" />
              <div
                ref={barRef}
                role="slider"
                tabIndex={0}
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={100}
                // Initial value; the live position is written to this attribute once a second by paint().
                aria-valuenow={nowPlaying && nowPlaying.durationMs > 0 ? Math.round((nowPlaying.progressMs / nowPlaying.durationMs) * 100) : 0}
                onPointerDown={handleSeekDown}
                onKeyDown={handleSeekKey}
                data-dragging={seekDragPct !== null}
                className="pixel-seek min-w-0 flex-1 select-none"
              >
                <div ref={fillRef} className="pixel-seek-fill" />
                <div ref={thumbRef} className="pixel-seek-thumb" />
              </div>
              <span className="font-pixel w-10 shrink-0 text-[13px] tabular-nums text-(--px-muted)">{formatTime(nowPlaying?.durationMs || 0)}</span>
            </div>

            {deviceUnavailable ? (
              <a href="spotify:" className="pixel-chip self-start">
                Launch Spotify
              </a>
            ) : error && !timedOut ? (
              <p className="font-pixel text-[13px] text-(--px-red)" title={error}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </PixelWindow>
  )
}
