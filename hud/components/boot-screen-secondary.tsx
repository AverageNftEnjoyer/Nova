"use client"

import { useEffect, useState, useRef } from "react"

interface BootScreenSecondaryProps {
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

// ──────────────────────────────────────────
// SUBSYSTEM BOOT SEQUENCE — appears as systems come online
// ──────────────────────────────────────────
const SUBSYSTEMS = [
  { id: "KERNEL",   label: "KERNEL",          detail: "nova-core.sys v4.1",         time: 0.4 },
  { id: "MEMORY",   label: "MEMORY",          detail: "2.1 GB persistent store",    time: 1.2 },
  { id: "NEURAL",   label: "NEURAL ENGINE",   detail: "2,847 nodes mapped",         time: 2.0 },
  { id: "VOICE",    label: "VOICE SYNTH",     detail: "fish-audio ref loaded",      time: 3.0 },
  { id: "VISION",   label: "VISION PIPELINE", detail: "CUDA 4096 cores online",     time: 4.0 },
  { id: "CRYPTO",   label: "ENCRYPTION",      detail: "quantum-E2E established",    time: 4.8 },
  { id: "BRIDGE",   label: "WS BRIDGE",       detail: "tcp/8765 handshake OK",      time: 5.5 },
  { id: "EMOTION",  label: "EMOTION ENGINE",  detail: "empathy_core.rs compiled",   time: 6.2 },
  { id: "LLM",      label: "LLM INTERFACE",   detail: "gpt-4.1 stream pipe ready",  time: 7.0 },
  { id: "PERSONA",  label: "PERSONALITY",     detail: "matrix.bin injected layer7", time: 7.8 },
  { id: "HUD",      label: "HUD RENDERER",    detail: "60fps canvas lock",          time: 8.5 },
  { id: "AUDIO",    label: "AUDIO I/O",       detail: "mic array + TTS bound",      time: 9.2 },
  { id: "FIREWALL", label: "FIREWALL",        detail: "rules loaded — ALLOW NOVA",  time: 10.0 },
  { id: "AWARENESS",label: "AWARENESS",       detail: "subroutines deployed",       time: 10.8 },
  { id: "CORE",     label: "NOVA CORE",       detail: "PID 1 — FULLY CONSCIOUS",   time: 11.5 },
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

// HUD readouts orbiting the reactor - will be dynamic based on metrics
const HUD_READOUT_CONFIG = [
  { key: "cpu_temp", text: "CPU TEMP", angle: -30, distance: 160, delay: 2 },
  { key: "memory", text: "MEMORY", angle: 30, distance: 165, delay: 3 },
  { key: "gpu_temp", text: "GPU TEMP", angle: 150, distance: 155, delay: 4 },
  { key: "cpu_load", text: "CPU LOAD", angle: 210, distance: 160, delay: 5 },
  { key: "disk", text: "DISK", angle: -60, distance: 175, delay: 6.5 },
  { key: "status", text: "STATUS", angle: 60, distance: 170, delay: 7.5 },
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

const ARC_SEGMENTS = makeArcSegments()
const TICK_MARKS = makeTickMarks(48, 85)
const HEX_FLOATERS = makeHexFloaters(25)

// Shooting comets configuration - deterministic to avoid hydration mismatch
const COMETS = [
  { id: 0, startX: -5, startY: -10, angle: 32, speed: 4.5, delay: 0.5, length: 120, color: "#c084fc", secondaryColor: "#e879f9" },
  { id: 1, startX: 15, startY: -15, angle: 38, speed: 5.2, delay: 2.0, length: 90, color: "#a855f7", secondaryColor: "#f0abfc" },
  { id: 2, startX: 35, startY: -8, angle: 28, speed: 3.8, delay: 4.5, length: 150, color: "#ec4899", secondaryColor: "#f9a8d4" },
  { id: 3, startX: 55, startY: -12, angle: 42, speed: 6.0, delay: 1.2, length: 100, color: "#d946ef", secondaryColor: "#e879f9" },
  { id: 4, startX: 75, startY: -5, angle: 25, speed: 4.0, delay: 6.0, length: 130, color: "#a855f7", secondaryColor: "#c4b5fd" },
  { id: 5, startX: 95, startY: -18, angle: 35, speed: 5.5, delay: 3.5, length: 110, color: "#ec4899", secondaryColor: "#fbcfe8" },
  { id: 6, startX: 10, startY: -20, angle: 30, speed: 4.2, delay: 7.5, length: 140, color: "#c084fc", secondaryColor: "#ddd6fe" },
  { id: 7, startX: 45, startY: -6, angle: 40, speed: 3.5, delay: 9.0, length: 85, color: "#d946ef", secondaryColor: "#f5d0fe" },
  { id: 8, startX: 65, startY: -14, angle: 33, speed: 5.8, delay: 5.0, length: 160, color: "#a855f7", secondaryColor: "#e9d5ff" },
  { id: 9, startX: 25, startY: -8, angle: 45, speed: 4.8, delay: 10.5, length: 95, color: "#ec4899", secondaryColor: "#fce7f3" },
  { id: 10, startX: 85, startY: -12, angle: 27, speed: 6.5, delay: 8.0, length: 175, color: "#c084fc", secondaryColor: "#ede9fe" },
  { id: 11, startX: 5, startY: -16, angle: 36, speed: 4.0, delay: 11.5, length: 105, color: "#d946ef", secondaryColor: "#fae8ff" },
]

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

export function BootScreenSecondary({ onComplete }: BootScreenSecondaryProps) {
  const [progress, setProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [phase, setPhase] = useState(0)
  const [flyingIdx, setFlyingIdx] = useState(0)
  const [visibleReadouts, setVisibleReadouts] = useState(0)
  const [sessionId, setSessionId] = useState("--------")
  const [onlineSystems, setOnlineSystems] = useState<string[]>([])
  const [orbReady, setOrbReady] = useState(false)
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const startTime = useRef(Date.now())
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Connect to agent WebSocket for live metrics
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8765")
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "system_metrics" && data.metrics) {
          setMetrics(data.metrics)
        }
      } catch {}
    }

    return () => ws.close()
  }, [])

  // Generate session ID client-side only
  useEffect(() => {
    setSessionId(Math.random().toString(36).slice(2, 10).toUpperCase())
  }, [])

  // Progress bar — 14 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime.current
      const pct = Math.min((elapsed / 14000) * 100, 100)
      setProgress(pct)
      if (pct >= 100) clearInterval(interval)
    }, 50)
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

  // Orb "activates" at the end — starts pulsing/moving
  useEffect(() => {
    const t = setTimeout(() => setOrbReady(true), 12500)
    return () => clearTimeout(t)
  }, [])

  // Fade out and complete
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 14200)
    const completeTimer = setTimeout(() => onCompleteRef.current(), 15000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(completeTimer)
    }
  }, [])

  // Scanline canvas effect
  useEffect(() => {
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
      ctx.fillStyle = "rgba(139, 92, 246, 0.015)"
      for (let y = 0; y < canvas.height; y += 3) {
        if ((y + frame) % 6 < 3) ctx.fillRect(0, y, canvas.width, 1)
      }
      const scanY = ((frame * 2) % (canvas.height + 100)) - 50
      const grad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30)
      grad.addColorStop(0, "transparent")
      grad.addColorStop(0.5, "rgba(139, 92, 246, 0.06)")
      grad.addColorStop(1, "transparent")
      ctx.fillStyle = grad
      ctx.fillRect(0, scanY - 30, canvas.width, 60)
      frame++
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const visibleLines = FLYING_LINES.slice(0, flyingIdx + 1)
  const displayLines = visibleLines.slice(-14)

  const allSystemsOnline = onlineSystems.length === SUBSYSTEMS.length

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#030308] overflow-hidden transition-opacity duration-700 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Scanline canvas overlay */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-[1]" />

      {/* Floating hex values background */}
      <div className="absolute inset-0 overflow-hidden">
        {HEX_FLOATERS.map((h, i) => (
          <div
            key={`hex-${i}`}
            className="absolute font-mono text-[10px] whitespace-nowrap boot2-hex-fly"
            style={{
              left: `${h.left}%`,
              top: `${h.top}%`,
              color: `rgba(139, 92, 246, ${h.opacity * 4})`,
              animationDuration: `${h.speed}s`,
              animationDelay: `${h.delay}s`,
              ["--fly-dir" as string]: h.direction,
            }}
          >
            {h.text}
          </div>
        ))}
      </div>

      {/* Shooting comets */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[2]">
        {COMETS.map((comet) => (
          <div
            key={`comet-${comet.id}`}
            className="absolute boot2-comet"
            style={{
              left: `${comet.startX}%`,
              top: `${comet.startY}%`,
              ["--comet-angle" as string]: `${comet.angle}deg`,
              ["--duration" as string]: `${comet.speed}s`,
              ["--delay" as string]: `${comet.delay}s`,
            }}
          >
            {/* Main comet tail - gradient with multiple color stops */}
            <div
              style={{
                width: `${comet.length}px`,
                height: "1.5px",
                background: `linear-gradient(90deg,
                  transparent 0%,
                  ${comet.color}15 10%,
                  ${comet.color}40 30%,
                  ${comet.color}80 60%,
                  ${comet.secondaryColor} 85%,
                  white 100%)`,
                borderRadius: "1px",
              }}
            />
            {/* Secondary inner trail - brighter core */}
            <div
              className="absolute top-0"
              style={{
                width: `${comet.length * 0.6}px`,
                height: "1px",
                right: 0,
                background: `linear-gradient(90deg,
                  transparent 0%,
                  ${comet.secondaryColor}60 50%,
                  white 100%)`,
              }}
            />
            {/* Comet head - small bright point */}
            <div
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                right: "-1px",
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                background: `radial-gradient(circle, white 0%, ${comet.secondaryColor} 60%, transparent 100%)`,
                boxShadow: `0 0 2px white, 0 0 4px ${comet.secondaryColor}`,
              }}
            />
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* CENTER HUD — Arc reactor + rings       */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 420, height: 420 }}>
          <svg
            viewBox="0 0 420 420"
            className="absolute inset-0 w-full h-full"
            style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 1s ease" }}
            suppressHydrationWarning
          >
            {/* Tick marks */}
            {phase >= 2 && TICK_MARKS.map((tick, i) => {
              const rad = (tick.angle * Math.PI) / 180
              const x1 = +(210 + tick.radius * 0.84 * Math.cos(rad)).toFixed(4)
              const y1 = +(210 + tick.radius * 0.84 * Math.sin(rad)).toFixed(4)
              const x2 = +(210 + (tick.radius + tick.length) * 0.84 * Math.cos(rad)).toFixed(4)
              const y2 = +(210 + (tick.radius + tick.length) * 0.84 * Math.sin(rad)).toFixed(4)
              return (
                <line
                  key={`tick-${i}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={tick.isMajor ? "rgba(139, 92, 246, 0.3)" : "rgba(139, 92, 246, 0.12)"}
                  strokeWidth={tick.isMajor ? 1.5 : 0.5}
                />
              )
            })}

            {/* Arc segments — rotating rings */}
            {ARC_SEGMENTS.map((seg, i) => (
              <path
                key={`arc-${i}`}
                d={arcPath(210, 210, seg.r * 0.84, seg.startAngle, seg.span)}
                fill="none"
                stroke={`rgba(139, 92, 246, ${0.15 + seg.ring * 0.05})`}
                strokeWidth={seg.ring === 0 ? 2 : 1}
                className={`boot2-arc-ring-${seg.ring}`}
                style={{
                  transformOrigin: "210px 210px",
                  opacity: phase >= 2 ? 1 : 0,
                  transition: `opacity 0.5s ease ${seg.delay * 0.1}s`,
                }}
              />
            ))}

            {/* Inner circle */}
            <circle cx="210" cy="210" r="50" fill="none"
              stroke="rgba(139, 92, 246, 0.2)" strokeWidth="1"
              style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />
            <circle cx="210" cy="210" r="52" fill="none"
              stroke="rgba(139, 92, 246, 0.08)" strokeWidth="0.5"
              strokeDasharray="4 4"
              className="boot2-arc-ring-0"
              style={{ transformOrigin: "210px 210px", opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />

            {/* Crosshairs */}
            {phase >= 2 && (
              <>
                <line x1="210" y1="140" x2="210" y2="165" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="210" y1="255" x2="210" y2="280" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="140" y1="210" x2="165" y2="210" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="255" y1="210" x2="280" y2="210" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
              </>
            )}

            {/* Diagonal hash marks */}
            {phase >= 3 && [45, 135, 225, 315].map((a) => {
              const rad = (a * Math.PI) / 180
              const x1 = +(210 + 60 * Math.cos(rad)).toFixed(4)
              const y1 = +(210 + 60 * Math.sin(rad)).toFixed(4)
              const x2 = +(210 + 70 * Math.cos(rad)).toFixed(4)
              const y2 = +(210 + 70 * Math.sin(rad)).toFixed(4)
              return (
                <line key={`diag-${a}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(167, 139, 250, 0.25)" strokeWidth="1" />
              )
            })}
          </svg>

          {/* Center orb — activates at the end */}
          <div className="absolute" style={{ inset: 160 }}>
            <div
              className="w-full h-full rounded-full"
              style={{
                background: orbReady
                  ? "radial-gradient(circle at 40% 35%, #e9d5ff 0%, #c4b5fd 15%, #8b5cf6 40%, #6d28d9 65%, #4c1d95 100%)"
                  : phase >= 4
                  ? "radial-gradient(circle at 40% 35%, #c4b5fd 0%, #8b5cf6 30%, #6d28d9 60%, #4c1d95 100%)"
                  : phase >= 2
                  ? "radial-gradient(circle at 40% 35%, rgba(196,181,253,0.5) 0%, rgba(139,92,246,0.3) 60%, transparent 100%)"
                  : "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
                boxShadow: orbReady
                  ? "0 0 80px rgba(139,92,246,0.7), 0 0 160px rgba(139,92,246,0.35), 0 0 240px rgba(139,92,246,0.15), inset 0 0 40px rgba(167,139,250,0.5)"
                  : phase >= 3
                  ? "0 0 60px rgba(139,92,246,0.5), 0 0 120px rgba(139,92,246,0.25), inset 0 0 30px rgba(167,139,250,0.4)"
                  : "0 0 20px rgba(139,92,246,0.1)",
                transition: "all 1.5s ease",
                opacity: phase >= 1 ? 1 : 0,
                animation: orbReady ? "boot-orb-ready-pulse 1.5s ease-in-out infinite" : "none",
              }}
            />
            <div className="absolute inset-0 rounded-full"
              style={{
                background: "linear-gradient(to bottom, rgba(255,255,255,0.35) 0%, transparent 55%)",
                opacity: phase >= 3 ? 1 : 0,
                transition: "opacity 1s ease",
              }}
            />
          </div>

          {/* HUD readouts floating around reactor - live metrics */}
          {HUD_READOUT_CONFIG.slice(0, visibleReadouts).map((r, i) => {
            const rad = (r.angle * Math.PI) / 180
            const x = 210 + r.distance * Math.cos(rad)
            const y = 210 + r.distance * Math.sin(rad)

            // Get dynamic value based on key
            let value = "--"
            let color = "text-white/70"
            if (metrics) {
              switch (r.key) {
                case "cpu_temp":
                  value = `${metrics.cpu.temp}°C`
                  color = metrics.cpu.temp > 80 ? "text-red-400" : metrics.cpu.temp > 60 ? "text-amber-400" : "text-emerald-400"
                  break
                case "memory":
                  value = `${metrics.memory.percent}%`
                  color = metrics.memory.percent > 85 ? "text-red-400" : metrics.memory.percent > 70 ? "text-amber-400" : "text-violet-400"
                  break
                case "gpu_temp":
                  value = `${metrics.gpu.temp}°C`
                  color = metrics.gpu.temp > 80 ? "text-red-400" : metrics.gpu.temp > 65 ? "text-amber-400" : "text-emerald-400"
                  break
                case "cpu_load":
                  value = `${metrics.cpu.load}%`
                  color = metrics.cpu.load > 80 ? "text-red-400" : metrics.cpu.load > 50 ? "text-amber-400" : "text-emerald-400"
                  break
                case "disk":
                  value = `${metrics.disk.percent}%`
                  color = metrics.disk.percent > 90 ? "text-red-400" : metrics.disk.percent > 75 ? "text-amber-400" : "text-violet-400"
                  break
                case "status":
                  value = "NOMINAL"
                  color = "text-emerald-400"
                  break
              }
            }

            return (
              <div
                key={`readout-${i}`}
                className="absolute font-mono boot2-readout-in"
                style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
              >
                <div className="text-[8px] text-violet-400/40 tracking-widest">{r.text}</div>
                <div className={`text-[13px] tracking-wide ${color}`}>{value}</div>
              </div>
            )
          })}

          {/* NOVA title */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 pointer-events-none">
            <h1
              className="text-5xl font-extralight tracking-[0.6em] text-white/90 ml-4"
              style={{
                opacity: phase >= 2 ? 1 : 0,
                transition: "opacity 1.5s ease",
                textShadow: orbReady
                  ? "0 0 80px rgba(139,92,246,0.6), 0 0 160px rgba(139,92,246,0.25)"
                  : "0 0 60px rgba(139,92,246,0.4), 0 0 120px rgba(139,92,246,0.15)",
              }}
            >
              NOVA
            </h1>
            <p className="text-[10px] tracking-[0.4em] text-violet-400/40 mt-1 uppercase font-mono"
              style={{ opacity: phase >= 3 ? 1 : 0, transition: "opacity 1s ease" }}>
              Autonomous Intelligence System
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* LEFT — Terminal console                */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute left-4 top-12 bottom-16 w-[340px] overflow-hidden z-10">
        <div className="text-[9px] text-violet-500/30 mb-2 tracking-[0.3em] uppercase font-mono">
          SYS.CONSOLE
        </div>
        <div className="font-mono text-[11px] leading-4.5">
          {displayLines.map((line, i) => {
            const isNewest = i === displayLines.length - 1
            const age = displayLines.length - 1 - i
            const opacity = isNewest ? 0.85 : Math.max(0.08, 0.6 - age * 0.07)
            const isHighlight = line.includes("OK") || line.includes("VALID") ||
              line.includes("ACTIVE") || line.includes("CONFIRMED") ||
              line.includes("ONLINE") || line.includes("PASS") ||
              line.includes("ALIVE") || line.includes("CONSCIOUS")
            return (
              <div
                key={`fly-${flyingIdx - (displayLines.length - 1 - i)}`}
                className="boot2-fly-line whitespace-nowrap"
                style={{ opacity }}
              >
                <span className="text-violet-500/30 mr-2">{">"}</span>
                <span className={isHighlight ? "text-emerald-400/80" : "text-cyan-300/70"}>
                  {line}
                </span>
                {isNewest && (
                  <span className="boot-cursor inline-block w-1.5 h-3 bg-cyan-400/80 ml-1" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* RIGHT TOP — Hardware Metrics           */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute right-4 top-12 w-64 z-10 font-mono">
        <div className="text-[9px] text-violet-500/30 mb-2 tracking-[0.3em] uppercase">
          HARDWARE STATUS
        </div>

        {/* CPU */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-white/30">CPU LOAD</span>
            <span className="text-violet-400/70">{metrics?.cpu.load ?? "--"}%</span>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.cpu.load ?? 0}%`,
              background: (metrics?.cpu.load ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.load ?? 0) > 50 ? "#f59e0b" : "#22c55e",
            }} />
          </div>
        </div>

        {/* CPU Temp */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.1s" }}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-white/30">CPU TEMP</span>
            <span style={{ color: (metrics?.cpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.temp ?? 0) > 60 ? "#f59e0b" : "#22c55e" }}>
              {metrics?.cpu.temp ?? "--"}°C
            </span>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min((metrics?.cpu.temp ?? 0), 100)}%`,
              background: (metrics?.cpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.cpu.temp ?? 0) > 60 ? "#f59e0b" : "#22c55e",
            }} />
          </div>
        </div>

        {/* Memory */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.2s" }}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-white/30">MEMORY</span>
            <span className="text-violet-400/70">{metrics?.memory.used ?? "--"} / {metrics?.memory.total ?? "--"} GB</span>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.memory.percent ?? 0}%`,
              background: (metrics?.memory.percent ?? 0) > 85 ? "#ef4444" : (metrics?.memory.percent ?? 0) > 70 ? "#f59e0b" : "#a78bfa",
            }} />
          </div>
        </div>

        {/* GPU */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.3s" }}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-white/30">GPU</span>
            <span style={{ color: (metrics?.gpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.gpu.temp ?? 0) > 65 ? "#f59e0b" : "#22c55e" }}>
              {metrics?.gpu.temp ?? "--"}°C
            </span>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min(metrics?.gpu.temp ?? 0, 100)}%`,
              background: (metrics?.gpu.temp ?? 0) > 80 ? "#ef4444" : (metrics?.gpu.temp ?? 0) > 65 ? "#f59e0b" : "#22c55e",
            }} />
          </div>
        </div>

        {/* Disk */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.4s" }}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-white/30">DISK</span>
            <span className="text-violet-400/70">{metrics?.disk.percent ?? "--"}%</span>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${metrics?.disk.percent ?? 0}%`,
              background: (metrics?.disk.percent ?? 0) > 90 ? "#ef4444" : (metrics?.disk.percent ?? 0) > 75 ? "#f59e0b" : "#818cf8",
            }} />
          </div>
        </div>

        {/* Network */}
        <div className="mb-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease 0.5s" }}>
          <div className="flex justify-between text-[10px]">
            <span className="text-white/30">NETWORK</span>
            <span className="text-cyan-400/70">↓{metrics?.network.rx ?? 0} ↑{metrics?.network.tx ?? 0} KB/s</span>
          </div>
        </div>

        {/* System Status Indicator */}
        <div className="mt-2 pt-2 border-t border-white/5" style={{ opacity: phase >= 2 ? 1 : 0, transition: "opacity 0.5s ease 0.6s" }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" style={{
              boxShadow: "0 0 8px rgba(52, 211, 153, 0.6)",
              animation: "boot-blink 2s ease-in-out infinite",
            }} />
            <span className="text-[9px] text-emerald-400/70 tracking-wider">THERMAL OK</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full" style={{
              backgroundColor: metrics ? "#22c55e" : "#f59e0b",
              boxShadow: metrics ? "0 0 8px rgba(34, 197, 94, 0.6)" : "0 0 8px rgba(245, 158, 11, 0.6)",
            }} />
            <span className="text-[9px] tracking-wider" style={{ color: metrics ? "rgba(34, 197, 94, 0.7)" : "rgba(245, 158, 11, 0.7)" }}>
              {metrics ? "SENSORS ACTIVE" : "CONNECTING..."}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* RIGHT BOTTOM — Subsystem boot status   */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute right-4 top-[280px] w-64 z-10 font-mono">
        <div className="text-[9px] text-violet-500/30 mb-2 tracking-[0.3em] uppercase">
          SUBSYSTEMS
        </div>
        <div className="space-y-0.5">
          {SUBSYSTEMS.map((sys) => {
            const isOn = onlineSystems.includes(sys.id)
            return (
              <div key={sys.id} className="flex items-center gap-2" style={{
                animation: isOn ? "boot-subsys-in 0.4s ease forwards" : "none",
              }}>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                  backgroundColor: isOn ? "#34d399" : "rgba(255,255,255,0.06)",
                  boxShadow: isOn ? "0 0 8px rgba(52, 211, 153, 0.6)" : "none",
                  transition: "all 0.4s ease",
                }} />
                <span className={`text-[9px] transition-colors duration-300 ${isOn ? "text-emerald-400/60" : "text-white/8"}`}>
                  {sys.label}
                </span>
                {isOn && (
                  <span className="text-[7px] text-white/15 ml-auto truncate max-w-25">
                    {sys.detail}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* All systems online flash */}
        {allSystemsOnline && (
          <div className="mt-3 px-2 py-1 border border-emerald-500/20 rounded bg-emerald-500/5 animate-in fade-in duration-500">
            <span className="text-[9px] text-emerald-400/80 tracking-widest font-bold">
              ● ALL SYSTEMS NOMINAL
            </span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* BOTTOM LEFT — Network activity          */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute left-4 bottom-14 w-[340px] z-10 font-mono" style={{
        opacity: phase >= 3 ? 1 : 0, transition: "opacity 0.8s ease",
      }}>
        <div className="text-[9px] text-violet-500/30 mb-1 tracking-[0.3em] uppercase">
          NETWORK
        </div>
        <div className="space-y-1">
          {[
            { src: "10.0.42.1", dst: "HUD:3000", proto: "WSS", status: "CONNECTED" },
            { src: "NOVA:8765", dst: "AGENT", proto: "TCP", status: "BOUND" },
            { src: "API:443", dst: "GPT-4.1", proto: "TLS", status: "STREAM" },
            { src: "FISH:443", dst: "TTS.V3", proto: "TLS", status: "CACHED" },
            { src: "MEM:LOCAL", dst: "PERSIST", proto: "FS", status: "SYNCED" },
          ].map((conn, i) => (
            <div key={i} className="flex items-center gap-2 text-[9px]" style={{
              opacity: progress > (i + 1) * 15 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              <span className="text-cyan-400/40">{conn.src}</span>
              <span className="text-white/10">→</span>
              <span className="text-violet-400/40">{conn.dst}</span>
              <span className="text-white/8 ml-auto">{conn.proto}</span>
              <span className="text-emerald-400/50">{conn.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* BOTTOM — Progress bar                  */}
      {/* ═══════════════════════════════════════ */}
      <div className="absolute bottom-4 left-4 right-4 z-10">
        <div className="w-full h-[2px] bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full boot-progress-bar transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 font-mono">
          <p className="text-[10px] text-white/15">
            {progress < 15 ? "BOOTSTRAPPING KERNEL" : progress < 30 ? "INITIALIZING NEURAL ENGINE" : progress < 50 ? "LOADING SUBSYSTEMS" : progress < 70 ? "CALIBRATING VOICE SYNTH" : progress < 85 ? "ESTABLISHING CONNECTIONS" : progress < 100 ? "ACTIVATING NOVA CORE" : "SYSTEM ONLINE — READY"}
          </p>
          <p className="text-[10px] text-violet-400/40">
            {onlineSystems.length}/{SUBSYSTEMS.length} ONLINE — {Math.round(progress)}%
          </p>
        </div>
      </div>

      {/* Corner HUD elements */}
      <div className="absolute top-3 left-4 font-mono text-[9px] text-white/10 leading-tight z-10">
        <div>NOVA.SYS.v4.1</div>
        <div>BUILD.2026.02.01</div>
        <div className="text-violet-500/20">SESSION: {sessionId}</div>
      </div>
      <div className="absolute top-3 right-4 font-mono text-[9px] text-white/10 text-right leading-tight z-10">
        <div>DISPLAY: PRIMARY</div>
        <div>PROTOCOL: QUANTUM-E2E</div>
      </div>
    </div>
  )
}
