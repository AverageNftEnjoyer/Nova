"use client"

import { useEffect, useRef, useState } from "react"
import { MessageBubble } from "./message-bubble"
import type { Message } from "./chat-shell"
import { TypingIndicator } from "./typing-indicator"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { NovaState } from "@/lib/useNovaState"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import { cn } from "@/lib/utils"
import type { OrbPalette } from "./nova-orb-indicator"

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingAssistantId?: string | null
  novaState?: NovaState
  error: string | null
  onRetry: () => void
  isLoaded: boolean
  zoom?: number
  orbPalette: OrbPalette
}

export function MessageList({
  messages,
  isStreaming,
  streamingAssistantId = null,
  novaState: _novaState,
  error,
  onRetry,
  isLoaded,
  zoom = 100,
  orbPalette,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const rafRef = useRef<number | null>(null)
  const lastScrollRef = useRef<number>(0)
  const [compactMode, setCompactMode] = useState(() => loadUserSettings().app.compactMode)
  const hasAnimated = isLoaded && messages.length === 0

  const scrollToBottom = () => {
    if (!containerRef.current) return
    const container = containerRef.current
    container.scrollTop = container.scrollHeight
  }

  useEffect(() => {
    const syncCompactMode = () => setCompactMode(loadUserSettings().app.compactMode)
    const onSettingsUpdated = () => syncCompactMode()
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nova_user_settings") syncCompactMode()
    }

    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    scrollToBottom()

    // Ensure we land on the latest message after layout/paint settles.
    let raf2: number | null = null
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom()
      raf2 = requestAnimationFrame(() => {
        scrollToBottom()
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      if (raf2 !== null) cancelAnimationFrame(raf2)
    }
  }, [messages.length, isLoaded, zoom, compactMode])

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

    const smoothScroll = () => {
      if (!container) return

      const { scrollHeight, clientHeight } = container
      const targetScroll = scrollHeight - clientHeight
      const currentScroll = lastScrollRef.current
      const diff = targetScroll - currentScroll

      if (diff > 0.5) {
        const newScroll = currentScroll + diff * 0.03
        lastScrollRef.current = newScroll
        container.scrollTop = newScroll
      }

      rafRef.current = requestAnimationFrame(smoothScroll)
    }

    rafRef.current = requestAnimationFrame(smoothScroll)

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
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150
    setAutoScroll(isAtBottom)
  }

  const lastMessage = messages[messages.length - 1]
  const showTypingIndicator = isStreaming && (messages.length === 0 || lastMessage?.role === "user")
  const shouldAnimateOrb = isStreaming

  if (!isLoaded) {
    return <div className="absolute inset-0" />
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden no-scrollbar pt-3 pb-20 border-none"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
    <div
      className={cn(
        "ml-auto mr-0 w-full min-h-full origin-top px-4 sm:px-5 flex flex-col justify-start",
        compactMode ? "max-w-[60rem] space-y-3" : "max-w-[68rem] space-y-4",
      )}
      style={{
        transform: `scale(${zoom / 100})`,
        transformOrigin: "top left",
        width: `${10000 / zoom}%`,
        transition: "transform 0.2s ease",
      }}
    >
      {messages.length === 0 && !error && !isStreaming && (
        <div className="flex flex-col items-center justify-center h-full text-center text-s-40">
          <p className={`text-lg font-medium text-s-60 ${hasAnimated ? "text-blur-intro" : ""}`}>
            Hi, my name is Nova
          </p>
          <p className={`text-sm mt-1 text-s-30 ${hasAnimated ? "text-blur-intro-delay" : ""}`}>
            What can I help you with today?
          </p>
        </div>
      )}

      {messages.map((message) => {
            const isAssistantStreaming = message.role === "assistant" && streamingAssistantId === message.id
            return (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isAssistantStreaming}
            compactMode={compactMode}
            orbPalette={orbPalette}
            orbAnimated={shouldAnimateOrb && isAssistantStreaming}
          />
            )
          })}

      {showTypingIndicator && <TypingIndicator orbPalette={orbPalette} />}

      {error && (
        <div
          className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-400">Something went wrong</p>
            <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Retry
          </Button>
        </div>
      )}

      <div ref={bottomRef} aria-hidden="true" className="h-2" />
    </div>
    </div>
  )
}
