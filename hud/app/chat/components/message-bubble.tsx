"use client"

import { cn } from "@/lib/utils"
import type { Message } from "./chat-types"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import Image from "next/image"
import { useTheme } from "@/lib/theme-context"
import { NovaOrbIndicator, type OrbPalette } from "@/components/nova-orb-indicator"
import { User } from "lucide-react"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import { useEffect, useMemo, useRef, useState } from "react"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  compactMode?: boolean
  orbPalette: OrbPalette
  orbAnimated?: boolean
}

// Format time for display
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function MessageBubble({ message, isStreaming = false, compactMode = false, orbPalette, orbAnimated = false }: MessageBubbleProps) {
  const { theme } = useTheme()
  const isLight = theme === "light"
  const isUser = message.role === "user"
  const [avatar, setAvatar] = useState<string | null>(null)
  const [displayedContent, setDisplayedContent] = useState(message.content || "")
  const revealFrameRef = useRef<number | null>(null)
  const revealTargetRef = useRef(message.content || "")
  const displayedContentRef = useRef(message.content || "")
  const revealLastAtRef = useRef<number>(0)
  const revealCarryRef = useRef<number>(0)

  useEffect(() => {
    const syncAvatar = () => setAvatar(loadUserSettings().profile.avatar ?? null)
    syncAvatar()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncAvatar as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncAvatar as EventListener)
  }, [])

  useEffect(() => {
    displayedContentRef.current = displayedContent
  }, [displayedContent])

  useEffect(() => {
    revealTargetRef.current = message.content || ""
    if (isUser) {
      setDisplayedContent(revealTargetRef.current)
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
      revealLastAtRef.current = 0
      revealCarryRef.current = 0
      return
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
    } else if (!isStreaming) {
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
  const assistantIsLoading = !assistantContent.trim() && isStreaming

  if (!isUser) {
    return (
      <div className="flex w-full min-w-0 items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
              transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              className={cn(
                assistantIsLoading
                  ? compactMode
                    ? "px-4 py-2"
                    : "px-4 py-3"
                  : compactMode
                    ? "px-4 py-2"
                    : "px-4 py-3"
              )}
              style={{
                transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
              }}
            >
              {assistantIsLoading ? (
                <div className="flex items-center gap-1 py-1">
                  <span className="h-[7px] w-[7px] rounded-full bg-current opacity-70 animate-[typing-dot-wave_1.35s_ease-in-out_infinite]" />
                  <span
                    className="h-[7px] w-[7px] rounded-full bg-current opacity-70 animate-[typing-dot-wave_1.35s_ease-in-out_infinite]"
                    style={{ animationDelay: "160ms" }}
                  />
                  <span
                    className="h-[7px] w-[7px] rounded-full bg-current opacity-70 animate-[typing-dot-wave_1.35s_ease-in-out_infinite]"
                    style={{ animationDelay: "320ms" }}
                  />
                </div>
              ) : (
                <MarkdownRenderer content={assistantContent || " "} isStreaming={isStreaming} className="leading-7 text-sm" />
              )}
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
            transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            className={cn(isUser ? (compactMode ? "px-4 py-2" : "px-4 py-3") : compactMode ? "py-1" : "py-1.5")}
            style={{
              transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
            }}
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
              <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
            </div>
          </div>
        </div>

        {/* Timestamp */}
        <span className={cn("text-xs text-s-20", compactMode ? "mt-0.5" : "mt-1")}>{formatTime(message.createdAt)}</span>
      </div>
      <div
        className={cn(
          "mt-1.5 h-[28px] w-[28px] shrink-0 overflow-hidden rounded-full",
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
