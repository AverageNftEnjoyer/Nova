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
  onPlaySmart: () => void
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

function hashTrackSeed(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

function parseRgbFromColor(input: string): { r: number; g: number; b: number } | null {
  const value = String(input || "").trim()
  const rgbaMatch = value.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i)
  if (rgbaMatch) {
    return {
      r: Math.max(0, Math.min(255, Number(rgbaMatch[1]))),
      g: Math.max(0, Math.min(255, Number(rgbaMatch[2]))),
      b: Math.max(0, Math.min(255, Number(rgbaMatch[3]))),
    }
  }
  return null
}

function perceivedLuminance(input: string): number {
  const rgb = parseRgbFromColor(input)
  if (!rgb) return 0.5
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
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
  onPlaySmart,
  onSeek,
}: SpotifyHomeModuleProps) {
  const [liveProgressMs, setLiveProgressMs] = useState(() => nowPlaying?.progressMs || 0)
  const [repeatTrack, setRepeatTrack] = useState(false)
  const [seekDragPct, setSeekDragPct] = useState<number | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const [currentArtUrl, setCurrentArtUrl] = useState(() => nowPlaying?.albumArtUrl || "")
  const [pendingArtUrl, setPendingArtUrl] = useState<string | null>(null)
  const [pendingArtVisible, setPendingArtVisible] = useState(false)
  const artTransitionRafRef = useRef<number | null>(null)
  // Track when the last nowPlaying snapshot arrived so we can extrapolate progress
  const lastSnapshotAt = useRef<number>(0)

  const albumColors = useAlbumColors(nowPlaying?.albumArtUrl)

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

    // Use a tighter tick in the final 10s for smooth end-of-track display;
    // use a coarser tick otherwise to reduce unnecessary re-renders.
    let timer: number
    const schedule = () => {
      const remaining = nowPlaying.durationMs - (Date.now() - lastSnapshotAt.current + (nowPlaying.progressMs || 0))
      const tick = remaining <= 10_000 ? 250 : 500
      timer = window.setTimeout(() => {
        setLiveProgressMs((prev) => {
          const next = Math.min(nowPlaying.durationMs, prev + tick)
          return next
        })
        schedule()
      }, tick)
    }
    schedule()
    return () => window.clearTimeout(timer)
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
  const nowPlayingState = Boolean(connected && nowPlaying?.playing)
  const beatSync = useMemo(() => {
    const seedRaw = `${nowPlaying?.trackId || ""}|${nowPlaying?.trackName || ""}|${nowPlaying?.artistName || ""}|${nowPlaying?.durationMs || 0}`
    const seed = hashTrackSeed(seedRaw || "default")
    const estBpm = 78 + (seed % 34)
    const beatMs = Math.max(460, Math.round(60_000 / estBpm))
    const phase = beatMs > 0 ? (Math.max(0, displayProgressMs) % beatMs) / beatMs : 0
    const cosine = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2)
    const smoothPulse = 0.72 + 0.28 * Math.pow(cosine, 1.28)
    return {
      seed,
      pulseA: 0.82 + smoothPulse * 0.26,
      pulseB: 0.78 + smoothPulse * 0.42,
      pulseC: 0.80 + smoothPulse * 0.30,
      pulseLeft: 0.76 + smoothPulse * 0.34,
      pulseRight: 0.76 + smoothPulse * 0.38,
      shellPulse: 0.82 + smoothPulse * 0.20,
    }
  }, [displayProgressMs, nowPlaying?.artistName, nowPlaying?.durationMs, nowPlaying?.trackId, nowPlaying?.trackName])
  const glowTiming = useMemo(() => {
    const seedRaw = `${nowPlaying?.trackId || ""}|${nowPlaying?.trackName || ""}|${nowPlaying?.artistName || ""}|${nowPlaying?.durationMs || 0}`
    const seed = hashTrackSeed(seedRaw || "default")
    // Keep music-correlated tempo, but run snappier so glow tracks perceived beat changes faster.
    const estBpm = 78 + (seed % 34)
    const beatMs = Math.max(460, Math.round(60_000 / estBpm))
    const barMs = beatMs * 4

    const jitterA = ((seed >> 3) % 7) / 100
    const jitterB = ((seed >> 7) % 7) / 100
    const jitterC = ((seed >> 11) % 7) / 100

    const durASeconds = Math.max(2.4, (barMs / 1000) * 0.74 * (1 + jitterA))
    const durBSeconds = Math.max(1.25, (barMs / 1000) * 0.36 * (1 + jitterB))
    const durCSeconds = Math.max(4.4, (barMs / 1000) * 1.08 * (1 + jitterC))

    return {
      durA: `${durASeconds.toFixed(2)}s`,
      durB: `${durBSeconds.toFixed(2)}s`,
      durC: `${durCSeconds.toFixed(2)}s`,
      // Keep delays stable per track so animations don't phase-jump ("teleport") every poll tick.
      delayA: `${(-(((seed % 1800) / 1000))).toFixed(2)}s`,
      delayB: `${(-((((seed >> 5) % 1400) / 1000))).toFixed(2)}s`,
      delayC: `${(-((((seed >> 9) % 2600) / 1000))).toFixed(2)}s`,
    }
  }, [nowPlaying?.artistName, nowPlaying?.durationMs, nowPlaying?.trackId, nowPlaying?.trackName])
  const glowVariantClass = useMemo(() => {
    const variant = beatSync.seed % 3
    if (variant === 0) return "spotify-glow-variant-orbit"
    if (variant === 1) return "spotify-glow-variant-ribbon"
    return "spotify-glow-variant-prism"
  }, [beatSync.seed])
  const spotifyTheme = useMemo(() => {
    const c1 = albumColors.primary
    const c2 = albumColors.secondary
    const c3 = albumColors.tertiary
    const lum1 = perceivedLuminance(c1)
    const lum2 = perceivedLuminance(c2)
    const controlFg = ((lum1 + lum2) / 2) > 0.48 ? "#0b0f18" : "#f8fbff"
    return {
      progressFill: `linear-gradient(90deg, ${c1} 0%, ${c2} 62%, ${c3} 100%)`,
      playPauseFill: `linear-gradient(135deg, ${c1} 0%, ${c2} 58%, ${c3} 100%)`,
      controlForeground: controlFg,
    }
  }, [albumColors.primary, albumColors.secondary, albumColors.tertiary])
  // Motion offsets use the server-polled progressMs (2 s cadence) rather than the
  // interpolated displayProgressMs (250–500 ms cadence).  The CSS animation already
  // provides smooth 60 fps movement; these JS offsets are tiny nudges (±7 px) whose
  // exact value at any given millisecond is imperceptible.  Switching to the poll
  // cadence drops React re-renders for this memo from ~4×/s to ~0.5×/s.
  const dynamicGlowMotion = useMemo(() => {
    if (!nowPlayingState) {
      return {
        aX: "0px",
        aY: "0px",
        aScale: "0",
        aHue: "0deg",
        bX: "0px",
        bY: "0px",
        bScale: "0",
        cX: "0px",
        cY: "0px",
        cScale: "0",
        leftX: "0px",
        leftY: "0px",
        rightX: "0px",
        rightY: "0px",
      }
    }
    // Use the raw poll snapshot — changes every ~2 s instead of every 250–500 ms.
    const t = Math.max(0, nowPlaying?.progressMs ?? 0) / 1000
    const p1 = (beatSync.seed % 23) / 23 * Math.PI * 2
    const p2 = (beatSync.seed % 31) / 31 * Math.PI * 2
    const p3 = (beatSync.seed % 41) / 41 * Math.PI * 2
    const aX = Math.sin(t * 2.25 + p1) * 7 + Math.sin(t * 5.6 + p2) * 2.2
    const aY = Math.cos(t * 1.85 + p3) * 6.2
    const bX = Math.sin(t * 3.9 + p2) * 4.4
    const bY = Math.cos(t * 4.7 + p1) * 3.1
    const cX = Math.sin(t * 1.35 + p3) * 5.2
    const cY = Math.cos(t * 2.05 + p2) * 4.8
    const leftX = Math.sin(t * 3.15 + p1) * 5
    const leftY = Math.cos(t * 2.7 + p2) * 4
    const rightX = Math.cos(t * 3.45 + p3) * 5.2
    const rightY = Math.sin(t * 2.95 + p1) * 4.1
    return {
      aX: `${aX.toFixed(2)}px`,
      aY: `${aY.toFixed(2)}px`,
      aScale: `${(Math.sin(t * 4.8 + p2) * 0.045).toFixed(4)}`,
      aHue: `${(Math.sin(t * 1.9 + p3) * 14).toFixed(2)}deg`,
      bX: `${bX.toFixed(2)}px`,
      bY: `${bY.toFixed(2)}px`,
      bScale: `${(Math.sin(t * 6.2 + p1) * 0.055).toFixed(4)}`,
      cX: `${cX.toFixed(2)}px`,
      cY: `${cY.toFixed(2)}px`,
      cScale: `${(Math.cos(t * 2.6 + p2) * 0.05).toFixed(4)}`,
      leftX: `${leftX.toFixed(2)}px`,
      leftY: `${leftY.toFixed(2)}px`,
      rightX: `${rightX.toFixed(2)}px`,
      rightY: `${rightY.toFixed(2)}px`,
    }
  }, [beatSync.seed, nowPlaying?.progressMs, nowPlayingState])
  // Same poll-cadence throttle as dynamicGlowMotion: use the server snapshot
  // (progressMs, ~2 s) for the drift positions instead of displayProgressMs
  // (~250–500 ms).  The parent div already has `transition-all duration-700`
  // which smoothly interpolates the background change across 700 ms, so the
  // 2 s update cadence produces fluid motion with zero extra JS work.
  const ambientShellStyle = useMemo<CSSProperties | undefined>(() => {
    if (!nowPlayingState || !albumColors.primary) return undefined
    const pollMs = nowPlaying?.progressMs ?? 0
    const driftA = Math.sin(pollMs / 1250)
    const driftB = Math.cos(pollMs / 1500)
    const leftX = 16 + driftA * 8
    const rightX = 86 - driftB * 7
    return {
      background: `
        radial-gradient(118% 92% at ${leftX}% -8%, ${albumColors.primary}55 0%, transparent 58%),
        radial-gradient(92% 88% at ${rightX}% 12%, ${albumColors.secondary}46 0%, transparent 62%),
        radial-gradient(130% 100% at 50% 110%, ${albumColors.tertiary}24 0%, transparent 72%)
      `,
      opacity: beatSync.shellPulse,
    }
  }, [albumColors.primary, albumColors.secondary, albumColors.tertiary, beatSync.shellPulse, nowPlaying?.progressMs, nowPlayingState])

  useEffect(() => {
    const next = nowPlaying?.albumArtUrl || ""
    let rafId: number | null = null
    if (!next) {
      if (artTransitionRafRef.current !== null) {
        window.cancelAnimationFrame(artTransitionRafRef.current)
        artTransitionRafRef.current = null
      }
      rafId = window.requestAnimationFrame(() => {
        setPendingArtUrl(null)
        setPendingArtVisible(false)
        setCurrentArtUrl("")
      })
      return () => {
        if (rafId !== null) window.cancelAnimationFrame(rafId)
      }
    }
    if (!currentArtUrl) {
      rafId = window.requestAnimationFrame(() => {
        setCurrentArtUrl(next)
        setPendingArtUrl(null)
        setPendingArtVisible(false)
      })
      return () => {
        if (rafId !== null) window.cancelAnimationFrame(rafId)
      }
    }
    if (next === currentArtUrl || next === pendingArtUrl) return
    rafId = window.requestAnimationFrame(() => {
      setPendingArtUrl(next)
      setPendingArtVisible(false)
    })
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [currentArtUrl, nowPlaying?.albumArtUrl, pendingArtUrl])

  useEffect(() => {
    return () => {
      if (artTransitionRafRef.current !== null) {
        window.cancelAnimationFrame(artTransitionRafRef.current)
      }
    }
  }, [])

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
  const albumArtUrl = currentArtUrl || pendingArtUrl || ""
  const isDeviceUnavailable = Boolean(error && /device|playback device/i.test(error))

  const handlePlayPause = useCallback(() => {
    onTogglePlayPause()
  }, [onTogglePlayPause])

  return (
    <>
    <style>{`@keyframes spinRecord { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <section
      ref={sectionRef}
      style={panelStyle}
      className={`${panelClass} home-spotlight-shell hidden xl:flex xl:col-start-1 xl:row-start-2 p-0 max-h-72 overflow-hidden`}
    >
      <div
        className="relative flex h-full min-h-0 w-full flex-col rounded-[inherit] transition-all duration-700"
        style={ambientShellStyle}
      >
        <div className="relative z-10 flex h-full min-h-0 flex-col px-3 pt-3 pb-4">
          {!connected ? (
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center text-accent">
                  <EqualizerBars
                    isPlaying={nowPlayingState}
                    className="h-4"
                    barStyle={{ "--eq-bar-color": "#f8fafc" } as CSSProperties}
                  />
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
                  <EqualizerBars
                    isPlaying={nowPlayingState}
                    className="h-4"
                    barStyle={{ "--eq-bar-color": "#f8fafc" } as CSSProperties}
                  />
                </span>
              </div>
              <div className="flex shrink-0 flex-col">
                <div className="relative h-32 w-32 shrink-0 self-center">
                  {/* Render glow only while actively playing */}
                  {nowPlayingState ? (
                    <div className={cn("pointer-events-none absolute -inset-5 -z-10 overflow-visible", glowVariantClass)}>
                      <span
                        className="spotify-glow-layer-a absolute inset-0 rounded-3xl blur-2xl animate-spotify-glow-a"
                        style={{
                          backgroundColor: albumColors.primary,
                          opacity: beatSync.pulseA,
                          "--glow-dur-a": glowTiming.durA,
                          "--glow-delay-a": glowTiming.delayA,
                          "--motion-ax": dynamicGlowMotion.aX,
                          "--motion-ay": dynamicGlowMotion.aY,
                          "--motion-as": dynamicGlowMotion.aScale,
                          "--motion-ahue": dynamicGlowMotion.aHue,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-b absolute inset-2 rounded-3xl blur-xl animate-spotify-glow-b"
                        style={{
                          backgroundColor: albumColors.secondary,
                          opacity: beatSync.pulseB,
                          "--glow-dur-b": glowTiming.durB,
                          "--glow-delay-b": glowTiming.delayB,
                          "--motion-bx": dynamicGlowMotion.bX,
                          "--motion-by": dynamicGlowMotion.bY,
                          "--motion-bs": dynamicGlowMotion.bScale,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-c absolute -inset-2 rounded-3xl blur-3xl animate-spotify-glow-c"
                        style={{
                          backgroundColor: albumColors.tertiary,
                          opacity: beatSync.pulseC,
                          "--glow-dur-c": glowTiming.durC,
                          "--glow-delay-c": glowTiming.delayC,
                          "--motion-cx": dynamicGlowMotion.cX,
                          "--motion-cy": dynamicGlowMotion.cY,
                          "--motion-cs": dynamicGlowMotion.cScale,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-left absolute -left-8 -top-4 h-24 w-24 rounded-full blur-2xl animate-spotify-glow-left"
                        style={{
                          backgroundColor: albumColors.secondary,
                          opacity: beatSync.pulseLeft,
                          "--motion-lx": dynamicGlowMotion.leftX,
                          "--motion-ly": dynamicGlowMotion.leftY,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-right absolute -right-8 top-8 h-28 w-28 rounded-full blur-2xl animate-spotify-glow-right"
                        style={{
                          backgroundColor: albumColors.primary,
                          opacity: beatSync.pulseRight,
                          "--motion-rx": dynamicGlowMotion.rightX,
                          "--motion-ry": dynamicGlowMotion.rightY,
                        } as CSSProperties}
                      />
                    </div>
                  ) : null}
                  <div className={cn("relative h-full w-full overflow-hidden rounded-xl border", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25")}>
                    {albumArtUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={currentArtUrl || albumArtUrl}
                          alt="Album art"
                          className={cn(
                            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                            pendingArtUrl && pendingArtVisible ? "opacity-0" : "opacity-100",
                          )}
                        />
                        {pendingArtUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pendingArtUrl}
                            alt="Album art"
                            className={cn(
                              "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                              pendingArtVisible ? "opacity-100" : "opacity-0",
                            )}
                            onLoad={() => {
                              const loadedUrl = pendingArtUrl
                              if (!loadedUrl) return
                              setPendingArtVisible(true)
                              if (artTransitionRafRef.current !== null) {
                                window.cancelAnimationFrame(artTransitionRafRef.current)
                              }
                              // Finalize on next frame so we commit from the already-loaded pending layer.
                              artTransitionRafRef.current = window.requestAnimationFrame(() => {
                                setCurrentArtUrl(loadedUrl)
                                setPendingArtUrl(null)
                                setPendingArtVisible(false)
                                artTransitionRafRef.current = null
                              })
                            }}
                          />
                        ) : null}
                      </>
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
                    className="h-full rounded-full transition-[background] duration-300"
                    style={{
                      width: `${seekDragPct !== null ? seekDragPct * 100 : progress}%`,
                      background: spotifyTheme.progressFill,
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
                  onClick={onPlaySmart}
                  disabled={Boolean(busyAction)}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center transition-colors",
                    isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                    busyAction ? "opacity-70" : "",
                  )}
                  style={{ justifySelf: "start" }}
                  aria-label="Play from favorite playlist"
                  title="Play from favorite playlist"
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
                      "inline-flex h-9 w-9 items-center justify-center rounded-full text-black hover:scale-[1.03] active:scale-[0.98]",
                      busyAction && !isDeviceUnavailable ? "opacity-70" : "",
                    )}
                    style={{
                      background: spotifyTheme.playPauseFill,
                      color: spotifyTheme.controlForeground,
                      transition: "background 300ms ease, color 220ms ease, transform 150ms ease",
                      animation: nowPlayingState && !isDeviceUnavailable ? "spinRecord 4s linear infinite" : undefined,
                    }}
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
                      <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-px fill-current" aria-hidden="true">
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
    </>
  )
}
