"use client"

import { cn } from "@/lib/utils"
import type { Message } from "./chat-shell"
import { MarkdownRenderer } from "./markdown-renderer"
import Image from "next/image"
import { useTheme } from "@/lib/theme-context"
import { NovaOrbIndicator, type OrbPalette } from "./nova-orb-indicator"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  compactMode?: boolean
  orbPalette: OrbPalette
}

// Format time for display
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function MessageBubble({ message, isStreaming = false, compactMode = false, orbPalette }: MessageBubbleProps) {
  const { theme } = useTheme()
  const isLight = theme === "light"
  const isUser = message.role === "user"

  if (!isUser) {
    return (
      <div className="flex w-full min-w-0 items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <NovaOrbIndicator palette={orbPalette} size={23} animated={false} className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 w-full max-w-full flex-col items-start">
          <span className={cn("text-xs text-s-30 hidden sm:block", compactMode ? "mb-0.5" : "mb-1")}>Nova</span>
          <div
            className="min-w-0 bg-transparent text-s-85 w-full max-w-[48rem]"
            style={{
              boxShadow: "none",
              willChange: isStreaming ? "height" : "auto",
              transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              className={cn(compactMode ? "py-1" : "py-1.5")}
              style={{
                transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
              }}
            >
              <MarkdownRenderer content={message.content || " "} isStreaming={isStreaming} className="leading-7" />
            </div>
          </div>
          <span className={cn("text-xs text-s-20", compactMode ? "mt-0.5" : "mt-1")}>{formatTime(message.createdAt)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 justify-end user-message-enter">
      <div className="flex min-w-0 flex-col items-end max-w-[82%] sm:max-w-[78%]">
        {/* Bubble */}
        <div
          className={cn(
            "min-w-0",
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
    </div>
  )
}
