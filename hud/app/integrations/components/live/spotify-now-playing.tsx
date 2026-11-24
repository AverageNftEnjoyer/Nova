"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Pause, Play, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react"

import { SpotifyIcon } from "@/components/icons"
import { Badge, Button, EmptyState, IconButton, Tooltip } from "@/components/ui"
import { cn } from "@/lib/shared/utils"

/** A now-playing snapshot from /api/integrations/spotify/now-playing. */
export interface SpotifyNowPlayingState {
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

interface SpotifyNowPlayingProps {
  connected: boolean
  connecting: boolean
  nowPlaying: SpotifyNowPlayingState | null
  error: string | null
  busyAction: string | null
  onConnectSpotify: () => void
  onOpenIntegrations: () => void
  onTogglePlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onPlaySmart: () => void
  onSeek: (positionMs: number) => void
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

/**
 * Spotify playback: the current track with small album art, a seek bar, transport controls (shuffle from favourites,
 * previous, play/pause, next, repeat track) and errors that say what to do.
 */
export function SpotifyNowPlaying({
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
}: SpotifyNowPlayingProps) {
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

  if (!connected) {
    return (
      <EmptyState
        size="compact"
        icon={<SpotifyIcon className="size-5" />}
        title="Spotify is not connected"
        description={error || "Connect Spotify to see what is playing and control playback from Nova."}
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={onConnectSpotify} loading={connecting}>
              Connect Spotify
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenIntegrations}>
              Open setup
            </Button>
          </div>
        }
      />
    )
  }

  const hasTrack = Boolean(nowPlaying?.trackName)
  const subtitle = timedOut
    ? "Reconnecting to Spotify..."
    : hasTrack
      ? [nowPlaying?.artistName, nowPlaying?.deviceName ? `on ${nowPlaying.deviceName}` : ""].filter(Boolean).join(" ")
      : "Start playback on any Spotify device, or shuffle your favourites."
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-2">
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt={nowPlaying?.albumName ? `${nowPlaying.albumName} cover` : "Album cover"} className="size-full object-cover" />
          ) : (
            <SpotifyIcon className="size-5" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-fg">{hasTrack ? nowPlaying?.trackName : "Nothing playing"}</p>
            {playing ? <Badge tone="success" dot="pulse">Playing</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span ref={timeRef} className="w-10 shrink-0 text-right font-mono text-2xs tabular-nums text-muted" />
          <div
            ref={barRef}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            // Initial value; the live position is written to this attribute once a second by paint().
            aria-valuenow={nowPlaying && nowPlaying.durationMs > 0 ? Math.round((nowPlaying.progressMs / nowPlaying.durationMs) * 100) : 0}
            aria-disabled={!nowPlaying?.durationMs}
            onPointerDown={handleSeekDown}
            onKeyDown={handleSeekKey}
            className="group relative flex h-4 min-w-0 flex-1 cursor-pointer touch-none select-none items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default"
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div ref={fillRef} className="absolute inset-y-0 left-0 bg-muted group-hover:bg-accent" />
            </div>
            <div
              ref={thumbRef}
              className={cn(
                "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-fg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
                seekDragPct !== null && "opacity-100",
              )}
            />
          </div>
          <span className="w-10 shrink-0 font-mono text-2xs tabular-nums text-muted">{formatTime(nowPlaying?.durationMs || 0)}</span>
        </div>

        <div className="flex items-center justify-center gap-1">
          <Tooltip content="Shuffle from your favourite playlist">
            <IconButton aria-label="Shuffle from favourite playlist" onClick={onPlaySmart} disabled={busy}>
              <Shuffle />
            </IconButton>
          </Tooltip>
          <Tooltip content="Previous track">
            <IconButton aria-label="Previous track" onClick={onPrevious} disabled={busy}>
              <SkipBack />
            </IconButton>
          </Tooltip>
          <IconButton
            variant="primary"
            size="lg"
            className="rounded-full"
            aria-label={deviceUnavailable ? "Launch Spotify" : playing ? "Pause" : "Play"}
            onClick={onTogglePlayPause}
            disabled={busy && !deviceUnavailable}
          >
            {deviceUnavailable ? <SpotifyIcon className="size-4" /> : playing ? <Pause /> : <Play />}
          </IconButton>
          <Tooltip content="Next track">
            <IconButton aria-label="Next track" onClick={onNext} disabled={busy}>
              <SkipForward />
            </IconButton>
          </Tooltip>
          <Tooltip content={repeatTrack ? "Repeat track: on" : "Repeat track: off"}>
            <IconButton
              aria-label="Repeat track"
              aria-pressed={repeatTrack}
              onClick={() => setRepeatTrack((value) => !value)}
              className={cn(repeatTrack && "bg-accent-muted text-accent-text")}
            >
              <Repeat1 />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {deviceUnavailable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-muted px-3 py-2 text-sm text-fg">
          <span>No active Spotify device. Open Spotify on this computer, then press play.</span>
          <Button size="sm" variant="outline" asChild>
            <a href="spotify:">Open Spotify</a>
          </Button>
        </div>
      ) : error && !timedOut ? (
        <p role="alert" className="text-xs text-danger" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
