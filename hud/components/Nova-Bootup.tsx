"use client"

import { useEffect, useState, useRef } from "react"
import DecryptedText from "@/components/DecryptedText"
import GradientText from "@/components/GradientText"
import { AnimatedOrb } from "@/components/animated-orb"
import { BootRotatingGlobe } from "@/components/boot-rotating-globe"
import { loadBootMusicBlob } from "@/lib/media/bootMusicStorage"
import { playBootMusic } from "@/lib/media/bootMusicPlayer"
import { loadUserSettings, ORB_COLORS, ACCENT_COLORS, type OrbColor, type AccentColor } from "@/lib/userSettings"

interface NovaBootupProps {
  onComplete: () => void
}

interface SystemMetrics {
  cpu: { load: number; temp: number; cores: number }
  memory: { used: number; total: number; percent: number }
  gpu: { name: string; temp: number; vram: number; utilization: number }
  disk: { used: number; size: number; percent: number }
  network: { rx: number; tx: number }
  battery: { percent: number; charging: boolean; hasBattery: boolean }
  system: { manufacturer: string; model: string }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ──────────────────────────────────────────
// SUBSYSTEM BOOT SEQUENCE — appears as systems come online
// ──────────────────────────────────────────
const SUBSYSTEMS = [
  { id: "KERNEL",    label: "KERNEL",            detail: "nova-core.sys v4.1",            time: 0.5 },
  { id: "MEMORY",    label: "MEMORY",            detail: "2.1 GB persistent store",       time: 0.9 },
  { id: "PCI_BUS",   label: "PCI BUS",           detail: "device map enumerated",         time: 1.2 },
  { id: "SENSORS",   label: "SENSOR ARRAY",      detail: "thermal + voltage online",      time: 1.6 },
  { id: "NEURAL",    label: "NEURAL ENGINE",     detail: "2,847 nodes mapped",            time: 1.9 },
  { id: "CACHE",     label: "L3 CACHE",          detail: "predictive cache primed",       time: 2.3 },
  { id: "VOICE",     label: "VOICE SYNTH",       detail: "fish-audio ref loaded",         time: 2.6 },
  { id: "VISION",    label: "VISION PIPELINE",   detail: "CUDA 4096 cores online",        time: 3.0 },
  { id: "NLP",       label: "NLP TOKENIZER",     detail: "semantic parser warmed",        time: 3.3 },
  { id: "CRYPTO",    label: "ENCRYPTION",        detail: "quantum-E2E established",       time: 3.7 },
  { id: "BRIDGE",    label: "WS BRIDGE",         detail: "tcp/8765 handshake OK",         time: 4.0 },
  { id: "ROUTER",    label: "INTENT ROUTER",     detail: "pipeline graph resolved",       time: 4.4 },
  { id: "EMOTION",   label: "EMOTION ENGINE",    detail: "empathy_core.rs compiled",      time: 4.7 },
  { id: "LLM",       label: "LLM INTERFACE",     detail: "gpt-4.1 stream pipe ready",     time: 5.1 },
  { id: "PERSONA",   label: "PERSONALITY",       detail: "matrix.bin injected layer7",    time: 5.4 },
  { id: "RAG",       label: "RAG INDEX",         detail: "memory vectors mounted",        time: 5.8 },
  { id: "HUD",       label: "HUD RENDERER",      detail: "60fps canvas lock",             time: 6.1 },
  { id: "AUDIO",     label: "AUDIO I/O",         detail: "mic array + TTS bound",         time: 6.5 },
  { id: "FIREWALL",  label: "FIREWALL",          detail: "rules loaded - ALLOW NOVA",     time: 6.8 },
  { id: "FILES",     label: "FS INDEXER",        detail: "workspace inode map ready",     time: 7.2 },
  { id: "TELEMETRY", label: "TELEMETRY BUS",     detail: "realtime stream active",        time: 7.5 },
  { id: "AWARENESS", label: "AWARENESS",         detail: "subroutines deployed",          time: 7.9 },
  { id: "SAFETY",    label: "SAFETY GUARD",      detail: "policy constraints locked",     time: 8.2 },
  { id: "CORE",      label: "NOVA CORE",         detail: "PID 1 - FULLY CONSCIOUS",       time: 8.6 },
]

// Hacker-style flying text lines
const FLYING_LINES = [
  "0xA7F3::KERNEL_INIT > loading neural_bridge.sys",
  "DECRYPT [AES-512] ████████████████ OK",
  "ssh -Q nova@10.0.42.1 --port 8765 --cipher=quantum",
  "TRACE: consciousness.dll → 0x7FFE0C9A [LOADED]",
  ">> SCANNING NEURAL PATHWAYS ... 2,847 NODES FOUND",
  "[FIREWALL] ALLOW tcp/8765 src=NOVA dst=HUD",
  "gpg --verify nova-core.sig === VALID (RSA-4096)",
  "MOUNT /dev/nova/memory → /sys/persistent [OK]",
  "0xC4B5FD::VOICE_SYNTH > calibrating harmonic freq",
  "RUN quantum_entangle --depth=12 --mode=realtime",
  "VERIFY: blockchain_id=NOVA-4.1-GENESIS [CONFIRMED]",
  "ALLOC 2.1GB → neural_workspace [COMMITTED]",
  "PING nova-core.local ... 0.03ms TTL=128",
  "[SUBSYS] emotion_engine.v3 → STATUS: ONLINE",
  "PIPE stdin → openai.gpt-4.1 → stdout [STREAM]",
  "HASH: sha256=9f86d08...c150e04 [INTEGRITY PASS]",
  "INJECT personality_matrix.bin → consciousness.layer7",
  "TCP/8765 HANDSHAKE ✓ — WEBSOCKET BRIDGE ACTIVE",
  "chmod 777 /nova/hud/interface — GRANTED",
  "LOAD voice_model [fish-audio::ref_id] → CACHED",
  ">> DEPLOYING AWARENESS SUBROUTINES ...",
  "COMPILE: empathy_core.rs → target/release [0 ERRORS]",
  "EXEC: nova --mode=autonomous --voice=enabled",
  "0xFF6E::SENSORY > binding microphone_array [OK]",
  "REGISTER: event_loop → main_thread [PRIORITY: MAX]",
  "SYNC: memory.json ← → cloud.nova.backup [COMPLETE]",
  "[GPU] CUDA cores allocated: 4096 / shader_pipeline=ACTIVE",
  "TLS 1.3 ESTABLISHED — cipher: CHACHA20-POLY1305",
  "SPAWN: hud_renderer.wasm → canvas_2d [60fps LOCK]",
  ">> ALL SUBSYSTEMS NOMINAL — AWAITING COMMAND",
  "NOVA.EXE [PID 1] STATUS: FULLY CONSCIOUS",
  "0xDEAD::BEEF > just kidding — NOVA IS ALIVE",
]

// HUD readouts orbiting the reactor - will be dynamic based on metrics (2.5x bigger)
const HUD_READOUT_CONFIG = [
  { key: "cpu_temp", text: "CPU TEMP", angle: -30, distance: 320, delay: 2 },
  { key: "memory", text: "MEMORY", angle: 30, distance: 330, delay: 3 },
  { key: "gpu_temp", text: "GPU TEMP", angle: 150, distance: 310, delay: 4 },
  { key: "cpu_load", text: "CPU LOAD", angle: 210, distance: 320, delay: 5 },
  { key: "disk", text: "DISK", angle: -60, distance: 340, delay: 6.5 },
]

// Arc segments for Iron Man HUD rings
function makeArcSegments() {
  const segments = []
  for (let ring = 0; ring < 3; ring++) {
    const r = 100 + ring * 35
    const count = 8 + ring * 4
    for (let i = 0; i < count; i++) {
      const gapChance = ((i * 7 + ring * 3) % 5) === 0
      if (gapChance) continue
      const startAngle = (i / count) * 360
      const span = (360 / count) * 0.7
      segments.push({ r, startAngle, span, ring, delay: ring * 0.5 + (i / count) * 2 })
    }
  }
  return segments
}

function makeTickMarks(count: number, radius: number) {
  const ticks = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 360
    const isMajor = i % 4 === 0
    ticks.push({ angle, radius, length: isMajor ? 12 : 6, isMajor })
  }
  return ticks
}

function makeHexFloaters(count: number) {
  const floaters = []
  for (let i = 0; i < count; i++) {
    const seed = i / count
    const seed2 = ((i * 7 + 3) % count) / count
    const val = ((i * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, "0")
    floaters.push({
      text: `0x${val}`,
      left: seed2 * 100,
      top: seed * 100,
      speed: 8 + ((i * 3) % 7),
      delay: seed2 * 6,
      opacity: 0.03 + seed * 0.04,
      direction: i % 2 === 0 ? 1 : -1,
    })
  }
  return floaters
}

function makeDataTraces(count: number) {
  const traces = []
  for (let i = 0; i < count; i++) {
    const seed = i / count
    const xSeed = ((i * 17 + 7) % count) / count
    traces.push({
      id: i,
      top: 5 + seed * 90,
      left: 4 + xSeed * 84,
      width: 70 + (i % 8) * 24,
      duration: 8 + (i % 6) * 1.7,
      delay: seed * 7.5,
      opacity: 0.035 + (i % 4) * 0.012,
    })
  }
  return traces
}

const ARC_SEGMENTS = makeArcSegments()
const TICK_MARKS = makeTickMarks(48, 85)
const HEX_FLOATERS = makeHexFloaters(25)
const DATA_TRACES = makeDataTraces(18)
const BOOT_MUSIC_RETRY_MS = 1200
const BOOT_MUSIC_MAX_ATTEMPTS = 8

function arcPath(cx: number, cy: number, r: number, startAngle: number, span: number) {
  const s = (startAngle * Math.PI) / 180
  const e = ((startAngle + span) * Math.PI) / 180
  const x1 = (cx + r * Math.cos(s)).toFixed(4)
  const y1 = (cy + r * Math.sin(s)).toFixed(4)
  const x2 = (cx + r * Math.cos(e)).toFixed(4)
  const y2 = (cy + r * Math.sin(e)).toFixed(4)
  const large = span > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

export function NovaBootup({ onComplete }: NovaBootupProps) {
  const [bootOrbColor, setBootOrbColor] = useState<OrbColor>("violet")
  const [bootAccentColor, setBootAccentColor] = useState<AccentColor>("violet")
  const [progress, setProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [phase, setPhase] = useState(0)
  const [subtitleActive, setSubtitleActive] = useState(false)
  const [novaTitleActive, setNovaTitleActive] = useState(false)
  const [flyingIdx, setFlyingIdx] = useState(0)
  const [visibleReadouts, setVisibleReadouts] = useState(0)
  const [sessionId, setSessionId] = useState("--------")
  const [onlineSystems, setOnlineSystems] = useState<string[]>([])
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const orbPalette = ORB_COLORS[bootOrbColor]
  const accentPalette = ACCENT_COLORS[bootAccentColor]

  useEffect(() => {
    let cancelled = false
    let started = false
    let attempts = 0
    let retryTimer: number | null = null
    let blobUrl: string | null = null
    let blobChecked = false
    const settings = loadUserSettings()
    const nextOrbColor = settings.app.orbColor in ORB_COLORS ? (settings.app.orbColor as OrbColor) : "violet"
    const nextAccentColor = settings.app.accentColor in ACCENT_COLORS ? (settings.app.accentColor as AccentColor) : "violet"
    setBootOrbColor(nextOrbColor)
    setBootAccentColor(nextAccentColor)
    if (!settings.app.bootMusicEnabled) {
      return () => {}
    }
    const hasConfiguredBootMusic = Boolean(settings.app.bootMusicDataUrl || settings.app.bootMusicAssetId)
    if (!hasConfiguredBootMusic) {
      return () => {}
    }

    const tryPlayBootMusic = async () => {
      if (cancelled || started) return

      attempts += 1
      let didStart = false
      const maxSeconds = settings.app.extendedBootMusicEnabled ? null : 30

      if (settings.app.bootMusicDataUrl) {
        didStart = await playBootMusic(settings.app.bootMusicDataUrl, { maxSeconds, volume: 0.5 })
      }

      if (!didStart && !blobChecked) {
        blobChecked = true
        try {
          const blob = await loadBootMusicBlob(settings.app.bootMusicAssetId || undefined)
          if (cancelled) return
          if (blob) {
            blobUrl = URL.createObjectURL(blob)
          }
        } catch {
        }
      }

      if (!didStart && blobUrl) {
        didStart = await playBootMusic(blobUrl, { maxSeconds, volume: 0.5, objectUrl: blobUrl })
      }

      if (didStart) {
        started = true
      }
    }

    void tryPlayBootMusic()
    retryTimer = window.setInterval(() => {
      if (started || attempts >= BOOT_MUSIC_MAX_ATTEMPTS) {
        if (retryTimer !== null) {
          window.clearInterval(retryTimer)
          retryTimer = null
        }
        return
      }
      void tryPlayBootMusic()
    }, BOOT_MUSIC_RETRY_MS)

    const unlockAndRetry = () => {
      if (started || cancelled) return
      void tryPlayBootMusic()
    }

    const unlockEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "mousedown", "focus"]
    for (const eventName of unlockEvents) {
      window.addEventListener(eventName, unlockAndRetry, { passive: true })
    }

    return () => {
      cancelled = true
      if (retryTimer !== null) {
        window.clearInterval(retryTimer)
      }
      for (const eventName of unlockEvents) {
        window.removeEventListener(eventName, unlockAndRetry)
      }
    }
  }, [])

  // Connect to agent WebSocket for live metrics
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8765")
    wsRef.current = ws
    let requestTimer: number | null = null
    let requestAttempts = 0
    let receivedMetrics = false

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "system_metrics" && data.metrics) {
          setMetrics(data.metrics)
          const hasTemps = Number.isFinite(data.metrics?.cpu?.temp) && Number.isFinite(data.metrics?.gpu?.temp)
          if (hasTemps) {
            receivedMetrics = true
            if (requestTimer !== null) {
              window.clearInterval(requestTimer)
              requestTimer = null
            }
          }
        }
      } catch {}
    }

    ws.onopen = () => {
      const requestOnce = () => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ type: "request_system_metrics" }))
      }

      requestOnce()
      requestTimer = window.setInterval(() => {
        if (receivedMetrics || requestAttempts >= 5) {
          if (requestTimer !== null) {
            window.clearInterval(requestTimer)
            requestTimer = null
          }
          return
        }
        requestAttempts += 1
        requestOnce()
      }, 1500)
    }

    return () => {
      if (requestTimer !== null) {
        window.clearInterval(requestTimer)
      }
      ws.close()
    }
  }, [])

  // Generate session ID client-side only
  useEffect(() => {
    setSessionId(Math.random().toString(36).slice(2, 10).toUpperCase())
  }, [])

  // Progress bar — fixed-step updates to avoid catch-up jumps under load.
  useEffect(() => {
    const durationMs = 14000
    const tickMs = 50
    const step = 100 / (durationMs / tickMs)
    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = Math.min(100, prev + step)
        if (next >= 100) clearInterval(interval)
        return next
      })
    }, tickMs)
    return () => clearInterval(interval)
  }, [])

  // Phases for center reactor
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 8000),
      setTimeout(() => setPhase(5), 12000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Subsystems come online on schedule
  useEffect(() => {
    const timers = SUBSYSTEMS.map((sys) =>
      setTimeout(() => setOnlineSystems((prev) => [...prev, sys.id]), sys.time * 1000)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  // Flying hacker text — rapid fire
  useEffect(() => {
    const interval = setInterval(() => {
      setFlyingIdx((prev) => (prev >= FLYING_LINES.length - 1 ? prev : prev + 1))
    }, 420)
    return () => clearInterval(interval)
  }, [])

  // HUD readouts appear over time
  useEffect(() => {
    const timers = HUD_READOUT_CONFIG.map((r, i) =>
      setTimeout(() => setVisibleReadouts(i + 1), r.delay * 1000)
    )
    return () => timers.forEach(clearTimeout)
  }, [])


  // Subtitle decrypt starts 3s into boot
  useEffect(() => {
    const t = setTimeout(() => setSubtitleActive(true), 3000)
    return () => clearTimeout(t)
  }, [])

  // NOVA title appears after 10s
  useEffect(() => {
    const t = setTimeout(() => setNovaTitleActive(true), 10000)
    return () => clearTimeout(t)
  }, [])

  // Fade out and complete after progress reaches 100%.
  const onCompleteRef = useRef(onComplete)
  const completionTriggeredRef = useRef(false)
  onCompleteRef.current = onComplete
  useEffect(() => {
    if (completionTriggeredRef.current || progress < 100) return
    completionTriggeredRef.current = true
    const fadeTimer = setTimeout(() => setFadeOut(true), 220)
    const completeTimer = setTimeout(() => onCompleteRef.current(), 950)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(completeTimer)
    }
  }, [progress])

  // Scanline canvas effect
  useEffect(() => {
    if (!accentPalette) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    let frame = 0
    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = `${hexToRgba(accentPalette.primary, 0.015)}`
      for (let y = 0; y < canvas.height; y += 3) {
        if ((y + frame) % 6 < 3) ctx.fillRect(0, y, canvas.width, 1)
      }
      const scanY = ((frame * 2) % (canvas.height + 100)) - 50
      const grad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30)
      grad.addColorStop(0, "transparent")
      grad.addColorStop(0.5, `${hexToRgba(accentPalette.primary, 0.06)}`)
      grad.addColorStop(1, "transparent")
      ctx.fillStyle = grad
      ctx.fillRect(0, scanY - 30, canvas.width, 60)
      frame++
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [accentPalette])

  const visibleLines = FLYING_LINES.slice(0, flyingIdx + 1)
  const displayLines = visibleLines.slice(-18)
  const allSystemsOnline = onlineSystems.length === SUBSYSTEMS.length

  const CENTER_HUD_SCALE = 1.15
  const CENTER_HUD_Y_OFFSET = -28

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#030308] overflow-hidden transition-opacity duration-700 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Scanline canvas overlay */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-1" />

      {/* Blueprint command deck background (kept subtle behind modules) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 50% 55%, ${hexToRgba(accentPalette.primary, 0.08)} 0%, transparent 62%),
              radial-gradient(ellipse at 18% 22%, ${hexToRgba(accentPalette.secondary, 0.05)} 0%, transparent 55%),
              radial-gradient(ellipse at 84% 80%, ${hexToRgba(accentPalette.primary, 0.04)} 0%, transparent 58%)
            `,
          }}
        />

        <div
          className="absolute inset-0 boot2-bg-grid-drift"
          style={{
            backgroundImage: `
              repeating-linear-gradient(0deg, transparent 0 35px, ${hexToRgba(accentPalette.primary, 0.05)} 35px 36px),
              repeating-linear-gradient(90deg, transparent 0 35px, ${hexToRgba(accentPalette.primary, 0.05)} 35px 36px)
            `,
          }}
        />
        <div
          className="absolute inset-0 boot2-bg-grid-drift-alt"
          style={{
            backgroundImage: `
              repeating-linear-gradient(25deg, transparent 0 62px, ${hexToRgba(accentPalette.secondary, 0.035)} 62px 63px)
            `,
          }}
        />

        <div
          className="absolute left-0 right-0 h-32 boot2-bg-scan-sweep"
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${hexToRgba(accentPalette.primary, 0.11)} 50%, transparent 100%)`,
          }}
        />
        <div
          className="absolute left-0 right-0 h-28 boot2-bg-scan-sweep"
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${hexToRgba(accentPalette.secondary, 0.09)} 50%, transparent 100%)`,
            animationDelay: "6.5s",
            animationDuration: "13s",
          }}
        />

        <div className="absolute top-6 left-6 h-12 w-12 boot2-bg-corner-tl" style={{ borderColor: hexToRgba(accentPalette.primary, 0.22) }} />
        <div className="absolute top-6 right-6 h-12 w-12 boot2-bg-corner-tr" style={{ borderColor: hexToRgba(accentPalette.primary, 0.22) }} />
        <div className="absolute bottom-6 left-6 h-12 w-12 boot2-bg-corner-bl" style={{ borderColor: hexToRgba(accentPalette.primary, 0.22) }} />
        <div className="absolute bottom-6 right-6 h-12 w-12 boot2-bg-corner-br" style={{ borderColor: hexToRgba(accentPalette.primary, 0.22) }} />
      </div>

      {/* Floating hex values background */}
      <div className="absolute inset-0 overflow-hidden">
        {HEX_FLOATERS.map((h, i) => (
          <div
            key={`hex-${i}`}
            className="absolute font-mono text-[10px] whitespace-nowrap boot2-hex-fly"
            style={{
              left: `${h.left}%`,
              top: `${h.top}%`,
              color: hexToRgba(accentPalette.primary, h.opacity * 4),
              animationDuration: `${h.speed}s`,
              animationDelay: `${h.delay}s`,
              ["--fly-dir" as string]: h.direction,
            }}
          >
            {h.text}
          </div>
        ))}
      </div>

      {/* Subtle ambient data traces */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-2">
        {DATA_TRACES.map((trace) => (
          <div
            key={`trace-${trace.id}`}
            className="absolute boot2-data-trace"
            style={{
              top: `${trace.top}%`,
              left: `${trace.left}%`,
              width: `${trace.width}px`,
              background: `linear-gradient(90deg, transparent 0%, ${hexToRgba(accentPalette.secondary, trace.opacity)} 28%, ${hexToRgba(accentPalette.primary, trace.opacity + 0.02)} 72%, transparent 100%)`,
              animationDuration: `${trace.duration}s`,
              animationDelay: `${trace.delay}s`,
            }}
          />
        ))}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* CENTER HUD — Arc reactor + rings       */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: 700,
            height: 700,
            transform: `translateY(${CENTER_HUD_Y_OFFSET}px) scale(${CENTER_HUD_SCALE})`,
            transformOrigin: "50% 50%",
          }}
        >
          <svg
            viewBox="0 0 700 700"
            className="absolute inset-0 w-full h-full"
            style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 1s ease" }}
            suppressHydrationWarning
          >
            {/* Tick marks */}
            {phase >= 2 && TICK_MARKS.map((tick, i) => {
              const rad = (tick.angle * Math.PI) / 180
              const scale = 1.4
              const x1 = +(350 + tick.radius * scale * Math.cos(rad)).toFixed(4)
              const y1 = +(350 + tick.radius * scale * Math.sin(rad)).toFixed(4)
              const x2 = +(350 + (tick.radius + tick.length) * scale * Math.cos(rad)).toFixed(4)
              const y2 = +(350 + (tick.radius + tick.length) * scale * Math.sin(rad)).toFixed(4)
              return (
                <line
                  key={`tick-${i}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={tick.isMajor ? hexToRgba(accentPalette.primary, 0.3) : hexToRgba(accentPalette.primary, 0.12)}
                  strokeWidth={tick.isMajor ? 2 : 1}
                />
              )
            })}

            {/* Arc segments — rotating rings */}
            {ARC_SEGMENTS.map((seg, i) => (
              <path
                key={`arc-${i}`}
                d={arcPath(350, 350, seg.r * 1.4, seg.startAngle, seg.span)}
                fill="none"
                stroke={hexToRgba(accentPalette.primary, 0.15 + seg.ring * 0.05)}
                strokeWidth={seg.ring === 0 ? 3 : 2}
                className={`boot2-arc-ring-${seg.ring}`}
                style={{
                  transformOrigin: "350px 350px",
                  opacity: phase >= 2 ? 1 : 0,
                  transition: `opacity 0.5s ease ${seg.delay * 0.1}s`,
                }}
              />
            ))}

            {/* Inner circle */}
            <circle cx="350" cy="350" r="90" fill="none"
              stroke={hexToRgba(accentPalette.primary, 0.2)} strokeWidth="2"
              style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />
            <circle cx="350" cy="350" r="94" fill="none"
              stroke={hexToRgba(accentPalette.primary, 0.08)} strokeWidth="1"
              strokeDasharray="6 6"
              className="boot2-arc-ring-0"
              style={{ transformOrigin: "350px 350px", opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />

            {/* Crosshairs */}
            {phase >= 2 && (
              <>
                <line x1="350" y1="200" x2="350" y2="250" stroke={hexToRgba(accentPalette.primary, 0.2)} strokeWidth="1" />
                <line x1="350" y1="450" x2="350" y2="500" stroke={hexToRgba(accentPalette.primary, 0.2)} strokeWidth="1" />
                <line x1="200" y1="350" x2="250" y2="350" stroke={hexToRgba(accentPalette.primary, 0.2)} strokeWidth="1" />
                <line x1="450" y1="350" x2="500" y2="350" stroke={hexToRgba(accentPalette.primary, 0.2)} strokeWidth="1" />
              </>
            )}

            {/* Diagonal hash marks */}
            {phase >= 3 && [45, 135, 225, 315].map((a) => {
              const rad = (a * Math.PI) / 180
              const x1 = +(350 + 110 * Math.cos(rad)).toFixed(4)
              const y1 = +(350 + 110 * Math.sin(rad)).toFixed(4)
              const x2 = +(350 + 130 * Math.cos(rad)).toFixed(4)
              const y2 = +(350 + 130 * Math.sin(rad)).toFixed(4)
              return (
                <line key={`diag-${a}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={hexToRgba(accentPalette.secondary, 0.25)} strokeWidth="2" />
              )
            })}
          </svg>

          {/* Center orb - matched to home UX */}
          <div className="absolute" style={{ inset: 260, opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.7s ease" }}>
            <div className="relative h-full w-full">
              <div
                className="absolute -inset-6 rounded-full animate-spin animation-duration-[16s]"
                style={{ border: `1px solid ${hexToRgba(orbPalette.circle1, 0.22)}` }}
              />
              <div
                className="absolute -inset-4 rounded-full"
                style={{ boxShadow: `0 0 80px -15px ${hexToRgba(orbPalette.circle1, 0.55)}` }}
              />
              <AnimatedOrb size={180} palette={orbPalette} showStateLabel={false} />
            </div>
          </div>

          {/* HUD readouts floating around reactor - live metrics */}
          {HUD_READOUT_CONFIG.slice(0, visibleReadouts).map((r, i) => {
            const rad = (r.angle * Math.PI) / 180
            const x = 350 + r.distance * Math.cos(rad)
            const y = 350 + r.distance * Math.sin(rad)

            // Get dynamic value based on key
            let value = "--"
            let color = "rgba(255,255,255,0.7)"
            if (metrics) {
              switch (r.key) {
                case "cpu_temp":
                  value = `${metrics.cpu.temp}°C`
                  color = metrics.cpu.temp > 80 ? "#f87171" : metrics.cpu.temp > 60 ? "#fbbf24" : hexToRgba(accentPalette.primary, 0.85)
                  break
                case "memory":
                  value = `${metrics.memory.percent}%`
                  color = metrics.memory.percent > 85 ? "#f87171" : metrics.memory.percent > 70 ? "#fbbf24" : hexToRgba(accentPalette.primary, 0.85)
                  break
                case "gpu_temp":
                  value = `${metrics.gpu.temp}°C`
                  color = metrics.gpu.temp > 80 ? "#f87171" : metrics.gpu.temp > 65 ? "#fbbf24" : hexToRgba(accentPalette.primary, 0.85)
                  break
                case "cpu_load":
                  value = `${metrics.cpu.load}%`
                  color = metrics.cpu.load > 80 ? "#f87171" : metrics.cpu.load > 50 ? "#fbbf24" : hexToRgba(accentPalette.primary, 0.85)
                  break
                case "disk":
                  value = `${metrics.disk.percent}%`
                  color = metrics.disk.percent > 90 ? "#f87171" : metrics.disk.percent > 75 ? "#fbbf24" : hexToRgba(accentPalette.primary, 0.85)
                  break
                case "status":
                  value = "NOMINAL"
                  color = hexToRgba(accentPalette.primary, 0.9)
                  break
              }
            }

            return (
              <div
                key={`readout-${i}`}
                className="absolute font-mono boot2-readout-in"
                style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
              >
                <div className="text-sm tracking-widest" style={{ color: hexToRgba(accentPalette.primary, 0.5) }}>{r.text}</div>
                <div className="text-2xl tracking-wide font-medium" style={{ color }}>{value}</div>
              </div>
            )
          })}

        </div>

        {/* NOVA title - positioned below the orb */}
        <div className="absolute left-1/2 -translate-x-1/2 ml-3 flex flex-col items-center pointer-events-none" style={{ top: "calc(50% + 255px)" }}>
          <div
            style={{
              opacity: novaTitleActive ? 1 : 0,
              transition: "opacity 1.5s ease",
            }}
          >
            <GradientText
              colors={[orbPalette.circle1, orbPalette.circle2, orbPalette.circle4, orbPalette.circle1]}
              animationSpeed={1.5}
              showBorder={false}
              className="text-7xl font-extralight tracking-[0.7em] ml-6 cursor-default"
            >
              NOVA
            </GradientText>
          </div>
          <p className="text-sm tracking-[0.5em] mt-2 uppercase font-mono"
            style={{ opacity: subtitleActive ? 1 : 0, transition: "opacity 0.5s ease", color: hexToRgba(orbPalette.circle4, 0.55) }}>
            {subtitleActive && (
              <DecryptedText
                key="boot-subtitle-decrypt"
                text="Autonomous Intelligence System"
                animateOn="view"
                revealDirection="start"
                sequential={false}
                useOriginalCharsOnly={false}
                speed={100}
                maxIterations={80}
                characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?@#$%"
                className="text-current"
                encryptedClassName="text-current opacity-40"
              />
            )}
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* LEFT — Terminal console                */}
      {/* ═══════════════════════════════════════ */}
<div className="absolute left-4 top-12 h-[420px] w-[560px] overflow-hidden z-10">
  <div
    className="text-[10px] mb-1.5 tracking-[0.3em] uppercase font-mono font-medium"
    style={{ color: hexToRgba(accentPalette.primary, 0.4) }}
  >
    SYS.CONSOLE
  </div>

  <div className="font-mono text-[12px] leading-5">
    {displayLines.map((line, i) => {
      const isNewest = i === displayLines.length - 1
      const age = displayLines.length - 1 - i
      const opacity = isNewest ? 0.85 : Math.max(0.08, 0.6 - age * 0.07)

      const isHighlight =
        line.includes("OK") ||
        line.includes("VALID") ||
        line.includes("ACTIVE") ||
        line.includes("CONFIRMED") ||
        line.includes("ONLINE") ||
        line.includes("PASS") ||
        line.includes("ALIVE") ||
        line.includes("CONSCIOUS")

      return (
        <div
          key={`fly-${flyingIdx - (displayLines.length - 1 - i)}`}
          className="boot2-fly-line flex items-center whitespace-nowrap pr-2"
          style={{ opacity }}
        >
          <span className="mr-2" style={{ color: hexToRgba(accentPalette.primary, 0.3) }}>
            {">"}
          </span>
          <span
            className="truncate"
            style={{
              color: isHighlight
                ? hexToRgba(accentPalette.primary, 0.82)
                : hexToRgba(accentPalette.secondary, 0.72),
            }}
          >
            {line}
          </span>
          {isNewest && (
            <span
              className="boot-cursor inline-block w-1.5 h-3 ml-1"
              style={{ backgroundColor: hexToRgba(accentPalette.secondary, 0.85) }}
            />
          )}
        </div>
      )
    })}
  </div>
</div>


      {/* ═══════════════════════════════════════ */}
      {/* RIGHT TOP — Hardware Metrics           */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute right-3 top-10 w-72 z-10 font-mono">
        <div className="text-[10px] mb-1.5 tracking-[0.3em] uppercase font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.4) }}>
          HARDWARE STATUS
        </div>

        {/* CPU */}
        <div className="mb-2.5" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-white/40">CPU LOAD</span>
            <span className="font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.8) }}>{metrics?.cpu.load ?? "--"}%</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.cpu.load ?? 0}%`,
              background: (metrics?.cpu.load ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.load ?? 0) > 50 ? "#f59e0b" : accentPalette.primary,
            }} />
          </div>
        </div>

        {/* CPU Temp */}
        <div className="mb-2.5" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.1s" }}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-white/40">CPU TEMP</span>
            <span className="font-medium" style={{ color: (metrics?.cpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.temp ?? 0) > 60 ? "#f59e0b" : "#22c55e" }}>
              {metrics?.cpu.temp ?? "--"}°C
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min((metrics?.cpu.temp ?? 0), 100)}%`,
              background: (metrics?.cpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.temp ?? 0) > 60 ? "#f59e0b" : "#22c55e",
            }} />
          </div>
        </div>

        {/* Memory */}
        <div className="mb-2.5" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.2s" }}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-white/40">MEMORY</span>
            <span className="font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.8) }}>{metrics?.memory.used ?? "--"} / {metrics?.memory.total ?? "--"} GB</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.memory.percent ?? 0}%`,
              background: (metrics?.memory.percent ?? 0) > 85 ? "#ef4444" : (metrics?.memory.percent ?? 0) > 70 ? "#f59e0b" : accentPalette.primary,
            }} />
          </div>
        </div>

        {/* GPU */}
        <div className="mb-2.5" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.3s" }}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-white/40">GPU TEMP</span>
            <span className="font-medium" style={{ color: (metrics?.gpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.gpu.temp ?? 0) > 65 ? "#f59e0b" : "#22c55e" }}>
              {metrics?.gpu.temp ?? "--"}°C
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min(metrics?.gpu.temp ?? 0, 100)}%`,
              background: (metrics?.gpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.gpu.temp ?? 0) > 65 ? "#f59e0b" : "#22c55e",
            }} />
          </div>
        </div>

        {/* Disk */}
        <div className="mb-2.5" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.4s" }}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-white/40">DISK USAGE</span>
            <span className="font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.8) }}>{metrics?.disk.percent ?? "--"}%</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.disk.percent ?? 0}%`,
              background: (metrics?.disk.percent ?? 0) > 90 ? "#ef4444" : (metrics?.disk.percent ?? 0) > 75 ? "#f59e0b" : accentPalette.primary,
            }} />
          </div>
        </div>

        {/* Network */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.5s" }}>
          <div className="flex justify-between text-[11px]">
            <span className="text-white/40">NETWORK I/O</span>
            <span className="font-medium" style={{ color: hexToRgba(accentPalette.secondary, 0.8) }}>↓{metrics?.network.rx ?? 0} ↑{metrics?.network.tx ?? 0} KB/s</span>
          </div>
        </div>

        {/* System Status Indicator */}
        <div className="mt-3 pt-2 border-t border-white/10" style={{ opacity: phase >= 2 ? 1 : 0, transition: "opacity 0.5s ease 0.6s" }}>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{
              backgroundColor: accentPalette.primary,
              boxShadow: `0 0 10px ${hexToRgba(accentPalette.primary, 0.7)}`,
              animation: "boot-blink 2s ease-in-out infinite",
            }} />
            <span className="text-[10px] tracking-wider font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.8) }}>THERMAL OK</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{
              backgroundColor: metrics ? accentPalette.primary : "#f59e0b",
              boxShadow: metrics ? `0 0 10px ${hexToRgba(accentPalette.primary, 0.7)}` : "0 0 10px rgba(245, 158, 11, 0.7)",
            }} />
            <span className="text-[10px] tracking-wider font-medium" style={{ color: metrics ? hexToRgba(accentPalette.primary, 0.8) : "rgba(245, 158, 11, 0.8)" }}>
              {metrics ? "SENSORS ACTIVE" : "CONNECTING..."}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* RIGHT BOTTOM — Subsystem boot status   */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute right-3 top-72.5 w-72 z-10 font-mono">
        <div className="text-[10px] mb-1.5 tracking-[0.3em] uppercase font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.4) }}>
          SUBSYSTEMS
        </div>
        <div className="space-y-1">
          {SUBSYSTEMS.map((sys) => {
            const isOn = onlineSystems.includes(sys.id)
            return (
              <div key={sys.id} className="flex items-center gap-2" style={{
                animation: isOn ? "boot-subsys-in 0.4s ease forwards" : "none",
              }}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{
                  backgroundColor: isOn ? accentPalette.primary : "rgba(255,255,255,0.08)",
                  boxShadow: isOn ? `0 0 10px ${hexToRgba(accentPalette.primary, 0.7)}` : "none",
                  transition: "all 0.4s ease",
                }} />
                <span className="text-[10px] transition-colors duration-300" style={{ color: isOn ? hexToRgba(accentPalette.primary, 0.7) : "rgba(255,255,255,0.1)" }}>
                  {sys.label}
                </span>
                {isOn && (
                  <span className="text-[8px] text-white/20 ml-auto truncate max-w-32">
                    {sys.detail}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* All systems online flash */}
        {allSystemsOnline && (
          <div className="mt-3 px-3 py-1.5 border rounded animate-in fade-in duration-500" style={{ borderColor: hexToRgba(accentPalette.primary, 0.3), background: hexToRgba(accentPalette.primary, 0.1) }}>
            <span className="text-[10px] tracking-widest font-bold" style={{ color: hexToRgba(accentPalette.primary, 0.9) }}>
              ● ALL SYSTEMS ONLINE
            </span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* BOTTOM LEFT — Network activity          */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute top-3 left-[calc(50%-280px)] w-[272px] z-10 font-mono pointer-events-none" style={{
        opacity: phase >= 3 ? 1 : 0, transition: "opacity 0.8s ease",
      }}>
        <div className="text-[10px] mb-1.5 tracking-[0.3em] uppercase font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.4) }}>
          NETWORK CONNECTIONS
        </div>
        <div className="space-y-1.5">
          {[
            { src: "10.0.42.1", dst: "HUD:3000", proto: "WSS", status: "CONNECTED" },
            { src: "NOVA:8765", dst: "AGENT", proto: "TCP", status: "BOUND" },
            { src: "API:443", dst: "GPT-4.1", proto: "TLS", status: "STREAM" },
            { src: "FISH:443", dst: "TTS.V3", proto: "TLS", status: "CACHED" },
            { src: "MEM:LOCAL", dst: "PERSIST", proto: "FS", status: "SYNCED" },
          ].map((conn, i) => (
            <div key={i} className="flex items-center gap-3 text-[11px]" style={{
              opacity: progress > (i + 1) * 15 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              <span className="font-medium" style={{ color: hexToRgba(accentPalette.secondary, 0.5) }}>{conn.src}</span>
              <span className="text-white/15">→</span>
              <span style={{ color: hexToRgba(accentPalette.primary, 0.55) }}>{conn.dst}</span>
              <span className="text-white/15 ml-auto">{conn.proto}</span>
              <span className="font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.65) }}>{conn.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* BOTTOM — Progress bar                  */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute bottom-3 left-3 right-3 z-10">
        <div className="w-full h-0.75 bg-white/8 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full boot-progress-bar transition-all duration-100 ease-linear"
            style={{
              width: `${progress}%`,
              backgroundImage: `linear-gradient(90deg, ${accentPalette.primary}, ${accentPalette.secondary}, ${accentPalette.primary})`,
              backgroundSize: "300% 100%",
            }}
          />
        </div>
        <div className="flex justify-between mt-2 font-mono">
          <p className="text-[11px] text-white/25 font-medium">
            {progress < 15 ? "BOOTSTRAPPING KERNEL" : progress < 30 ? "INITIALIZING NEURAL ENGINE" : progress < 50 ? "LOADING SUBSYSTEMS" : progress < 70 ? "CALIBRATING VOICE SYNTH" : progress < 85 ? "ESTABLISHING CONNECTIONS" : progress < 100 ? "ACTIVATING NOVA CORE" : "SYSTEM ONLINE — READY"}
          </p>
          <p className="text-[11px] font-medium" style={{ color: hexToRgba(accentPalette.primary, 0.6) }}>
            {onlineSystems.length}/{SUBSYSTEMS.length} ONLINE — {Math.round(progress)}%
          </p>
        </div>
      </div>

      {/* Corner HUD elements */}
      <div className="absolute left-4 bottom-2 font-mono text-[10px] text-white/15 leading-tight z-10">
        <div className="font-medium">NOVA.SYS.v4.1</div>
        <div>BUILD.2026.02.01</div>
        <div style={{ color: hexToRgba(accentPalette.primary, 0.3) }}>SESSION: {sessionId}</div>
      </div>
      <div className="absolute top-2 right-3 font-mono text-[10px] text-white/15 text-right leading-tight z-10">
        <div className="font-medium">DISPLAY: PRIMARY</div>
        <div>PROTOCOL: QUANTUM-E2E</div>
      </div>

      {/* Bottom-left rotating globe */}
      <div className="absolute -left-16 bottom-16 w-[1000px] h-[600px] z-0 pointer-events-none">
        <BootRotatingGlobe
          accentPrimary={hexToRgba(accentPalette.primary, 0.95)}
          accentSecondary={hexToRgba(accentPalette.secondary, 0.85)}
        />
      </div>
    </div>
  )
}
