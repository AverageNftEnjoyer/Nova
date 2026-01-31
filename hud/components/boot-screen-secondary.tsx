"use client"

import { useEffect, useState, useRef, useCallback } from "react"

interface BootScreenSecondaryProps {
  onComplete: () => void
}

// Hacker-style flying text lines — sci-fi system output
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

// Iron Man style HUD readouts that appear around the arc reactor
const HUD_READOUTS = [
  { text: "PWR OUTPUT", value: "3.21 GW", angle: -30, distance: 180, delay: 1 },
  { text: "NEURAL SYNC", value: "99.7%", angle: 30, distance: 185, delay: 2 },
  { text: "CORE TEMP", value: "42.1°C", angle: 150, distance: 175, delay: 3 },
  { text: "LATENCY", value: "0.3ms", angle: 210, distance: 180, delay: 4 },
  { text: "BANDWIDTH", value: "12.4 TB/s", angle: -60, distance: 200, delay: 5 },
  { text: "ENCRYPTION", value: "QUANTUM", angle: 60, distance: 195, delay: 6 },
]

// Arc segments for the Iron Man HUD rings
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

// Targeting reticle tick marks
function makeTickMarks(count: number, radius: number) {
  const ticks = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 360
    const isMajor = i % 4 === 0
    ticks.push({ angle, radius, length: isMajor ? 12 : 6, isMajor })
  }
  return ticks
}

// Floating hex values in background
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
  const startTime = useRef(Date.now())
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Generate session ID client-side only to avoid hydration mismatch
  useEffect(() => {
    setSessionId(Math.random().toString(36).slice(2, 10).toUpperCase())
  }, [])

  // Progress bar
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime.current
      const pct = Math.min((elapsed / 14000) * 100, 100)
      setProgress(pct)
      if (pct >= 100) clearInterval(interval)
    }, 50)
    return () => clearInterval(interval)
  }, [])

  // Phases
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

  // Flying hacker text — rapid fire
  useEffect(() => {
    const interval = setInterval(() => {
      setFlyingIdx((prev) => {
        if (prev >= FLYING_LINES.length - 1) return prev
        return prev + 1
      })
    }, 420)
    return () => clearInterval(interval)
  }, [])

  // HUD readouts appear over time
  useEffect(() => {
    const timers = HUD_READOUTS.map((r, i) =>
      setTimeout(() => setVisibleReadouts(i + 1), r.delay * 1000)
    )
    return () => timers.forEach(clearTimeout)
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
      // Horizontal scan lines
      ctx.fillStyle = "rgba(139, 92, 246, 0.015)"
      for (let y = 0; y < canvas.height; y += 3) {
        if ((y + frame) % 6 < 3) {
          ctx.fillRect(0, y, canvas.width, 1)
        }
      }
      // Moving scan bar
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
  const displayLines = visibleLines.slice(-12) // Show last 12 lines

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#030308] overflow-hidden transition-opacity duration-700 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Scanline canvas overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-[1]"
      />

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

      {/* Center HUD — Iron Man style arc reactor + rings */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 500, height: 500 }}>
          <svg
            viewBox="0 0 500 500"
            className="absolute inset-0 w-full h-full"
            style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 1s ease" }}
            suppressHydrationWarning
          >
            {/* Tick marks — targeting reticle */}
            {phase >= 2 && TICK_MARKS.map((tick, i) => {
              const rad = (tick.angle * Math.PI) / 180
              const x1 = +(250 + tick.radius * Math.cos(rad)).toFixed(4)
              const y1 = +(250 + tick.radius * Math.sin(rad)).toFixed(4)
              const x2 = +(250 + (tick.radius + tick.length) * Math.cos(rad)).toFixed(4)
              const y2 = +(250 + (tick.radius + tick.length) * Math.sin(rad)).toFixed(4)
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
                d={arcPath(250, 250, seg.r, seg.startAngle, seg.span)}
                fill="none"
                stroke={`rgba(139, 92, 246, ${0.15 + seg.ring * 0.05})`}
                strokeWidth={seg.ring === 0 ? 2 : 1}
                className={`boot2-arc-ring-${seg.ring}`}
                style={{
                  transformOrigin: "250px 250px",
                  opacity: phase >= 2 ? 1 : 0,
                  transition: `opacity 0.5s ease ${seg.delay * 0.1}s`,
                }}
              />
            ))}

            {/* Inner circle */}
            <circle cx="250" cy="250" r="60" fill="none"
              stroke="rgba(139, 92, 246, 0.2)" strokeWidth="1"
              style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />
            <circle cx="250" cy="250" r="62" fill="none"
              stroke="rgba(139, 92, 246, 0.08)" strokeWidth="0.5"
              strokeDasharray="4 4"
              className="boot2-arc-ring-0"
              style={{ transformOrigin: "250px 250px", opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.5s ease" }}
            />

            {/* Crosshairs */}
            {phase >= 2 && (
              <>
                <line x1="250" y1="170" x2="250" y2="195" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="250" y1="305" x2="250" y2="330" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="170" y1="250" x2="195" y2="250" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
                <line x1="305" y1="250" x2="330" y2="250" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="0.5" />
              </>
            )}

            {/* Diagonal hash marks */}
            {phase >= 3 && [45, 135, 225, 315].map((a) => {
              const rad = (a * Math.PI) / 180
              const x1 = +(250 + 72 * Math.cos(rad)).toFixed(4)
              const y1 = +(250 + 72 * Math.sin(rad)).toFixed(4)
              const x2 = +(250 + 82 * Math.cos(rad)).toFixed(4)
              const y2 = +(250 + 82 * Math.sin(rad)).toFixed(4)
              return (
                <line key={`diag-${a}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(167, 139, 250, 0.25)" strokeWidth="1" />
              )
            })}
          </svg>

          {/* Center orb */}
          <div className="absolute" style={{ inset: 195 }}>
            <div
              className="w-full h-full rounded-full"
              style={{
                background: phase >= 4
                  ? "radial-gradient(circle at 40% 35%, #c4b5fd 0%, #8b5cf6 30%, #6d28d9 60%, #4c1d95 100%)"
                  : phase >= 2
                  ? "radial-gradient(circle at 40% 35%, rgba(196,181,253,0.5) 0%, rgba(139,92,246,0.3) 60%, transparent 100%)"
                  : "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
                boxShadow: phase >= 3
                  ? "0 0 60px rgba(139,92,246,0.5), 0 0 120px rgba(139,92,246,0.25), inset 0 0 30px rgba(167,139,250,0.4)"
                  : "0 0 20px rgba(139,92,246,0.1)",
                transition: "all 1.5s ease",
                opacity: phase >= 1 ? 1 : 0,
              }}
            />
            {/* Specular */}
            <div className="absolute inset-0 rounded-full"
              style={{
                background: "linear-gradient(to bottom, rgba(255,255,255,0.35) 0%, transparent 55%)",
                opacity: phase >= 3 ? 1 : 0,
                transition: "opacity 1s ease",
              }}
            />
          </div>

          {/* HUD readouts floating around the reactor */}
          {HUD_READOUTS.slice(0, visibleReadouts).map((r, i) => {
            const rad = (r.angle * Math.PI) / 180
            const x = 250 + r.distance * Math.cos(rad)
            const y = 250 + r.distance * Math.sin(rad)
            return (
              <div
                key={`readout-${i}`}
                className="absolute font-mono boot2-readout-in"
                style={{
                  left: x, top: y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="text-[8px] text-violet-400/40 tracking-widest">{r.text}</div>
                <div className="text-[13px] text-white/70 tracking-wide">{r.value}</div>
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
                textShadow: "0 0 60px rgba(139,92,246,0.4), 0 0 120px rgba(139,92,246,0.15)",
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

      {/* Flying hacker text — left side terminal */}
      <div className="absolute left-6 top-16 bottom-20 w-[420px] overflow-hidden z-10">
        <div className="text-[9px] text-violet-500/30 mb-2 tracking-[0.3em] uppercase font-mono">
          SYS.CONSOLE
        </div>
        <div className="font-mono text-[11px] leading-[18px]">
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

      {/* Right side — system diagnostics panel */}
      <div className="absolute right-6 top-16 w-52 z-10 font-mono">
        <div className="text-[9px] text-violet-500/30 mb-3 tracking-[0.3em] uppercase">
          DIAGNOSTICS
        </div>

        {[
          { label: "CPU", value: "12.4%", bar: 12, color: "#8b5cf6" },
          { label: "MEM", value: "2.1 GB", bar: 34, color: "#a78bfa" },
          { label: "GPU", value: "87.3%", bar: 87, color: "#c084fc" },
          { label: "NET", value: "42 ms", bar: 8, color: "#818cf8" },
          { label: "NEURAL", value: "99.7%", bar: 99, color: "#34d399" },
          { label: "VOICE", value: "READY", bar: 100, color: "#34d399" },
        ].map((stat, i) => (
          <div key={i} className="mb-2.5" style={{
            opacity: phase >= 1 ? 1 : 0,
            transition: `opacity 0.5s ease ${i * 0.3}s`,
          }}>
            <div className="flex justify-between text-[10px] text-white/25 mb-0.5">
              <span>{stat.label}</span>
              <span className="text-violet-400/50">{stat.value}</span>
            </div>
            <div className="h-[2px] bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${Math.min(progress * (stat.bar / 100) * 2, stat.bar)}%`,
                  background: stat.color,
                  opacity: 0.6,
                }}
              />
            </div>
          </div>
        ))}

        {/* Status lights */}
        <div className="mt-4 space-y-1.5">
          {["CORE", "BRIDGE", "VOICE", "MEMORY", "HUD", "AI"].map((sys, i) => {
            const threshold = [5, 15, 25, 35, 50, 70]
            const isOn = progress > threshold[i]
            return (
              <div key={sys} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{
                  backgroundColor: isOn ? "#34d399" : "rgba(255,255,255,0.08)",
                  boxShadow: isOn ? "0 0 8px rgba(52, 211, 153, 0.6)" : "none",
                  transition: "all 0.5s ease",
                }} />
                <span className={`text-[9px] ${isOn ? "text-emerald-400/50" : "text-white/10"} transition-colors`}>
                  {sys}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom progress bar */}
      <div className="absolute bottom-6 left-6 right-6 z-10">
        <div className="w-full h-[2px] bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full boot-progress-bar transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 font-mono">
          <p className="text-[10px] text-white/15">
            {progress < 30 ? "BOOTSTRAPPING" : progress < 70 ? "LOADING SUBSYSTEMS" : progress < 100 ? "FINALIZING" : "SYSTEM ONLINE"}
          </p>
          <p className="text-[10px] text-violet-400/40">
            {Math.round(progress)}%
          </p>
        </div>
      </div>

      {/* Corner HUD elements */}
      <div className="absolute top-4 left-6 font-mono text-[9px] text-white/10 leading-relaxed z-10">
        <div>NOVA.SYS.v4.1</div>
        <div>BUILD.2026.01.31</div>
        <div className="text-violet-500/20">SESSION: {sessionId}</div>
      </div>
      <div className="absolute top-4 right-6 font-mono text-[9px] text-white/10 text-right leading-relaxed z-10">
        <div>DISPLAY: SECONDARY</div>
        <div>PROTOCOL: QUANTUM-E2E</div>
      </div>
    </div>
  )
}
