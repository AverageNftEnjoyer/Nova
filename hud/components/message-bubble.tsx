"use client"

import { cn } from "@/lib/utils"
import type { Message } from "./chat-shell"
import { User, Send } from "lucide-react"
import { MarkdownRenderer } from "./markdown-renderer"
import Image from "next/image"
import { AnimatedOrb } from "./animated-orb"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

// Format time for display
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === "user"

  return (
    <div
      className={cn(
        "flex max-w-[90%] md:max-w-[80%] gap-1.5",
        isUser
          ? "ml-auto flex-row-reverse user-message-enter"
          : "mr-auto animate-in fade-in slide-in-from-bottom-2 duration-300 items-end",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-s-10" : "bg-transparent",
          !isUser && isStreaming && "sticky bottom-4 self-end transition-all duration-300",
        )}
        aria-hidden="true"
      >
        {isUser ? <User className="w-4 h-4 text-s-70" /> : <AnimatedOrb className="w-8 h-8 shrink-0" size={32} />}
      </div>

      {/* Message content */}
      <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
        {/* Role label */}
        <span className="text-xs text-s-30 mb-0.5 hidden sm:block mt-1 flex items-center gap-1">
          {isUser ? (
            message.source === "telegram" ? (
              <>
                <Send className="w-3 h-3 text-sky-400" />
                <span className="text-sky-400">{message.sender || "Telegram"}</span>
              </>
            ) : (
              "You"
            )
          ) : (
            "Nova"
          )}
        </span>

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl border-none overflow-hidden",
            isUser
              ? message.source === "telegram"
                ? "bg-sky-500/15 text-s-90 rounded-br-md"
                : "bg-violet-500/15 text-s-90 rounded-br-md"
              : "bg-transparent text-s-85 rounded-bl-md",
          )}
          style={{
            boxShadow: isUser
              ? message.source === "telegram"
                ? "rgba(14, 165, 233, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.15) 0px 2px 8px"
                : "rgba(139, 92, 246, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.15) 0px 2px 8px"
              : "none",
            willChange: isStreaming ? "height" : "auto",
            transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            className={cn(isUser ? "px-4 py-3" : "py-1")}
            style={{
              transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
            }}
          >
            {isUser ? (
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
                <p className="text-sm whitespace-pre-wrap wrap-break-word">{message.content}</p>
              </div>
            ) : (
              <MarkdownRenderer content={message.content || " "} isStreaming={isStreaming} />
            )}
          </div>
        </div>

        {/* Timestamp */}
        <span className="text-xs text-s-20 mt-1">{formatTime(message.createdAt)}</span>
      </div>
    </div>
  )
}
