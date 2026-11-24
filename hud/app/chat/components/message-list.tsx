"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/shared/utils"
import { Skeleton } from "@/components/ui"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { MessageBubble } from "./message-bubble"
import type { Message } from "./chat-types"

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingAssistantId?: string | null
  thinkingStatus?: string
  isLoaded: boolean
  assistantName: string
  modelByMessageId: Record<string, string>
  /** Shown when the thread has no messages. */
  emptyState: React.ReactNode
  onUseSuggestedWording?: (message: Message) => void | Promise<void>
}

/** Readable column width for the conversation and the composer (rem, so it scales on 4K). */
export const CHAT_COLUMN_CLASS = "mx-auto w-full max-w-[48rem] px-6"

export function MessageList({
  messages,
  isStreaming,
  streamingAssistantId = null,
  thinkingStatus = "",
  isLoaded,
  assistantName,
  modelByMessageId,
  emptyState,
  onUseSuggestedWording,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const rafRef = useRef<number | null>(null)
  const lastScrollRef = useRef<number>(0)
  const [compactMode, setCompactMode] = useState(() => loadUserSettings().app.compactMode)

  useEffect(() => {
    const syncCompactMode = () => setCompactMode(loadUserSettings().app.compactMode)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nova_user_settings") syncCompactMode()
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncCompactMode as EventListener)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncCompactMode as EventListener)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight
    }
    scrollToBottom()
    // One frame to settle after the DOM has laid out the new message.
    const raf = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(raf)
  }, [messages.length, isLoaded, compactMode])

  useEffect(() => {
    if (!isStreaming || !autoScroll || !containerRef.current) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const container = containerRef.current
    lastScrollRef.current = container.scrollTop

    const followStream = () => {
      const target = container.scrollHeight - container.clientHeight
      const diff = target - lastScrollRef.current
      if (diff > 0.5) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        lastScrollRef.current = reduced ? target : lastScrollRef.current + diff * 0.03
        container.scrollTop = lastScrollRef.current
      }
      rafRef.current = requestAnimationFrame(followStream)
    }
    rafRef.current = requestAnimationFrame(followStream)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isStreaming, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current || isStreaming) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 150)
  }

  let latestUserMessage = ""
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      latestUserMessage = String(messages[i]?.content || "")
      break
    }
  }

  const visibleMessages = messages.filter(
    (message) =>
      // Empty assistant placeholders that are not streaming are stale; hide them.
      message.role === "user" || String(message.content || "").trim() || streamingAssistantId === message.id,
  )

  // The runtime can report "thinking" before the first stream event names a reply id: show a pending row then.
  const lastVisible = visibleMessages[visibleMessages.length - 1]
  const showPendingRow =
    isStreaming && !visibleMessages.some((m) => m.id === streamingAssistantId) && lastVisible?.role === "user"

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      role="log"
      aria-label="Messages"
      aria-live="polite"
      aria-busy={!isLoaded || undefined}
    >
      {!isLoaded ? (
        <div className={cn(CHAT_COLUMN_CLASS, "space-y-6 py-8")} aria-label="Loading messages" role="status">
          <div className="flex justify-end">
            <Skeleton className="h-9 w-2/5 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="size-6 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        </div>
      ) : visibleMessages.length === 0 && !isStreaming ? (
        <div className={cn(CHAT_COLUMN_CLASS, "flex min-h-full flex-col justify-center py-10")}>{emptyState}</div>
      ) : (
        <div className={cn(CHAT_COLUMN_CLASS, "flex flex-col pt-6 pb-4", compactMode ? "gap-3" : "gap-5")}>
          {visibleMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={message.role === "assistant" && streamingAssistantId === message.id}
              compactMode={compactMode}
              assistantName={assistantName}
              modelId={modelByMessageId[message.id]}
              thinkingStatus={thinkingStatus}
              latestUserMessage={latestUserMessage}
              onUseSuggestedWording={onUseSuggestedWording}
            />
          ))}
          {showPendingRow ? (
            <MessageBubble
              message={{ id: "pending-reply", role: "assistant", content: "", createdAt: lastVisible.createdAt }}
              isStreaming
              compactMode={compactMode}
              assistantName={assistantName}
              thinkingStatus={thinkingStatus}
              latestUserMessage={latestUserMessage}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
