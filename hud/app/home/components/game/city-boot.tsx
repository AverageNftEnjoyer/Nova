"use client"

import { useEffect, useRef, useState, type MutableRefObject } from "react"
import { WindowControls } from "@/components/window/window-controls"
import { CITY_BOOT_LABEL, type CityBootPhase } from "@/components/pixel-city/boot"
import { cn } from "@/lib/shared/utils"
import { NovaPortrait } from "./nova-portrait"

/**
 * Home's boot screen. It covers the city until Pixi has drawn the first frame, and the bar moves with the real
 * load (the chunk, WebGL, then the map) instead of a timer. U.B Agents the cat walks the shore in step with that bar.
 * Reduced motion holds the cat still and fades the screen off as soon as the city is up.
 */

const FLOOR: Record<CityBootPhase, number> = { charts: 0.05, engine: 0.28, map: 0.62, gates: 0.92 }
const CAP: Record<CityBootPhase, number> = { charts: 0.24, engine: 0.58, map: 0.9, gates: 1 }

interface CityBootProps {
  phase: CityBootPhase
  /** The fade has finished: unmount the screen. */
  onDone: () => void
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])
  return reduced
}

/** The displayed percent. It steps forward with the phase and creeps while a stage is still working. */
function useBootPercent(phase: CityBootPhase, reduced: boolean, valueRef: MutableRefObject<number>): number {
  const [percent, setPercent] = useState(0)
  useEffect(() => {
    const floor = FLOOR[phase]
    const cap = CAP[phase]
    const publish = (value: number) => {
      valueRef.current = value
      const next = Math.round(value * 100)
      setPercent((prev) => (prev === next ? prev : next))
    }
    if (reduced) {
      publish(phase === "gates" ? 1 : floor)
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      let value = valueRef.current
      if (value < floor) value = floor
      const remaining = cap - value
      const speed = phase === "gates" ? 0.85 : 0.08 + remaining * 0.35
      value = Math.min(cap, value + speed * dt)
      publish(value)
      if (value < cap - 0.0005) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, reduced, valueRef])
  return percent
}

export function CityBoot({ phase, onDone }: CityBootProps) {
  const reduced = usePrefersReducedMotion()
  const valueRef = useRef(0)
  const percent = useBootPercent(phase, reduced, valueRef)
  const [leaving, setLeaving] = useState(false)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (phase !== "gates") return
    let alive = true
    let holdTimer = 0
    let fadeTimer = 0
    let raf = 0
    const wait = () => {
      if (!alive) return
      if (valueRef.current < 0.999) {
        raf = requestAnimationFrame(wait)
        return
      }
      const hold = reduced ? 40 : 340
      const fade = reduced ? 90 : 460
      holdTimer = window.setTimeout(() => {
        if (!alive) return
        setLeaving(true)
        fadeTimer = window.setTimeout(() => {
          if (alive) onDoneRef.current()
        }, fade)
      }, hold)
    }
    raf = requestAnimationFrame(wait)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(holdTimer)
      window.clearTimeout(fadeTimer)
    }
  }, [phase, reduced])

  const label = CITY_BOOT_LABEL[phase]

  return (
    <div className={cn("city-boot", leaving && "is-leaving")} data-city-boot={leaving ? "leaving" : "on"}>
      <div className="game-hud-drag" aria-hidden="true" />
      <div className="city-boot-controls">
        <div className="game-winctl">
          <WindowControls />
        </div>
      </div>

      <BootClouds />

      <div className="city-boot-card pixel-frame">
        <NovaPortrait className="city-boot-mark" />
        <h1 className="pixel-title city-boot-title">U.B Agents City</h1>
        <p className="pixel-label" role="status">
          {label}
          {phase === "gates" ? null : <span className="city-boot-caret" aria-hidden="true" />}
        </p>
        <div
          className="pixel-bar pixel-bar--teal"
          role="progressbar"
          aria-label="Loading U.B Agents City"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={label}
        >
          <span className="pixel-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="city-boot-shore" aria-hidden="true">
        <Shore />
        <span className="city-boot-walker" style={{ left: `${14 + percent * 0.62}%` }}>
          <Walker />
        </span>
      </div>
    </div>
  )
}

function BootClouds() {
  return (
    <svg className="city-boot-clouds" viewBox="0 0 320 90" preserveAspectRatio="xMidYMin slice" shapeRendering="crispEdges" aria-hidden="true">
      <Cloud x={18} y={16} />
      <Cloud x={148} y={28} />
      <Cloud x={250} y={12} />
    </svg>
  )
}

function Cloud({ x, y }: { x: number; y: number }) {
  return (
    <g fill="#f4fbff">
      <rect x={x} y={y + 4} width="28" height="6" />
      <rect x={x + 4} y={y} width="16" height="4" />
      <rect x={x + 6} y={y + 10} width="18" height="2" />
    </g>
  )
}

/** The island the cat walks, in the city's own colours. The sea behind it is the boot screen's background. */
function Shore() {
  return (
    <svg viewBox="0 0 240 72" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
      <rect x="0" y="46" width="240" height="26" fill="#3e7c34" />
      <rect x="0" y="46" width="240" height="10" fill="#5ea84a" />
      <rect x="16" y="50" width="208" height="4" fill="#e6c48a" />
      <rect x="0" y="44" width="240" height="2" fill="#0187b8" />

      <House x={14} />
      <Gate x={48} />
      <Fountain x={92} />
      <Spire x={124} />
      <Dome x={152} />
      <Pier x={196} />
    </svg>
  )
}

const INK = "#14213f"

function House({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={30} width="22" height="16" fill={INK} />
      <rect x={x + 2} y={34} width="18" height="12" fill="#c4554a" />
      <rect x={x + 2} y={32} width="18" height="4" fill="#e5483f" />
      <rect x={x + 8} y={38} width="6" height="8" fill="#e6c48a" />
      <rect x={x + 4} y={36} width="3" height="3" fill="#ffcf4a" />
    </g>
  )
}

function Gate({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={22} width="8" height="24" fill={INK} />
      <rect x={x + 22} y={22} width="8" height="24" fill={INK} />
      <rect x={x} y={20} width="30" height="6" fill={INK} />
      <rect x={x + 2} y={24} width="4" height="20" fill="#4f73a8" />
      <rect x={x + 24} y={24} width="4" height="20" fill="#4f73a8" />
      <rect x={x + 2} y={22} width="26" height="4" fill="#9cc0ea" />
      <rect x={x + 12} y={28} width="6" height="6" fill="#ffcf4a" />
    </g>
  )
}

function Fountain({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={38} width="22" height="8" fill={INK} />
      <rect x={x + 2} y={36} width="18" height="8" fill="#9cc0ea" />
      <rect x={x + 8} y={28} width="6" height="10" fill="#27c4c4" />
      <rect x={x + 6} y={26} width="10" height="3" fill="#7ec8e8" />
      <rect x={x + 10} y={22} width="2" height="6" fill="#f4fbff" />
    </g>
  )
}

function Spire({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={16} width="16" height="30" fill={INK} />
      <rect x={x + 2} y={20} width="12" height="24" fill="#4f73a8" />
      <rect x={x + 6} y={8} width="4" height="12" fill={INK} />
      <rect x={x + 4} y={6} width="8" height="4" fill="#ffcf4a" />
      <rect x={x + 5} y={28} width="6" height="4" fill="#ffcf4a" />
    </g>
  )
}

function Dome({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={34} width="28" height="12" fill={INK} />
      <rect x={x + 2} y={32} width="24" height="12" fill="#6a45b0" />
      <rect x={x + 6} y={26} width="16" height="8" fill="#4b3590" />
      <rect x={x + 10} y={22} width="8" height="6" fill="#c7a9ff" />
      <rect x={x + 12} y={36} width="4" height="8" fill="#ffcf4a" />
    </g>
  )
}

function Pier({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={42} width="28" height="4" fill="#8a5a32" />
      <rect x={x + 2} y={46} width="3" height="8" fill="#6b4424" />
      <rect x={x + 12} y={46} width="3" height="8" fill="#6b4424" />
      <rect x={x + 22} y={46} width="3" height="8" fill="#6b4424" />
      <rect x={x + 6} y={34} width="12" height="8" fill="#e5483f" />
      <rect x={x + 8} y={36} width="4" height="4" fill="#ffcf4a" />
    </g>
  )
}

/** U.B Agents the cat, side on, with the suit's cyan visor. Two leg poses swap while she walks. */
function Walker() {
  return (
    <svg viewBox="0 0 18 14" shapeRendering="crispEdges">
      <g fill="#0d0b1c">
        <rect x="1" y="6" width="3" height="2" />
        <rect x="3" y="4" width="9" height="5" />
        <rect x="10" y="2" width="7" height="6" />
        <rect x="11" y="1" width="2" height="2" />
        <rect x="15" y="1" width="2" height="2" />
      </g>
      <rect x="13" y="4" width="2" height="1" fill="#27c4c4" />
      <rect x="16" y="5" width="1" height="1" fill="#ff7aa8" />
      <g className="city-boot-legs-a" fill="#0d0b1c">
        <rect x="4" y="9" width="2" height="3" />
        <rect x="10" y="9" width="2" height="3" />
      </g>
      <g className="city-boot-legs-b" fill="#0d0b1c">
        <rect x="6" y="9" width="2" height="3" />
        <rect x="8" y="9" width="2" height="3" />
      </g>
    </svg>
  )
}
