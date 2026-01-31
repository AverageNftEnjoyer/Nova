"use client"

import { useEffect, useRef, useState } from "react"

interface PartyOverlayProps {
  active: boolean
  onEnd: () => void
}

// Deterministic disco colors
const DISCO_COLORS = [
  "#ff006e", "#fb5607", "#ffbe0b", "#8338ec",
  "#3a86ff", "#06d6a0", "#e63946", "#f72585",
  "#7209b7", "#4cc9f0", "#80ffdb", "#ff595e",
]

function makeSpotlights(count: number) {
  const spots = []
  for (let i = 0; i < count; i++) {
    const seed = i / count
    const seed2 = ((i * 7 + 3) % count) / count
    spots.push({
      left: seed2 * 100,
      top: seed * 80,
      color: DISCO_COLORS[i % DISCO_COLORS.length],
      size: 150 + seed * 200,
      delay: seed2 * 2,
    })
  }
  return spots
}

const SPOTLIGHTS = makeSpotlights(12)

// Shared AudioContext - initialized on first user interaction
let sharedCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContext()
  }
  if (sharedCtx.state === "suspended") {
    sharedCtx.resume()
  }
  return sharedCtx
}

// Warm up the AudioContext on ANY user interaction so it's ready for party mode
if (typeof window !== "undefined") {
  const warmUp = () => {
    getAudioContext()
    window.removeEventListener("click", warmUp)
    window.removeEventListener("keydown", warmUp)
    window.removeEventListener("touchstart", warmUp)
  }
  window.addEventListener("click", warmUp, { once: true })
  window.addEventListener("keydown", warmUp, { once: true })
  window.addEventListener("touchstart", warmUp, { once: true })
}

export function PartyOverlay({ active, onEnd }: PartyOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  const [visible, setVisible] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!active) {
      startedRef.current = false
      return
    }

    if (startedRef.current) return
    startedRef.current = true

    setVisible(true)

    const audio = new Audio("/sounds/party.mp3")
    audioRef.current = audio

    try {
      const ctx = getAudioContext()
      // Only create a new source if we have a fresh audio element
      const source = ctx.createMediaElementSource(audio)
      sourceRef.current = source
      const gain = ctx.createGain()
      gain.gain.value = 0.25
      source.connect(gain)
      gain.connect(ctx.destination)
    } catch (e) {
      audio.volume = 1.0
    }

    audio.play().catch((e) => console.error("[Party] Audio play failed:", e))

    const maxTimer = setTimeout(() => {
      setVisible(false)
      startedRef.current = false
      onEndRef.current()
    }, 60000)

    audio.onended = () => {
      setVisible(false)
      startedRef.current = false
      onEndRef.current()
    }

    return () => {
      clearTimeout(maxTimer)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect()
        sourceRef.current = null
      }
    }
  }, [active])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden party-overlay">
      {/* Color flash overlay */}
      <div className="absolute inset-0 party-flash" />

      {/* Disco spotlights */}
      {SPOTLIGHTS.map((spot, i) => (
        <div
          key={i}
          className="absolute rounded-full party-spotlight"
          style={{
            left: `${spot.left}%`,
            top: `${spot.top}%`,
            width: spot.size,
            height: spot.size,
            background: `radial-gradient(circle, ${spot.color}40 0%, ${spot.color}15 40%, transparent 70%)`,
            animationDelay: `${spot.delay}s`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}

      {/* Laser beams */}
      <div className="absolute inset-0">
        <div className="party-laser party-laser-1" />
        <div className="party-laser party-laser-2" />
        <div className="party-laser party-laser-3" />
        <div className="party-laser party-laser-4" />
      </div>

      {/* Strobe flash */}
      <div className="absolute inset-0 party-strobe" />
    </div>
  )
}
