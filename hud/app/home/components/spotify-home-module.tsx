"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { RefreshCw, Shuffle, SkipBack, SkipForward } from "lucide-react"

import { SpotifyIcon } from "@/components/icons"
import { EqualizerBars } from "@/components/equalizer-bars"
import { useAccent } from "@/lib/context/accent-context"
import { ACCENT_COLORS } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import type { HomeSpotifyNowPlaying } from "../hooks/use-home-integrations"
import { useAlbumColors } from "../hooks/use-album-colors"

interface SpotifyHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  sectionRef?: RefObject<HTMLElement | null>
  className?: string
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

// Progress bar, thumb and time text are updated straight on the DOM at this cadence
// (no React state), and only while the page is visible.
const PROGRESS_DOM_TICK_MS = 1_000
// Glow/beat visuals are React-driven; they re-render at this coarser cadence.
const GLOW_STATE_TICK_MS = 2_000

interface ProgressSnapshot {
  /** True when connected and actively playing, i.e. progress advances with wall-clock time. */
  advancing: boolean
  progressMs: number
  durationMs: number
  trackId: string
  /** Wall-clock time (Date.now()) at which this snapshot was committed. */
  at: number
}

function projectProgressMs(snapshot: ProgressSnapshot, now: number): number {
  if (snapshot.durationMs <= 0) return 0
  const projected = snapshot.advancing
    ? snapshot.progressMs + Math.max(0, now - snapshot.at)
    : snapshot.progressMs
  return Math.max(0, Math.min(snapshot.durationMs, projected))
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
  className,
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
  const { accentColor } = useAccent()
  // Coarse (2s) progress clock that feeds the glow/beat visuals only.
  const [glowProgressMs, setGlowProgressMs] = useState(() => nowPlaying?.progressMs || 0)
  const [repeatTrack, setRepeatTrack] = useState(false)
  const [seekDragPct, setSeekDragPct] = useState<number | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const progressThumbRef = useRef<HTMLDivElement>(null)
  const progressTimeRef = useRef<HTMLSpanElement>(null)
  const progressSnapshotRef = useRef<ProgressSnapshot>({
    advancing: false,
    progressMs: 0,
    durationMs: 0,
    trackId: "",
    at: 0,
  })
  const seekDragPctRef = useRef<number | null>(null)
  const repeatTrackRef = useRef(false)
  const onSeekRef = useRef(onSeek)
  const repeatFiredRef = useRef(false)
  const moduleInnerRef = useRef<HTMLDivElement>(null)
  const [moduleInnerSize, setModuleInnerSize] = useState({ width: 0, height: 0 })
  const [currentArtUrl, setCurrentArtUrl] = useState(() => nowPlaying?.albumArtUrl || "")
  const [pendingArtUrl, setPendingArtUrl] = useState<string | null>(null)
  const [pendingArtVisible, setPendingArtVisible] = useState(false)
  const artTransitionRafRef = useRef<number | null>(null)
  const albumColors = useAlbumColors(nowPlaying?.albumArtUrl)

  const nowPlayingState = Boolean(connected && nowPlaying?.playing)

  // Write the interpolated progress straight to the DOM (bar, thumb, time text, aria) and fire
  // the repeat-seek once at track end. Reads refs only, so it never triggers a React render.
  const updateProgressDom = useCallback(() => {
    const snapshot = progressSnapshotRef.current
    const dragPct = seekDragPctRef.current
    const liveMs = projectProgressMs(snapshot, Date.now())
    const pct = dragPct !== null
      ? dragPct * 100
      : snapshot.durationMs > 0 ? Math.max(0, Math.min(100, (liveMs / snapshot.durationMs) * 100)) : 0
    const widthValue = `${pct}%`
    const fill = progressFillRef.current
    if (fill && fill.style.width !== widthValue) fill.style.width = widthValue
    const thumb = progressThumbRef.current
    if (thumb && thumb.style.left !== widthValue) thumb.style.left = widthValue
    const bar = progressBarRef.current
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)))
    const timeEl = progressTimeRef.current
    if (timeEl) {
      const text = formatTimeFromMs(dragPct !== null ? Math.floor(dragPct * snapshot.durationMs) : liveMs)
      if (timeEl.textContent !== text) timeEl.textContent = text
    }
    // When repeat is on and the track finishes, seek back to the start exactly once per track.
    if (
      repeatTrackRef.current
      && snapshot.advancing
      && snapshot.durationMs > 0
      && liveMs >= snapshot.durationMs
      && !repeatFiredRef.current
    ) {
      repeatFiredRef.current = true
      onSeekRef.current(0)
    }
  }, [])

  // After every commit: refresh the snapshot anchor when the server snapshot changed, sync
  // the ref mirrors, and repaint the progress DOM so React-controlled style writes never
  // leave stale values behind.
  useLayoutEffect(() => {
    const prev = progressSnapshotRef.current
    const advancing = Boolean(connected && nowPlaying?.playing && (nowPlaying?.durationMs || 0) > 0)
    const progressMs = nowPlaying?.progressMs || 0
    const durationMs = nowPlaying?.durationMs || 0
    const trackId = nowPlaying?.trackId || ""
    if (
      prev.advancing !== advancing
      || prev.progressMs !== progressMs
      || prev.durationMs !== durationMs
      || prev.trackId !== trackId
    ) {
      progressSnapshotRef.current = { advancing, progressMs, durationMs, trackId, at: Date.now() }
    }
    if (trackId && prev.trackId !== trackId) repeatFiredRef.current = false
    seekDragPctRef.current = seekDragPct
    repeatTrackRef.current = repeatTrack
    onSeekRef.current = onSeek
    updateProgressDom()
  })

  // Tick while playing and the page is visible: 1Hz DOM progress, 0.5Hz glow clock state.
  useEffect(() => {
    const syncGlowClock = () => {
      setGlowProgressMs(projectProgressMs(progressSnapshotRef.current, Date.now()))
    }
    // Deferred so it never runs synchronously inside the effect body.
    const resetTimer = window.setTimeout(syncGlowClock, 0)
    if (!connected || !nowPlaying?.playing || (nowPlaying?.durationMs || 0) <= 0) {
      return () => window.clearTimeout(resetTimer)
    }

    let interval: number | null = null
    let tickCount = 0
    const onTick = () => {
      updateProgressDom()
      tickCount += 1
      if (tickCount % (GLOW_STATE_TICK_MS / PROGRESS_DOM_TICK_MS) === 0) syncGlowClock()
    }
    const start = () => {
      if (interval === null) interval = window.setInterval(onTick, PROGRESS_DOM_TICK_MS)
    }
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop()
        return
      }
      // Catch up immediately after being hidden, then resume ticking.
      updateProgressDom()
      syncGlowClock()
      start()
    }

    if (document.visibilityState !== "hidden") start()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearTimeout(resetTimer)
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [connected, nowPlaying?.playing, nowPlaying?.durationMs, nowPlaying?.trackId, nowPlaying?.progressMs, updateProgressDom])

  // Progress (integer %) as of the last committed snapshot. Used for the initial render and
  // aria only; live values are written to the DOM by updateProgressDom.
  const progress = progressPercent(nowPlaying)
  const glowClockMs = nowPlaying ? Math.min(nowPlaying.durationMs || 0, glowProgressMs) : 0
  const beatSync = useMemo(() => {
    const seedRaw = `${nowPlaying?.trackId || ""}|${nowPlaying?.trackName || ""}|${nowPlaying?.artistName || ""}|${nowPlaying?.durationMs || 0}`
    const seed = hashTrackSeed(seedRaw || "default")
    const estBpm = 78 + (seed % 34)
    const beatMs = Math.max(460, Math.round(60_000 / estBpm))
    const phase = beatMs > 0 ? (Math.max(0, glowClockMs) % beatMs) / beatMs : 0
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
  }, [glowClockMs, nowPlaying?.artistName, nowPlaying?.durationMs, nowPlaying?.trackId, nowPlaying?.trackName])
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
    const accent = ACCENT_COLORS[accentColor]
    const c1 = nowPlayingState ? albumColors.primary : accent.primary
    const c2 = nowPlayingState ? albumColors.secondary : accent.secondary
    const c3 = nowPlayingState ? albumColors.tertiary : accent.primary
    const lum1 = perceivedLuminance(c1)
    const lum2 = perceivedLuminance(c2)
    const controlFg = ((lum1 + lum2) / 2) > 0.48 ? "#0b0f18" : "#f8fbff"
    return {
      progressFill: `linear-gradient(90deg, ${c1} 0%, ${c2} 62%, ${c3} 100%)`,
      playPauseFill: `linear-gradient(135deg, ${c1} 0%, ${c2} 58%, ${c3} 100%)`,
      controlForeground: controlFg,
    }
  }, [accentColor, albumColors.primary, albumColors.secondary, albumColors.tertiary, nowPlayingState])
  // Motion offsets use the coarse glow clock (2 s cadence) rather than per-frame progress.
  // The CSS animation already provides smooth 60 fps movement; these JS offsets are tiny
  // nudges (±7 px) whose exact value at any given millisecond is imperceptible.
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
    const t = Math.max(0, glowClockMs) / 1000
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
  }, [beatSync.seed, glowClockMs, nowPlayingState])
  // Same 2 s glow-clock throttle as dynamicGlowMotion. The parent div already has
  // `transition-all duration-700`, which smooths the background change between updates.
  const ambientShellStyle = useMemo<CSSProperties | undefined>(() => {
    if (!nowPlayingState || !albumColors.primary) return undefined
    const pollMs = glowClockMs
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
  }, [albumColors.primary, albumColors.secondary, albumColors.tertiary, beatSync.shellPulse, glowClockMs, nowPlayingState])

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

  useEffect(() => {
    const node = moduleInnerRef.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = Math.max(0, Math.round(entry.contentRect.width))
      const nextHeight = Math.max(0, Math.round(entry.contentRect.height))
      setModuleInnerSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev
        return { width: nextWidth, height: nextHeight }
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
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
  const isCompactUi = moduleInnerSize.width > 0 && moduleInnerSize.height > 0
    ? moduleInnerSize.width <= 290 || moduleInnerSize.height <= 255
    : false
  const isTimeoutError = Boolean(error && /timed out/i.test(error))
  const albumArtSizePx = useMemo(() => {
    const width = moduleInnerSize.width || 320
    const height = moduleInnerSize.height || 260
    const minSize = isCompactUi ? 104 : 128
    const maxSize = isCompactUi ? 154 : 188
    const reservedHeight = isCompactUi ? 118 : 128
    const byHeight = Math.max(minSize, height - reservedHeight)
    const byWidth = Math.floor(width * (isCompactUi ? 0.56 : 0.62))
    return Math.max(minSize, Math.min(maxSize, Math.min(byHeight, byWidth)))
  }, [isCompactUi, moduleInnerSize.height, moduleInnerSize.width])

  const handlePlayPause = useCallback(() => {
    onTogglePlayPause()
  }, [onTogglePlayPause])

  return (
    <>
    <style>{`@keyframes spinRecord { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <section
      ref={sectionRef}
      style={panelStyle}
      className={cn(`${panelClass} home-spotlight-shell p-0 overflow-hidden`, className ?? "hidden xl:flex xl:col-start-2 xl:row-start-2 max-h-72")}
    >
      <div
        className="relative flex h-full min-h-0 w-full flex-col rounded-[inherit] transition-all duration-700"
        style={ambientShellStyle}
      >
        <div
          ref={moduleInnerRef}
          className={cn(
            "relative z-10 flex h-full min-h-0 flex-col",
            isCompactUi ? "px-2 pt-2 pb-2" : "px-2.5 pt-2.5 pb-2.5",
          )}
        >
          {connected && isTimeoutError ? (
            <div
              className={cn(
                "pointer-events-none absolute right-2 top-2 z-20 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isLight ? "bg-[#edf3fb]/90 text-s-70" : "bg-black/35 text-slate-300",
              )}
            >
              Reconnecting Spotify...
            </div>
          ) : null}
          {!connected ? (
            <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-accent">
                <SpotifyIcon className="h-6 w-6" />
              </span>
              <p className={cn("truncate text-xs font-medium", isLight ? "text-s-70" : "text-slate-300")}>
                Spotify disconnected
              </p>
              <button
                onClick={onOpenIntegrations}
                className={cn("rounded-lg border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors home-spotlight-card home-border-glow", subPanelClass)}
              >
                Connect
              </button>
            </div>
          ) : null}

          {connected ? (
            <>
              <div className={cn("flex min-h-0 flex-1 flex-col", isCompactUi ? "gap-1" : "gap-1.5")}>
              <div className={cn("flex items-center", isCompactUi ? "h-3.5" : "h-4")}>
                <span className="inline-flex items-center justify-center text-accent">
                  <EqualizerBars
                    isPlaying={nowPlayingState}
                    className={isCompactUi ? "h-3.5" : "h-4"}
                    barStyle={{ "--eq-bar-color": "#f8fafc" } as CSSProperties}
                  />
                </span>
              </div>
              <div className="flex shrink-0 flex-col">
                <div className={cn("min-w-0", isCompactUi ? "mb-1 mt-0.5" : "mb-1.5 mt-0.5")}>
                  <p className={cn(isCompactUi ? "truncate text-xs font-semibold leading-tight" : "truncate text-[13px] font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{trackTitle}</p>
                  <p className={cn(isCompactUi ? "mt-0.5 truncate text-[11px]" : "mt-0.5 truncate text-xs", isLight ? "text-s-60" : "text-slate-400")}>{artistName}</p>
                </div>
                <div
                  className="relative shrink-0 self-center"
                  style={{ width: `${albumArtSizePx}px`, height: `${albumArtSizePx}px` }}
                >
                  {/* Render glow only while actively playing */}
                  {nowPlayingState ? (
                    <div className={cn("pointer-events-none absolute -inset-5 -z-10 overflow-visible", glowVariantClass)}>
                      <span
                        className="spotify-glow-layer-a absolute inset-0 rounded-3xl animate-spotify-glow-a"
                        style={{
                          backgroundColor: albumColors.primary,
                          "--glow-dur-a": glowTiming.durA,
                          "--glow-delay-a": glowTiming.delayA,
                          "--motion-ax": dynamicGlowMotion.aX,
                          "--motion-ay": dynamicGlowMotion.aY,
                          "--motion-as": dynamicGlowMotion.aScale,
                          "--motion-ahue": dynamicGlowMotion.aHue,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-b absolute inset-2 rounded-3xl animate-spotify-glow-b"
                        style={{
                          backgroundColor: albumColors.secondary,
                          "--glow-dur-b": glowTiming.durB,
                          "--glow-delay-b": glowTiming.delayB,
                          "--motion-bx": dynamicGlowMotion.bX,
                          "--motion-by": dynamicGlowMotion.bY,
                          "--motion-bs": dynamicGlowMotion.bScale,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-c absolute -inset-2 rounded-3xl animate-spotify-glow-c"
                        style={{
                          backgroundColor: albumColors.tertiary,
                          "--glow-dur-c": glowTiming.durC,
                          "--glow-delay-c": glowTiming.delayC,
                          "--motion-cx": dynamicGlowMotion.cX,
                          "--motion-cy": dynamicGlowMotion.cY,
                          "--motion-cs": dynamicGlowMotion.cScale,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-left absolute -left-8 -top-4 h-24 w-24 rounded-full"
                        style={{
                          backgroundColor: albumColors.secondary,
                          "--motion-lx": dynamicGlowMotion.leftX,
                          "--motion-ly": dynamicGlowMotion.leftY,
                        } as CSSProperties}
                      />
                      <span
                        className="spotify-glow-layer-right absolute -right-8 top-8 h-28 w-28 rounded-full"
                        style={{
                          backgroundColor: albumColors.primary,
                          "--motion-rx": dynamicGlowMotion.rightX,
                          "--motion-ry": dynamicGlowMotion.rightY,
                        } as CSSProperties}
                      />
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "relative h-full w-full overflow-hidden rounded-xl border transition-transform duration-300 will-change-transform hover:scale-[1.04]",
                      isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25",
                    )}
                  >
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
                        <SpotifyIcon className={isCompactUi ? "h-7 w-7" : "h-9 w-9"} />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={cn(isCompactUi ? "mt-2" : "mt-2.5")}>
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
                    "group relative rounded-full border cursor-pointer select-none transition-transform duration-100",
                    isCompactUi ? "h-1.25" : "h-1.5",
                    isLight ? "border-[#d5dce8] bg-[#edf3fb]" : "border-white/10 bg-white/10",
                    seekDragPct !== null ? "scale-y-125" : "hover:scale-y-125",
                  )}
                >
                  <div
                    ref={progressFillRef}
                    className="h-full rounded-full transition-[background] duration-300"
                    style={{
                      width: `${seekDragPct !== null ? seekDragPct * 100 : progress}%`,
                      background: spotifyTheme.progressFill,
                    }}
                  />
                  {/* Thumb — visible on hover/drag */}
                  <div
                    ref={progressThumbRef}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow transition-opacity duration-100",
                      isCompactUi ? "h-2 w-2" : "h-2.5 w-2.5",
                      seekDragPct !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    style={{ left: `${seekDragPct !== null ? seekDragPct * 100 : progress}%` }}
                  />
                </div>
                <div className={cn(isCompactUi ? "mt-1 flex items-center justify-between text-[9px] tabular-nums" : "mt-1 flex items-center justify-between text-[10px] tabular-nums", isLight ? "text-s-60" : "text-slate-300")}>
                  {/* Text is written by updateProgressDom (no React children, so React never fights the DOM). */}
                  <span ref={progressTimeRef} />
                  <span>{formatTimeFromMs(nowPlaying?.durationMs || 0)}</span>
                </div>
              </div>

              <div className={cn("grid w-full grid-cols-[1fr_auto_1fr] items-center", isCompactUi ? "-mt-1.5" : "-mt-1")}>
                <button
                  onClick={onPlaySmart}
                  disabled={Boolean(busyAction)}
                  className={cn(
                    isCompactUi ? "inline-flex h-6 w-6 items-center justify-center transition-colors" : "inline-flex h-7 w-7 items-center justify-center transition-colors",
                    isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                    busyAction ? "opacity-70" : "",
                  )}
                  style={{ justifySelf: "start" }}
                  aria-label="Play from favorite playlist"
                  title="Play from favorite playlist"
                >
                  <Shuffle className={isCompactUi ? "h-3 w-3" : "h-3.5 w-3.5"} />
                </button>
                <div className={cn("flex items-center", isCompactUi ? "gap-0.5" : "gap-1")}>
                  <button
                    onClick={onPrevious}
                    disabled={Boolean(busyAction)}
                    className={cn(
                      isCompactUi ? "inline-flex h-6 w-6 items-center justify-center transition-colors" : "inline-flex h-7 w-7 items-center justify-center transition-colors",
                      isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                      busyAction ? "opacity-70" : "",
                    )}
                    aria-label="Previous track"
                  >
                    <SkipBack className={isCompactUi ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </button>
                  <button
                    onClick={handlePlayPause}
                    disabled={Boolean(busyAction) && !isDeviceUnavailable}
                    className={cn(
                      isCompactUi ? "inline-flex h-8 w-8 -translate-y-0.5 items-center justify-center rounded-full text-black hover:scale-[1.03] active:scale-[0.98]" : "inline-flex h-9 w-9 -translate-y-0.5 items-center justify-center rounded-full text-black hover:scale-[1.03] active:scale-[0.98]",
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
                      <SpotifyIcon className={isCompactUi ? "h-3.5 w-3.5" : "h-4 w-4"} />
                    ) : nowPlayingState ? (
                      <svg viewBox="0 0 24 24" className={isCompactUi ? "h-4 w-4 fill-current" : "h-5 w-5 fill-current"} aria-hidden="true">
                        <rect x="6" y="5" width="4.5" height="14" rx="1" />
                        <rect x="13.5" y="5" width="4.5" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className={isCompactUi ? "h-4 w-4 translate-x-px fill-current" : "h-5 w-5 translate-x-px fill-current"} aria-hidden="true">
                        <path d="M8 5.5v13l10-6.5z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={onNext}
                    disabled={Boolean(busyAction)}
                    className={cn(
                      isCompactUi ? "inline-flex h-6 w-6 items-center justify-center transition-colors" : "inline-flex h-7 w-7 items-center justify-center transition-colors",
                      isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                      busyAction ? "opacity-70" : "",
                    )}
                    aria-label="Next track"
                  >
                    <SkipForward className={isCompactUi ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </button>
                </div>
                <button
                  onClick={() => setRepeatTrack((v) => !v)}
                  disabled={!connected}
                  style={{ justifySelf: "end" }}
                  className={cn(
                    isCompactUi ? "inline-flex h-6 w-6 items-center justify-center transition-colors" : "inline-flex h-7 w-7 items-center justify-center transition-colors",
                    repeatTrack
                      ? "text-accent"
                      : isLight ? "text-s-60 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
                    !connected ? "opacity-60" : "",
                  )}
                  aria-label={repeatTrack ? "Disable repeat" : "Repeat song"}
                  title={repeatTrack ? "Repeat: on" : "Repeat: off"}
                >
                  <RefreshCw className={isCompactUi ? "h-3 w-3" : "h-3.5 w-3.5"} />
                </button>
              </div>
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
            ) : isTimeoutError ? null : (
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
