"use client"

import { useEffect, useMemo, useState } from "react"
import { NovaOrbIndicator, type OrbPalette } from "@/components/chat/nova-orb-indicator"

interface TypingIndicatorProps {
  orbPalette: OrbPalette
  thinkingStatus?: string
  latestUserMessage?: string
}

const DEFAULT_THINKING_POOL = [
  "Drafting response",
  "Composing reply",
  "Putting thoughts together",
  "Forming a response",
  "Working on a reply",
  "Thinking it through",
  "Piecing it together",
  "Considering",
  "Gathering my thoughts",
  "Crafting",
  "Preparing",
  "Working through this",
  "Building a response",
  "Getting this together",
  "Shaping a reply",
  "Sorting through ideas",
  "Almost there",
  "Refining my thoughts",
  "Connecting the dots",
  "Processing your request",
  "Figuring this out",
  "Cooking up a reply",
  "Organizing my thoughts",
  "Running through options",
  "Polishing the reply",
  "Polishing the reply",
  "Sketching a response",
  "Rizzing",
  "One sec bro",
] as const

function pickRandomSubset(pool: readonly string[], count: number): string[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

const WEATHER_THINKING_STATES = ["Checking weather", "Searching forecast", "Reviewing conditions", "Pulling up the forecast", "Reading conditions"] as const
const WEB_THINKING_STATES = ["Searching the web", "Reviewing sources", "Verifying details", "Looking this up", "Scanning results"] as const
const CODE_THINKING_STATES = ["Reading code", "Tracing the issue", "Testing an approach", "Analyzing the code", "Working through the logic"] as const

function selectThinkingStatesFromMessage(message: string): string[] {
  const text = String(message || "").toLowerCase()
  if (/\b(weather|forecast|temperature|rain|snow|wind|humidity)\b/.test(text)) return pickRandomSubset(WEATHER_THINKING_STATES, 4)
  if (/\b(latest|news|current|price|score|search|look up|lookup|find)\b/.test(text)) return pickRandomSubset(WEB_THINKING_STATES, 4)
  if (/\b(code|bug|error|debug|fix|refactor|typescript|javascript|python|function|stack)\b/.test(text)) return pickRandomSubset(CODE_THINKING_STATES, 4)
  return pickRandomSubset(DEFAULT_THINKING_POOL, 4)
}

const GENERIC_BACKEND_STATUSES = new Set([
  "drafting response",
  "finalizing response",
  "thinking",
  "reasoning",
])

export function TypingIndicator({
  orbPalette,
  thinkingStatus = "",
  latestUserMessage = "",
}: TypingIndicatorProps) {
  const [stateIndex, setStateIndex] = useState(0)
  const rawStatus = String(thinkingStatus || "").trim().replace(/\s+/g, " ")
  const isGenericBackendStatus = !rawStatus || GENERIC_BACKEND_STATUSES.has(rawStatus.toLowerCase())
  const thinkingStates = useMemo(
    () => selectThinkingStatesFromMessage(latestUserMessage),
    [latestUserMessage],
  )

  useEffect(() => {
    if (!isGenericBackendStatus) return
    const timer = window.setInterval(() => {
      setStateIndex((prev) => (prev + 1) % thinkingStates.length)
    }, 4400)
    return () => window.clearInterval(timer)
  }, [isGenericBackendStatus, thinkingStates])

  const activeState = useMemo(() => {
    if (!isGenericBackendStatus) return rawStatus
    const safeIndex = stateIndex % Math.max(1, thinkingStates.length)
    return thinkingStates[safeIndex] ?? "Thinking"
  }, [isGenericBackendStatus, rawStatus, stateIndex, thinkingStates])

  return (
    <div className="flex w-full justify-start">
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
