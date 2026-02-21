"use client"

import { cn } from "@/lib/shared/utils"
import type { Message } from "./chat-types"
import { MarkdownRenderer } from "@/components/chat/markdown-renderer"
import Image from "next/image"
import { useTheme } from "@/lib/context/theme-context"
import { NovaOrbIndicator, type OrbPalette } from "@/components/chat/nova-orb-indicator"
import { Check, RotateCcw, Sparkles, User } from "lucide-react"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { useEffect, useMemo, useRef, useState } from "react"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  compactMode?: boolean
  orbPalette: OrbPalette
  orbAnimated?: boolean
  onUseSuggestedWording?: (message: Message) => void | Promise<void>
}

// Format time for display
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function MessageBubble({
  message,
  isStreaming = false,
  compactMode = false,
  orbPalette,
  orbAnimated = false,
  onUseSuggestedWording,
}: MessageBubbleProps) {
  const { theme } = useTheme()
  const isLight = theme === "light"
  const isUser = message.role === "user"
  const [avatar, setAvatar] = useState<string | null>(null)
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
    const syncAvatar = () => setAvatar(loadUserSettings().profile.avatar ?? null)
    const syncNlpEditHints = () => setShowNlpEditHints(loadUserSettings().notifications.nlpEditHintsEnabled)
    syncAvatar()
    syncNlpEditHints()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncAvatar as EventListener)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncNlpEditHints as EventListener)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncAvatar as EventListener)
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncNlpEditHints as EventListener)
    }
  }, [])

  useEffect(() => {
    setNlpHintOpen(false)
    setNlpSuggestedUsed(false)
    setNlpSuggestedSending(false)
  }, [message.id])

  useEffect(() => {
    displayedContentRef.current = displayedContent
  }, [displayedContent])

  useEffect(() => {
    const raw = message.content || ""
    if (isUser) {
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
    if (lastRevealMessageIdRef.current !== message.id) {
      lastRevealMessageIdRef.current = message.id
      revealTargetRef.current = raw
      setDisplayedContent(raw.length > 0 ? raw : "")
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
      revealLastAtRef.current = performance.now()
      if (revealFrameRef.current === null) {
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
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
      revealCarryRef.current = 0
    }
  }, [message.content, isStreaming, isUser, message.id])

  const assistantContent = useMemo(() => (isUser ? (message.content || "") : displayedContent), [displayedContent, isUser, message.content])
  const hasNlpRewrite = isUser
    && showNlpEditHints
    && !message.nlpBypass
    && typeof message.nlpCleanText === "string"
    && message.nlpCleanText.trim().length > 0
    && message.nlpCleanText.trim() !== (message.content || "").trim()
  const nlpConfidence = typeof message.nlpConfidence === "number" ? message.nlpConfidence : 1
  const nlpCorrectionCount = typeof message.nlpCorrectionCount === "number" ? message.nlpCorrectionCount : 0
  const shouldShowNlpHint = hasNlpRewrite && (nlpConfidence < 0.8 || nlpCorrectionCount >= 2)

  if (!isUser) {
    return (
      <div className="flex w-full min-w-0 items-start gap-2">
        <NovaOrbIndicator palette={orbPalette} size={28} animated={orbAnimated} className="mt-1.5 shrink-0" />
        <div className={cn("flex min-w-0 flex-col items-start", compactMode ? "max-w-[82%] sm:max-w-[78%]" : "max-w-[96%]")}>
          <div
            className={cn(
              "home-spotlight-card home-border-glow min-w-0 rounded-lg border",
              isLight
                ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90"
                : "border-white/10 bg-black/25 backdrop-blur-md text-slate-100",
            )}
            style={{
              boxShadow: "none",
              willChange: isStreaming ? "height" : "auto",
            }}
          >
            <div
              className={cn(
                compactMode
                  ? "px-4 py-2"
                  : "px-4 py-3"
              )}
            >
              <MarkdownRenderer content={assistantContent || " "} isStreaming={isStreaming} className="leading-7 text-sm" />
            </div>
          </div>
          <span className={cn("text-xs text-s-20", compactMode ? "mt-0.5" : "mt-1")}>{formatTime(message.createdAt)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 justify-end items-start gap-2">
      <div className={cn("flex min-w-0 flex-col items-end", compactMode ? "max-w-[82%] sm:max-w-[78%]" : "max-w-[96%]")}>
        {/* Bubble */}
        <div
          className={cn(
            "home-spotlight-card home-border-glow min-w-0",
            isLight
              ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd] text-s-90"
              : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md text-slate-100",
          )}
          style={{
            boxShadow: "none",
            willChange: isStreaming ? "height" : "auto",
          }}
        >
          <div
            className={cn(isUser ? (compactMode ? "px-4 py-2" : "px-4 py-3") : compactMode ? "py-1" : "py-1.5")}
          >
            <div className="flex flex-col gap-2">
              {message.imageData && (
                <div className="w-20 h-20 rounded-lg overflow-hidden border border-s-10">
                  <Image
                    src={message.imageData || "/placeholder.svg"}
                    alt="Uploaded image"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <p className="text-sm whitespace-pre-wrap wrap-break-word wrap-anywhere">{message.content}</p>
            </div>
          </div>
        </div>

        {shouldShowNlpHint && (
          <div className={cn("mt-1.5 w-full min-w-0", compactMode ? "max-w-[82%] sm:max-w-[78%]" : "max-w-[96%]")}>
            <button
              type="button"
              onClick={() => setNlpHintOpen((prev) => !prev)}
              className={cn(
                "home-spotlight-card home-border-glow inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                isLight
                  ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:bg-[#eef3fb]"
                  : "border-white/12 bg-black/25 backdrop-blur-md text-slate-300 hover:bg-white/8",
              )}
              aria-expanded={nlpHintOpen}
              aria-label="Toggle edited input details"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Edited
            </button>
            {nlpHintOpen && (
              <div
                className={cn(
                  "home-spotlight-card home-border-glow mt-2 rounded-lg border p-3 text-left",
                  isLight
                    ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80"
                    : "border-white/15 bg-black/35 backdrop-blur-xl text-slate-200",
                )}
              >
                <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>Interpreted as</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">{message.nlpCleanText}</p>
                <div className="mt-2 flex items-center gap-2">
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
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                      isLight
                        ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]"
                        : "border-white/15 bg-black/30 text-slate-200 hover:bg-white/10",
                    )}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {nlpSuggestedUsed ? "Suggested sent" : nlpSuggestedSending ? "Sending..." : "Use suggested"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNlpHintOpen(false)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                      isLight
                        ? "border-[#d5dce8] bg-white text-s-60 hover:bg-[#eef3fb]"
                        : "border-white/15 bg-black/30 text-slate-300 hover:bg-white/10",
                    )}
                  >
                    <Check className="h-3 w-3" />
                    Keep interpreted
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <span className={cn("text-xs text-s-20", compactMode ? "mt-0.5" : "mt-1")}>{formatTime(message.createdAt)}</span>
      </div>
      <div
        className={cn(
          "mt-1.5 h-7 w-7 shrink-0 overflow-hidden rounded-full",
          isLight ? "border border-[#d5dce8] bg-white" : "border border-white/15 bg-white/5",
        )}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="Profile" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <User className="h-3.5 w-3.5 text-s-50" />
          </div>
        )}
      </div>
    </div>
  )
}
