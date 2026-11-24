"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, RotateCcw, Wand2 } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { Badge, IconButton, StatusDot, Tooltip } from "@/components/ui"
import { MarkdownRenderer } from "@/components/chat/markdown-renderer"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import type { Message } from "./chat-types"

// Thinking labels shown before the first token, when the runtime only reports a generic status.
const DEFAULT_THINKING_POOL = [
  "Thinking",
  "Drafting a reply",
  "Working through this",
  "Considering options",
  "Putting this together",
  "Checking details",
] as const
const WEATHER_THINKING_STATES = ["Checking the forecast", "Reading conditions", "Looking up the weather"] as const
const WEB_THINKING_STATES = ["Searching the web", "Reviewing sources", "Verifying details"] as const
const CODE_THINKING_STATES = ["Reading code", "Tracing the issue", "Working through the logic"] as const
const GENERIC_BACKEND_STATUSES = new Set(["drafting response", "finalizing response", "thinking", "reasoning"])

function selectThinkingStates(message: string): readonly string[] {
  const text = String(message || "").toLowerCase()
  if (/\b(weather|forecast|temperature|rain|snow|wind|humidity)\b/.test(text)) return WEATHER_THINKING_STATES
  if (/\b(latest|news|current|price|score|search|look up|lookup|find)\b/.test(text)) return WEB_THINKING_STATES
  if (/\b(code|bug|error|debug|fix|refactor|typescript|javascript|python|function|stack)\b/.test(text)) return CODE_THINKING_STATES
  return DEFAULT_THINKING_POOL
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatFullTime(date: Date): string {
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

/** Small square mark for assistant rows (no avatar art). */
export function NovaMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-accent-border bg-accent-muted text-2xs font-semibold text-accent-text",
        className,
      )}
    >
      N
    </span>
  )
}

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  compactMode?: boolean
  assistantName: string
  /** Model that produced this reply, when the runtime reported it. */
  modelId?: string
  thinkingStatus?: string
  latestUserMessage?: string
  onUseSuggestedWording?: (message: Message) => void | Promise<void>
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  return (
    <Tooltip content={copied ? "Copied" : "Copy reply"}>
      <IconButton
        size="sm"
        aria-label={copied ? "Copied" : "Copy reply"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            if (timer.current !== null) window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setCopied(false), 1_500)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </IconButton>
    </Tooltip>
  )
}

export function MessageBubble({
  message,
  isStreaming = false,
  compactMode = false,
  assistantName,
  modelId = "",
  thinkingStatus = "",
  latestUserMessage = "",
  onUseSuggestedWording,
}: MessageBubbleProps) {
  const isUser = message.role === "user"
  const [showNlpEditHints, setShowNlpEditHints] = useState(() => loadUserSettings().notifications.nlpEditHintsEnabled)
  const [nlpHintOpen, setNlpHintOpen] = useState(false)
  const [nlpSuggestedUsed, setNlpSuggestedUsed] = useState(false)
  const [nlpSuggestedSending, setNlpSuggestedSending] = useState(false)
  const [displayedContent, setDisplayedContent] = useState(message.content || "")
  const revealFrameRef = useRef<number | null>(null)
  const revealTargetRef = useRef(message.content || "")
  const displayedContentRef = useRef(message.content || "")
  const revealLastAtRef = useRef<number>(0)
  const revealCarryRef = useRef<number>(0)
  const lastRevealMessageIdRef = useRef<string>(message.id)

  useEffect(() => {
    const sync = () => setShowNlpEditHints(loadUserSettings().notifications.nlpEditHintsEnabled)
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useEffect(() => {
    setNlpHintOpen(false)  
    setNlpSuggestedUsed(false)
    setNlpSuggestedSending(false)
  }, [message.id])

  useEffect(() => {
    displayedContentRef.current = displayedContent
  }, [displayedContent])

  // Streamed text is revealed at a steady pace so bursts of tokens read smoothly. Reduced motion shows it as it lands.
  useEffect(() => {
    const raw = message.content || ""
    if (isUser || prefersReducedMotion()) {
      revealTargetRef.current = raw
      setDisplayedContent(raw)  
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
      revealLastAtRef.current = 0
      revealCarryRef.current = 0
      return
    }

    // True when this effect re-ran only because more streaming content arrived for the same message:
    // the RAF loop should continue uninterrupted.
    const isContentUpdate = lastRevealMessageIdRef.current === message.id && isStreaming

    if (lastRevealMessageIdRef.current !== message.id) {
      lastRevealMessageIdRef.current = message.id
      revealTargetRef.current = raw
      setDisplayedContent(raw.length > 0 ? raw : "")
      revealCarryRef.current = 0
      revealLastAtRef.current = 0
    } else if (raw.length > revealTargetRef.current.length) {
      revealTargetRef.current = raw
    }

    const tick = () => {
      const now = performance.now()
      setDisplayedContent((prev) => {
        const target = revealTargetRef.current
        if (prev.length >= target.length) return prev
        const remaining = target.length - prev.length
        const last = revealLastAtRef.current || now
        const elapsed = Math.max(0, now - last)
        revealLastAtRef.current = now
        const minCharsPerSec = 36
        const maxCharsPerSec = 125
        const dynamicCharsPerSec = Math.min(maxCharsPerSec, minCharsPerSec + remaining * 0.22)
        revealCarryRef.current += (elapsed / 1000) * dynamicCharsPerSec
        const step = Math.min(remaining, Math.max(1, Math.min(12, Math.floor(revealCarryRef.current))))
        revealCarryRef.current = Math.max(0, revealCarryRef.current - step)
        const next = target.slice(0, prev.length + step)
        if (next.length < target.length) {
          revealFrameRef.current = requestAnimationFrame(tick)
        } else {
          revealFrameRef.current = null
        }
        return next
      })
    }

    const target = revealTargetRef.current
    const current = displayedContentRef.current
    if (current.length < target.length) {
      if (revealFrameRef.current === null) {
        revealLastAtRef.current = performance.now()
        revealFrameRef.current = requestAnimationFrame(tick)
      }
    } else if (!isStreaming && target.length >= current.length) {
      setDisplayedContent(target)
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
      revealLastAtRef.current = 0
      revealCarryRef.current = 0
    }

    return () => {
      if (isContentUpdate) return
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
      revealCarryRef.current = 0
    }
  }, [message.content, isStreaming, isUser, message.id])

  // Pre-content thinking state: the assistant row with a quiet status line until the first token.
  const isPreContent = !isUser && isStreaming && !String(message.content || "").trim()
  const rawThinkingStatus = String(thinkingStatus || "").trim().replace(/\s+/g, " ")
  const isGenericThinkingStatus = !rawThinkingStatus || GENERIC_BACKEND_STATUSES.has(rawThinkingStatus.toLowerCase())
  const thinkingStates = useMemo(() => selectThinkingStates(latestUserMessage), [latestUserMessage])
  const [thinkingStateIndex, setThinkingStateIndex] = useState(0)

  useEffect(() => {
    if (!isPreContent || !isGenericThinkingStatus) return
    const timer = window.setInterval(() => {
      setThinkingStateIndex((prev) => (prev + 1) % thinkingStates.length)
    }, 4400)
    return () => window.clearInterval(timer)
  }, [isPreContent, isGenericThinkingStatus, thinkingStates])

  const activeThinkingState = isGenericThinkingStatus
    ? thinkingStates[thinkingStateIndex % Math.max(1, thinkingStates.length)] ?? "Thinking"
    : rawThinkingStatus

  const hasNlpRewrite =
    isUser &&
    showNlpEditHints &&
    !message.nlpBypass &&
    typeof message.nlpCleanText === "string" &&
    message.nlpCleanText.trim().length > 0 &&
    message.nlpCleanText.trim() !== (message.content || "").trim()
  const nlpConfidence = typeof message.nlpConfidence === "number" ? message.nlpConfidence : 1
  const nlpCorrectionCount = typeof message.nlpCorrectionCount === "number" ? message.nlpCorrectionCount : 0
  const shouldShowNlpHint = hasNlpRewrite && (nlpConfidence < 0.8 || nlpCorrectionCount >= 2)

  const timeLabel = (
    <time
      dateTime={message.createdAt.toISOString()}
      title={formatFullTime(message.createdAt)}
      className="font-mono text-2xs tabular-nums text-faint opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
    >
      {formatTime(message.createdAt)}
    </time>
  )

  if (!isUser) {
    if (isPreContent) {
      return (
        <div className="flex gap-3" role="status" aria-live="polite" aria-atomic="true">
          <NovaMark className="mt-0.5" />
          <div className="flex h-7 items-center gap-2 text-sm text-muted">
            <StatusDot tone="running" size="sm" />
            <span>{activeThinkingState}</span>
          </div>
        </div>
      )
    }

    const source = message.sender && message.sender.trim() ? message.sender.trim() : assistantName
    return (
      <article className="group/msg flex gap-3" aria-label={`${source} reply`}>
        <NovaMark className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <header className="flex h-7 items-center gap-2">
            <span className="text-xs font-medium text-fg">{source}</span>
            {message.missionLabel ? (
              <Badge tone="neutral" variant="outline" title="Posted by a mission run">
                {message.missionLabel}
              </Badge>
            ) : null}
            {modelId ? <span className="truncate font-mono text-2xs text-faint">{modelId}</span> : null}
            {timeLabel}
          </header>
          <MarkdownRenderer content={displayedContent || ""} isStreaming={isStreaming} />
          {!isStreaming && message.content.trim() ? (
            <div
              className={cn(
                "-ml-1.5 flex h-7 items-center opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
                compactMode && "h-6",
              )}
            >
              <CopyMessageButton text={message.content} />
            </div>
          ) : (
            <div className={compactMode ? "h-2" : "h-3"} />
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="group/msg flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-lg border border-subtle bg-surface-2 px-3 py-2">
        {message.imageData ? (
          <div className="mb-2 overflow-hidden rounded-md border border-border">
            <Image
              src={message.imageData}
              alt="Attached image"
              width={240}
              height={240}
              unoptimized
              className="h-auto max-h-60 w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
        <p className="whitespace-pre-wrap text-sm leading-6 text-fg wrap-break-word wrap-anywhere">{message.content}</p>
      </div>

      <div className="flex items-center gap-2">
        {shouldShowNlpHint ? (
          <button
            type="button"
            onClick={() => setNlpHintOpen((prev) => !prev)}
            aria-expanded={nlpHintOpen}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Wand2 className="size-3" aria-hidden />
            Interpreted
          </button>
        ) : null}
        {timeLabel}
      </div>

      {shouldShowNlpHint && nlpHintOpen ? (
        <div className="w-full max-w-[85%] rounded-lg border border-border bg-surface px-3 py-2.5 animate-pop-in">
          <p className="text-xs text-muted">Nova read this as</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-fg wrap-break-word">{message.nlpCleanText}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={nlpSuggestedUsed || nlpSuggestedSending}
              onClick={async () => {
                if (nlpSuggestedUsed || nlpSuggestedSending) return
                setNlpSuggestedSending(true)
                try {
                  await onUseSuggestedWording?.(message)
                  setNlpSuggestedUsed(true)
                  setNlpHintOpen(false)
                } finally {
                  setNlpSuggestedSending(false)
                }
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-3 px-2.5 text-xs font-medium text-fg transition-colors hover:border-border-strong disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RotateCcw className="size-3" aria-hidden />
              {nlpSuggestedUsed ? "Sent" : nlpSuggestedSending ? "Sending" : "Send this wording"}
            </button>
            <button
              type="button"
              onClick={() => setNlpHintOpen(false)}
              className="inline-flex h-7 items-center rounded-md px-2.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              Keep as is
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
