"use client"

import { useEffect, useState, useRef } from "react"

interface BootScreenProps {
  onComplete: () => void
}

const BOOT_LINES = [
  { text: "NOVA CORE v4.1 initializing...", delay: 0 },
  { text: "Neural pathway linkage established", delay: 1200 },
  { text: "WebSocket bridge [PORT 8765] .... ONLINE", delay: 2800 },
  { text: "Voice synthesis engine calibrated", delay: 4200 },
  { text: "Persistent memory loaded [OK]", delay: 5800 },
  { text: "HUD interface mounted", delay: 7200 },
  { text: "OpenAI GPT-4.1 connected", delay: 8800 },
  { text: "System diagnostics .... ALL PASS", delay: 10200 },
  { text: "All systems nominal", delay: 12000 },
  { text: "NOVA ONLINE", delay: 13500 },
]

const SYSTEM_STATS = [
  { label: "CPU", value: "12.4%", bar: 12 },
  { label: "MEM", value: "2.1 GB", bar: 34 },
  { label: "NET", value: "42 ms", bar: 8 },
  { label: "GPU", value: "7.8%", bar: 8 },
]

// Deterministic particle generation
function makeParticles(count: number) {
  const particles = []
  for (let i = 0; i < count; i++) {
    const seed = i / count
    const seed2 = ((i * 7 + 3) % count) / count
    const seed3 = ((i * 13 + 5) % count) / count
    particles.push({
      w: seed * 2 + 0.5,
      left: seed2 * 100,
      top: seed3 * 100,
      hue: 220 + seed * 60,
      light: 50 + seed2 * 30,
      delay: seed3 * 8,
      dur: 4 + seed * 6,
    })
  }
  return particles
}

// Deterministic hex grid positions
function makeHexGrid(count: number) {
  const hexes = []
  for (let i = 0; i < count; i++) {
    const seed = i / count
    const seed2 = ((i * 11 + 7) % count) / count
    hexes.push({
      left: seed2 * 100,
      top: seed * 100,
      size: 20 + (((i * 3) % count) / count) * 40,
      delay: seed * 3,
      opacity: 0.03 + seed2 * 0.06,
    })
  }
  return hexes
}

const PARTICLES = makeParticles(60)
const HEX_GRID = makeHexGrid(20)

// Deterministic scan line positions
function makeScanLines(count: number) {
  const lines = []
  for (let i = 0; i < count; i++) {
    lines.push({
      top: (i / count) * 100,
      delay: ((i * 7 + 2) % count) / count * 6,
      width: 30 + ((i * 13) % count) / count * 60,
      left: ((i * 11) % count) / count * 40,
    })
  }
  return lines
}

const SCAN_LINES = makeScanLines(8)

export function BootScreen({ onComplete }: BootScreenProps) {
  const [visibleLines, setVisibleLines] = useState<number>(0)
  const [progress, setProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [arcReactorPhase, setArcReactorPhase] = useState(0)
  const startTime = useRef(Date.now())

  // Progress bar animation
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime.current
      const pct = Math.min((elapsed / 14000) * 100, 100)
      setProgress(pct)
      if (pct >= 100) clearInterval(interval)
    }, 50)
    return () => clearInterval(interval)
  }, [])

  // Arc reactor phases
  useEffect(() => {
    const timers = [
      setTimeout(() => setArcReactorPhase(1), 500),
      setTimeout(() => setArcReactorPhase(2), 2000),
      setTimeout(() => setArcReactorPhase(3), 5000),
      setTimeout(() => setArcReactorPhase(4), 10000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Reveal boot lines
  useEffect(() => {
    const timers = BOOT_LINES.map((line, i) =>
      setTimeout(() => setVisibleLines(i + 1), line.delay),
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  // Fade out and complete at 15s
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

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#04040a] transition-opacity duration-700 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Background grid pattern */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Hex grid elements */}
      <div className="absolute inset-0 overflow-hidden">
        {HEX_GRID.map((hex, i) => (
          <div
            key={`hex-${i}`}
            className="absolute boot-hex"
            style={{
              left: `${hex.left}%`,
              top: `${hex.top}%`,
              width: hex.size,
              height: hex.size,
              border: `1px solid rgba(139, 92, 246, ${hex.opacity})`,
              transform: "rotate(30deg)",
              clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
              animationDelay: `${hex.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Animated scan lines */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {SCAN_LINES.map((line, i) => (
          <div
            key={`scan-${i}`}
            className="absolute h-[1px] boot-scan-line"
            style={{
              top: `${line.top}%`,
              left: `${line.left}%`,
              width: `${line.width}%`,
              background: "linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.08), transparent)",
              animationDelay: `${line.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden">
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="boot-particle absolute rounded-full"
            style={{
              width: p.w,
              height: p.w,
              left: `${p.left}%`,
              top: `${p.top}%`,
              backgroundColor: `hsl(${p.hue}, 70%, ${p.light}%)`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
            }}
          />
        ))}
      </div>

      {/* Center content */}
      <div className="relative flex flex-col items-center gap-6 px-6 max-w-3xl w-full">

        {/* Arc Reactor */}
        <div className="relative" style={{ width: 200, height: 200 }}>
          {/* Outer ring */}
          <div
            className="absolute inset-0 rounded-full boot-arc-ring-outer"
            style={{
              border: "1px solid rgba(139, 92, 246, 0.2)",
              opacity: arcReactorPhase >= 1 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}
          />

          {/* Second ring */}
          <div
            className="absolute rounded-full boot-arc-ring-2"
            style={{
              inset: 15,
              border: "1px solid rgba(99, 102, 241, 0.25)",
              opacity: arcReactorPhase >= 2 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}
          />

          {/* Third ring with dashes */}
          <div
            className="absolute rounded-full boot-arc-ring-3"
            style={{
              inset: 30,
              border: "2px dashed rgba(167, 139, 250, 0.15)",
              opacity: arcReactorPhase >= 2 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}
          />

          {/* Inner ring */}
          <div
            className="absolute rounded-full"
            style={{
              inset: 45,
              border: "1px solid rgba(139, 92, 246, 0.3)",
              opacity: arcReactorPhase >= 3 ? 1 : 0,
              transition: "opacity 0.5s ease",
              boxShadow: "inset 0 0 30px rgba(139, 92, 246, 0.1), 0 0 30px rgba(139, 92, 246, 0.1)",
            }}
          />

          {/* Core orb */}
          <div
            className="absolute rounded-full boot-orb"
            style={{
              inset: 60,
              opacity: arcReactorPhase >= 1 ? 1 : 0,
              transition: "opacity 1s ease",
            }}
          />

          {/* Core inner glow */}
          <div
            className="absolute rounded-full boot-orb-inner"
            style={{
              inset: 60,
              opacity: arcReactorPhase >= 2 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}
          />

          {/* Core highlight */}
          <div
            className="absolute rounded-full"
            style={{
              inset: 60,
              background: "linear-gradient(to bottom, rgba(255,255,255,0.3) 0%, transparent 60%)",
              opacity: arcReactorPhase >= 2 ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}
          />

          {/* Radial glow behind */}
          <div
            className="absolute boot-glow"
            style={{
              inset: -80,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(139,92,246,0.12) 0%, rgba(99,102,241,0.06) 30%, transparent 60%)",
              opacity: arcReactorPhase >= 3 ? 1 : 0,
              transition: "opacity 1s ease",
            }}
          />

          {/* Crosshair lines */}
          {arcReactorPhase >= 2 && (
            <>
              <div className="absolute top-1/2 left-0 right-0 h-[1px]" style={{ background: "linear-gradient(90deg, transparent 10%, rgba(139, 92, 246, 0.12) 30%, rgba(139, 92, 246, 0.12) 70%, transparent 90%)" }} />
              <div className="absolute left-1/2 top-0 bottom-0 w-[1px]" style={{ background: "linear-gradient(180deg, transparent 10%, rgba(139, 92, 246, 0.12) 30%, rgba(139, 92, 246, 0.12) 70%, transparent 90%)" }} />
            </>
          )}

          {/* Corner brackets */}
          {arcReactorPhase >= 3 && (
            <>
              <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-violet-500/30" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-violet-500/30" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-violet-500/30" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-violet-500/30" />
            </>
          )}
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-4xl font-light tracking-[0.4em] text-white/90 boot-title">
            NOVA
          </h1>
          <p className="text-[10px] tracking-[0.3em] text-violet-400/50 mt-2 uppercase font-mono">
            Autonomous AI System
          </p>
        </div>

        {/* Main content: boot log + system stats side by side */}
        <div className="w-full flex gap-6">
          {/* Boot log */}
          <div className="flex-1 h-48 overflow-hidden font-mono text-xs">
            <div className="text-[10px] text-violet-500/40 mb-2 tracking-widest uppercase">System Log</div>
            {BOOT_LINES.slice(0, visibleLines).map((line, i) => {
              const isLast = i === visibleLines - 1
              const isSuccess = line.text.includes("ONLINE") || line.text.includes("OK") || line.text.includes("ALL PASS") || line.text.includes("NOVA ONLINE")
              return (
                <div
                  key={i}
                  className="boot-line flex items-center gap-2 py-0.5"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <span className="text-violet-500/40 text-[10px] font-mono w-12 shrink-0">
                    {String(i).padStart(2, "0")}:{String(Math.floor((BOOT_LINES[i].delay / 1000) % 60)).padStart(2, "0")}
                  </span>
                  <span
                    className={
                      isSuccess
                        ? "text-emerald-400/80"
                        : isLast
                        ? "text-violet-300/90"
                        : "text-white/25"
                    }
                  >
                    {line.text}
                  </span>
                  {isLast && (
                    <span className="boot-cursor inline-block w-1.5 h-3.5 bg-violet-400/80 ml-0.5" />
                  )}
                </div>
              )
            })}
          </div>

          {/* System stats panel */}
          <div className="w-40 shrink-0 font-mono text-xs">
            <div className="text-[10px] text-violet-500/40 mb-2 tracking-widest uppercase">Diagnostics</div>
            {SYSTEM_STATS.map((stat, i) => (
              <div key={i} className="mb-3">
                <div className="flex justify-between text-white/30 mb-1">
                  <span>{stat.label}</span>
                  <span className="text-violet-400/60">{stat.value}</span>
                </div>
                <div className="h-[2px] bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full boot-stat-bar"
                    style={{
                      width: `${Math.min(progress * (stat.bar / 100) * 3, stat.bar)}%`,
                      background: "linear-gradient(90deg, rgba(139, 92, 246, 0.6), rgba(99, 102, 241, 0.4))",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            ))}

            {/* Status indicators */}
            <div className="mt-4 space-y-1.5">
              {["CORE", "NET", "VOICE", "MEM"].map((sys, i) => {
                const threshold = [2, 4, 6, 8]
                const isOn = progress > threshold[i] * 10
                return (
                  <div key={sys} className="flex items-center gap-2">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor: isOn ? "#34d399" : "rgba(255,255,255,0.1)",
                        boxShadow: isOn ? "0 0 6px rgba(52, 211, 153, 0.5)" : "none",
                        transition: "all 0.3s ease",
                      }}
                    />
                    <span className={`text-[10px] ${isOn ? "text-emerald-400/60" : "text-white/15"} transition-colors`}>
                      {sys}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full">
          <div className="w-full h-[2px] bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full boot-progress-bar transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 font-mono">
            <p className="text-[10px] text-white/15">
              {progress < 100 ? "INITIALIZING" : "READY"}
            </p>
            <p className="text-[10px] text-violet-400/40">
              {Math.round(progress)}%
            </p>
          </div>
        </div>
      </div>

      {/* Corner HUD elements */}
      <div className="absolute top-4 left-4 font-mono text-[9px] text-white/10 leading-relaxed boot-hud-corner">
        <div>SYS.NOVA.4.1</div>
        <div>BUILD.2026.01</div>
      </div>
      <div className="absolute top-4 right-4 font-mono text-[9px] text-white/10 text-right leading-relaxed boot-hud-corner">
        <div>LAT 40.7128</div>
        <div>LNG -74.0060</div>
      </div>
      <div className="absolute bottom-4 left-4 font-mono text-[9px] text-white/10 boot-hud-corner">
        NOVA AI SYSTEMS
      </div>
      <div className="absolute bottom-4 right-4 font-mono text-[9px] text-white/10 text-right boot-hud-corner">
        ENCRYPTED
      </div>

      {/* Scanning line overlay */}
      <div className="absolute inset-0 pointer-events-none boot-scan-overlay" />
    </div>
  )
}
