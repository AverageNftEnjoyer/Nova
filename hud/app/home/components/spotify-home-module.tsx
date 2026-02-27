"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { RefreshCw, Shuffle, SkipBack, SkipForward } from "lucide-react"

import { SpotifyIcon } from "@/components/icons"
import { EqualizerBars } from "@/components/equalizer-bars"
import { cn } from "@/lib/shared/utils"
import type { HomeSpotifyNowPlaying } from "../hooks/use-home-integrations"
import { useAlbumColors } from "../hooks/use-album-colors"

interface SpotifyHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  sectionRef?: RefObject<HTMLElement | null>
  connected: boolean
  nowPlaying: HomeSpotifyNowPlaying | null
  error: string | null
  busyAction: string | null
  onOpenIntegrations: () => void
  onTogglePlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onPlayLiked: () => void
  onSeek: (positionMs: number) => void
}

function formatTimeFromMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function progressPercent(nowPlaying: HomeSpotifyNowPlaying | null): number {
  if (!nowPlaying || nowPlaying.durationMs <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((nowPlaying.progressMs / nowPlaying.durationMs) * 100)))
}

export function SpotifyHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  sectionRef,
  connected,
  nowPlaying,
  error,
  busyAction,
  onOpenIntegrations,
  onTogglePlayPause,
  onNext,
  onPrevious,
  onPlayLiked,
  onSeek,
}: SpotifyHomeModuleProps) {
  const [liveProgressMs, setLiveProgressMs] = useState(() => nowPlaying?.progressMs || 0)
  const [repeatTrack, setRepeatTrack] = useState(false)
  const [seekDragPct, setSeekDragPct] = useState<number | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  // Track when the last nowPlaying snapshot arrived so we can extrapolate progress
  const lastSnapshotAt = useRef<number>(0)

  const albumColors = useAlbumColors(nowPlaying?.albumArtUrl)

  // Per-track random timing — stable across re-renders for the same track
  const glowTiming = useMemo(() => {
    const seed = nowPlaying?.trackId || "default"
    // Deterministic pseudo-random from track ID string
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
    const rand = (min: number, max: number, offset: number) => {
      const x = Math.sin(h + offset) * 10000
      return min + (x - Math.floor(x)) * (max - min)
    }
    return {
      durA:   `${rand(3.4, 5.8, 1).toFixed(2)}s`,
      durB:   `${rand(4.2, 6.6, 2).toFixed(2)}s`,
      durC:   `${rand(2.9, 4.5, 3).toFixed(2)}s`,
      delayA: `${(-rand(0, 2.2, 4)).toFixed(2)}s`,
      delayB: `${(-rand(0.8, 3.1, 5)).toFixed(2)}s`,
      delayC: `${(-rand(0.3, 1.9, 6)).toFixed(2)}s`,
    }
  }, [nowPlaying?.trackId])

  useEffect(() => {
    lastSnapshotAt.current = Date.now()
    const resetTimer = window.setTimeout(() => {
      setLiveProgressMs(nowPlaying?.progressMs || 0)
    }, 0)
    return () => window.clearTimeout(resetTimer)
  }, [nowPlaying?.trackId, nowPlaying?.durationMs, nowPlaying?.progressMs, nowPlaying?.playing])

  useEffect(() => {
    if (!connected || !nowPlaying?.playing || nowPlaying.durationMs <= 0) return
    // Seed immediately from snapshot + time already elapsed since it arrived
    const elapsed = Date.now() - lastSnapshotAt.current
    setLiveProgressMs(Math.min(nowPlaying.durationMs, (nowPlaying.progressMs || 0) + elapsed))
    const timer = window.setInterval(() => {
      setLiveProgressMs((prev) => Math.min(nowPlaying.durationMs, prev + 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [connected, nowPlaying?.playing, nowPlaying?.durationMs, nowPlaying?.progressMs])

  // When repeat is on and the track finishes, seek back to the start exactly once.
  // Use a ref to gate so we only fire one seek per track-end event.
  const repeatFiredRef = useRef(false)
  useEffect(() => {
    if (nowPlaying?.trackId) repeatFiredRef.current = false
  }, [nowPlaying?.trackId])
  useEffect(() => {
    if (!repeatTrack || !nowPlaying?.durationMs || nowPlaying.durationMs <= 0) return
    if (liveProgressMs >= nowPlaying.durationMs && !repeatFiredRef.current) {
      repeatFiredRef.current = true
      onSeek(0)
    }
  }, [liveProgressMs, nowPlaying?.durationMs, nowPlaying?.trackId, repeatTrack, onSeek])

  const displayProgressMs = nowPlaying ? Math.min(nowPlaying.durationMs || 0, liveProgressMs) : 0
  const progress = progressPercent(
    nowPlaying
      ? {
          ...nowPlaying,
          progressMs: displayProgressMs,
        }
      : null,
  )
  const pctFromEvent = useCallback((e: React.MouseEvent | MouseEvent): number => {
    const bar = progressBarRef.current
    if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - left) / width))
  }, [])

  const handleSeekMouseDown = (e: React.MouseEvent) => {
    if (!nowPlaying?.durationMs) return
    e.preventDefault()
    const pct = pctFromEvent(e)
    setSeekDragPct(pct)

    const onMove = (ev: MouseEvent) => setSeekDragPct(pctFromEvent(ev))
    const onUp = (ev: MouseEvent) => {
      const finalPct = pctFromEvent(ev)
      setSeekDragPct(null)
      onSeek(Math.floor(finalPct * (nowPlaying.durationMs || 0)))
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const trackTitle = nowPlaying?.trackName || "No active track"
  const artistName = nowPlaying?.artistName || (connected ? "Start playback on a Spotify device." : "Connect Spotify in Integrations.")
  const albumArtUrl = nowPlaying?.albumArtUrl || ""
  const nowPlayingState = Boolean(connected && nowPlaying?.playing)
  const isDeviceUnavailable = Boolean(error && /device|playback device/i.test(error))

  const handlePlayPause = useCallback(() => {
    onTogglePlayPause()
  }, [onTogglePlayPause])

  return (
    <section
      ref={sectionRef}
      style={panelStyle}
      className={`${panelClass} home-spotlight-shell hidden xl:flex xl:col-start-1 xl:row-start-2 p-0 max-h-72 overflow-hidden`}
    >
      <div
        className="relative flex h-full min-h-0 w-full flex-col rounded-[inherit] transition-all duration-700"
        style={nowPlayingState && albumColors.primary ? { background: `radial-gradient(ellipse at 50% 0%, ${albumColors.primary}22 0%, transparent 70%)` } : undefined}
      >
        <div className="relative z-10 flex h-full min-h-0 flex-col px-3 pt-3 pb-4">
          {!connected ? (
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center text-accent">
                  <EqualizerBars isPlaying={nowPlayingState} className="h-4" />
                </span>
              </div>
              <button
                onClick={onOpenIntegrations}
                className={cn("rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors home-spotlight-card home-border-glow", subPanelClass)}
              >
                Connect
              </button>
            </div>
          ) : null}

          {connected ? (
            <>
              <div className="flex items-center h-4">
                <span className="inline-flex items-center justify-center text-accent">
                  <EqualizerBars isPlaying={nowPlayingState} className="h-4" />
                </span>
              </div>
              <div className="flex shrink-0 flex-col">
                <div className="relative h-32 w-32 shrink-0 self-center">
                  {/* 3-layer organic glow — colors sampled from album art */}
                  <div className="pointer-events-none absolute -inset-5 -z-10 overflow-visible">
                    <span
                      className={cn(
                        "absolute inset-0 rounded-3xl blur-2xl",
                        nowPlayingState ? "animate-spotify-glow-a" : "opacity-10",
                      )}
                      style={{
                        backgroundColor: albumColors.primary,
                        "--glow-dur-a": glowTiming.durA,
                        "--glow-delay-a": glowTiming.delayA,
                      } as CSSProperties}
                    />
                    <span
                      className={cn(
                        "absolute inset-2 rounded-3xl blur-xl",
                        nowPlayingState ? "animate-spotify-glow-b" : "opacity-8",
                      )}
                      style={{
                        backgroundColor: albumColors.secondary,
                        "--glow-dur-b": glowTiming.durB,
                        "--glow-delay-b": glowTiming.delayB,
                      } as CSSProperties}
                    />
                    <span
                      className={cn(
                        "absolute -inset-2 rounded-3xl blur-3xl",
                        nowPlayingState ? "animate-spotify-glow-c" : "opacity-6",
                      )}
                      style={{
                        backgroundColor: albumColors.tertiary,
                        "--glow-dur-c": glowTiming.durC,
                        "--glow-delay-c": glowTiming.delayC,
                      } as CSSProperties}
                    />
                  </div>
                  <div className={cn("relative h-full w-full overflow-hidden rounded-xl border", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25")}>
                    {albumArtUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={albumArtUrl} alt="Album art" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <SpotifyIcon className="h-9 w-9" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 min-w-0 pb-1">
                  <p className={cn("truncate text-sm font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{trackTitle}</p>
                  <p className={cn("mt-0.5 truncate text-xs", isLight ? "text-s-60" : "text-slate-400")}>{artistName}</p>
                </div>
              </div>

              <div className="mt-2.5">
                {/* Seek bar — drag anywhere to jump */}
                <div
                  ref={progressBarRef}
                  role="slider"
                  aria-label="Seek"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  onMouseDown={handleSeekMouseDown}
                  className={cn(
                    "group relative h-1.5 rounded-full border cursor-pointer select-none transition-transform duration-100",
                    isLight ? "border-[#d5dce8] bg-[#edf3fb]" : "border-white/10 bg-white/10",
                    seekDragPct !== null ? "scale-y-125" : "hover:scale-y-125",
                  )}
                >
                  <div
                    className="h-full rounded-full transition-none"
                    style={{
                      width: `${seekDragPct !== null ? seekDragPct * 100 : progress}%`,
                      background: `linear-gradient(to right, rgba(var(--accent-rgb), 0.35), var(--accent-primary) 70%)`,
                    }}
                  />
                  {/* Thumb — visible on hover/drag */}
                  <div
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-white shadow transition-opacity duration-100",
                      seekDragPct !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    style={{ left: `${seekDragPct !== null ? seekDragPct * 100 : progress}%` }}
                  />
                </div>
                <div className={cn("mt-1 flex items-center justify-between text-[10px] tabular-nums", isLight ? "text-s-60" : "text-slate-300")}>
                  <span>{formatTimeFromMs(seekDragPct !== null ? Math.floor(seekDragPct * (nowPlaying?.durationMs || 0)) : displayProgressMs)}</span>
                  <span>{formatTimeFromMs(nowPlaying?.durationMs || 0)}</span>
                </div>
              </div>

              <div className="mt-0.5 grid w-full grid-cols-[1fr_auto_1fr] items-center">
                <button
                  onClick={onPlayLiked}
                  disabled={Boolean(busyAction)}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center transition-colors",
                    isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                    busyAction ? "opacity-70" : "",
                  )}
                  style={{ justifySelf: "start" }}
                  aria-label="Play random liked song"
                  title="Play random liked song"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onPrevious}
                    disabled={Boolean(busyAction)}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center transition-colors",
                      isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                      busyAction ? "opacity-70" : "",
                    )}
                    aria-label="Previous track"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handlePlayPause}
                    disabled={Boolean(busyAction) && !isDeviceUnavailable}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-full text-black transition-transform hover:scale-[1.03] active:scale-[0.98]",
                      busyAction && !isDeviceUnavailable ? "opacity-70" : "",
                    )}
                    style={{ background: "linear-gradient(135deg, rgba(var(--accent-rgb), 0.55) 0%, var(--accent-primary) 100%)" }}
                    aria-label={isDeviceUnavailable ? "Launch Spotify" : nowPlayingState ? "Pause Spotify" : "Play Spotify"}
                    title={isDeviceUnavailable ? "Launch Spotify" : undefined}
                  >
                    {isDeviceUnavailable ? (
                      <SpotifyIcon className="h-4 w-4" />
                    ) : nowPlayingState ? (
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
                        <rect x="6" y="5" width="4.5" height="14" rx="1" />
                        <rect x="13.5" y="5" width="4.5" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-[1px] fill-current" aria-hidden="true">
                        <path d="M8 5.5v13l10-6.5z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={onNext}
                    disabled={Boolean(busyAction)}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center transition-colors",
                      isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                      busyAction ? "opacity-70" : "",
                    )}
                    aria-label="Next track"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => setRepeatTrack((v) => !v)}
                  disabled={!connected}
                  style={{ justifySelf: "end" }}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center transition-colors",
                    repeatTrack
                      ? "text-accent"
                      : isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                    !connected ? "opacity-60" : "",
                  )}
                  aria-label={repeatTrack ? "Disable repeat" : "Repeat song"}
                  title={repeatTrack ? "Repeat: on" : "Repeat: off"}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <div className="mt-3 flex flex-1 items-center">
              <p className={cn("text-xs leading-relaxed", isLight ? "text-s-60" : "text-slate-300")}>
                Connect Spotify in Integrations to control playback, see current track, and play from liked songs.
              </p>
            </div>
          )}

          {error ? (
            /device|playback device/i.test(error) ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>
                  Open Spotify to activate a device.
                </p>
                <a
                  href="spotify:"
                  className={cn(
                    "shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                    isLight ? "bg-[#edf3fb] text-s-80 hover:bg-[#e0eaf8]" : "bg-white/10 text-slate-200 hover:bg-white/15",
                  )}
                >
                  Launch
                </a>
              </div>
            ) : (
              <p className={cn("mt-1 truncate text-[11px]", isLight ? "text-rose-700" : "text-rose-300")}>
                {error}
              </p>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
