"use client"

import type { CSSProperties } from "react"
import { cn } from "@/lib/shared/utils"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"

/**
 * What the portrait is showing. Maps the old orb semantics onto the cat:
 * idle = resting bob, thinking = fast bob + pixel dots (the orb's spinning "working" glow),
 * speaking = hopping with sound ticks, listening = an alert mark, muted = "z" mark, offline = dimmed with a red cross.
 */
export type NovaCatState = "idle" | "thinking" | "speaking" | "listening" | "muted" | "offline"

export function resolveNovaCatState(params: { agentConnected?: boolean; novaState?: NovaState; thinking?: boolean }): NovaCatState {
  if (params.agentConnected === false) return "offline"
  if (params.thinking || params.novaState === "thinking") return "thinking"
  if (params.novaState === "speaking") return "speaking"
  if (params.novaState === "listening") return "listening"
  if (params.novaState === "muted") return "muted"
  return "idle"
}

interface NovaCatPortraitProps {
  state?: NovaCatState
  /** Screen pixels per sprite pixel (the sprite is one 24 px cell, so the portrait is 24 x scale wide). */
  scale?: number
  /** The user's orb colour: tints the state marks so the Settings choice still shows. */
  accent?: string
  /** Freeze the animation (inactive page), like the orb stopping when the page is hidden. */
  paused?: boolean
  className?: string
}

/**
 * U.B Agents the cat, sitting and facing the viewer (public/pixel-city/town/characters/cat.png, one 24 px cell), drawn
 * with `image-rendering: pixelated`. The same sprite the city draws; states are CSS-only (stepped, no blur or glow).
 */
export function NovaCatPortrait({ state = "idle", scale = 2, accent, paused = false, className }: NovaCatPortraitProps) {
  const style = { "--cat-scale": scale, ...(accent ? { "--cat-accent": accent } : {}) } as CSSProperties
  return (
    <span className={cn("nova-cat", className)} data-state={state} data-paused={paused ? "true" : undefined} style={style} aria-hidden="true">
      <span className="nova-cat-sprite" />
      <span className="nova-cat-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="nova-cat-mark" />
    </span>
  )
}
