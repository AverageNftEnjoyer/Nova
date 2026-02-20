"use client"

import { useEffect, useMemo, useState } from "react"
import { NovaOrbIndicator, type OrbPalette } from "@/components/chat/nova-orb-indicator"

interface TypingIndicatorProps {
  orbPalette: OrbPalette
  thinkingStatus?: string
  latestUserMessage?: string
}

const DEFAULT_THINKING_STATES = ["Thinking", "Reasoning", "Drafting response", "Finalizing response"] as const
const WEATHER_THINKING_STATES = ["Checking weather", "Searching forecast", "Reviewing conditions", "Preparing recap"] as const
const WEB_THINKING_STATES = ["Searching web", "Reviewing sources", "Verifying details", "Preparing answer"] as const
const CODE_THINKING_STATES = ["Reading code", "Tracing issue", "Testing approach", "Preparing fix"] as const

function selectThinkingStatesFromMessage(message: string): readonly string[] {
  const text = String(message || "").toLowerCase()
  if (/\b(weather|forecast|temperature|rain|snow|wind|humidity)\b/.test(text)) return WEATHER_THINKING_STATES
  if (/\b(latest|news|current|price|score|search|look up|lookup|find)\b/.test(text)) return WEB_THINKING_STATES
  if (/\b(code|bug|error|debug|fix|refactor|typescript|javascript|python|function|stack)\b/.test(text)) return CODE_THINKING_STATES
  return DEFAULT_THINKING_STATES
}

export function TypingIndicator({
  orbPalette,
  thinkingStatus = "",
  latestUserMessage = "",
}: TypingIndicatorProps) {
  const [stateIndex, setStateIndex] = useState(0)
  const normalizedThinkingStatus = String(thinkingStatus || "").trim().replace(/\s+/g, " ")
  const thinkingStates = useMemo(
    () => selectThinkingStatesFromMessage(latestUserMessage),
    [latestUserMessage],
  )

  useEffect(() => {
    if (normalizedThinkingStatus) return
    const timer = window.setInterval(() => {
      setStateIndex((prev) => (prev + 1) % thinkingStates.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [normalizedThinkingStatus, thinkingStates])

  const activeState = useMemo(() => {
    if (normalizedThinkingStatus) return normalizedThinkingStatus
    const safeIndex = stateIndex % Math.max(1, thinkingStates.length)
    return thinkingStates[safeIndex] ?? "Thinking"
  }, [normalizedThinkingStatus, stateIndex, thinkingStates])

  return (
    <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-full max-w-3xl py-1.5" role="status" aria-label="Assistant is typing" aria-live="polite" aria-atomic="true">
        <div className="inline-flex items-center gap-2.5">
          <NovaOrbIndicator palette={orbPalette} size={28} animated />
          <div className="thinking-wrap">
            <span className="thinking-text">
              <span className="thinking-word-slot">
                <span className="thinking-word">{activeState}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
