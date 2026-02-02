"use client"

import { useEffect, useRef, useState } from "react"
import { MessageBubble } from "./message-bubble"
import type { Message } from "./chat-shell"
import { TypingIndicator } from "./typing-indicator"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnimatedOrb } from "./animated-orb"
import type { NovaState } from "@/lib/useNovaState"

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  novaState?: NovaState
  error: string | null
  onRetry: () => void
  isLoaded: boolean
  zoom?: number
}

const LAUNCH_SOUND_URL = "/sounds/launch.mp3"

export function MessageList({
  messages,
  isStreaming,
  novaState,
  error,
  onRetry,
  isLoaded,
  zoom = 100,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const rafRef = useRef<number | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastScrollRef = useRef<number>(0)
  const hasPlayedIntroRef = useRef(false)

  useEffect(() => {
    if (!isLoaded) return

    if (messages.length === 0 && !hasPlayedIntroRef.current) {
      setHasAnimated(true)
      hasPlayedIntroRef.current = true

      audioRef.current = new Audio(LAUNCH_SOUND_URL)
      audioRef.current.volume = 0.5
      audioRef.current.play().catch(() => {})
    } else if (messages.length > 0) {
      setHasAnimated(false)
      hasPlayedIntroRef.current = true
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [isLoaded, messages.length])

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    container.scrollTop = container.scrollHeight
    setAutoScroll(true)
  }, [messages.length])

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
  // Show typing indicator from when user sends a message until Nova starts speaking/TTS
  // isStreaming = true means we're in thinking state (local or from agent)
  // Keep showing even after assistant message arrives, until novaState becomes "speaking"
  const showTypingIndicator =
    isStreaming &&
    novaState !== "speaking" &&
    (messages.length === 0 ||
      lastMessage?.role === "user" ||
      (lastMessage?.role === "assistant" && lastMessage?.content === "") ||
      (novaState === "thinking"))

  if (!isLoaded) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatedOrb size={64} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="absolute inset-0 overflow-y-auto pt-14 pb-28 border-none"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
    <div
      className="space-y-2 px-4 origin-top"
      style={{
        transform: `scale(${zoom / 100})`,
        transformOrigin: "top left",
        width: `${10000 / zoom}%`,
        transition: "transform 0.2s ease",
      }}
    >
      {messages.length === 0 && !error && !isStreaming && (
        <div className="flex flex-col items-center justify-center h-full text-center text-s-40">
          <div className={`mb-4 ${hasAnimated ? "orb-intro" : ""}`}>
            <AnimatedOrb size={180} />
          </div>
          <p className={`text-lg font-medium text-s-60 ${hasAnimated ? "text-blur-intro" : ""}`}>
            Hi, my name is Nova
          </p>
          <p className={`text-sm mt-1 text-s-30 ${hasAnimated ? "text-blur-intro-delay" : ""}`}>
            What can I help you with today?
          </p>
        </div>
      )}

      {messages
        .filter((message) => {
          if (
            isStreaming &&
            message.role === "assistant" &&
            message === lastMessage &&
            message.content === ""
          ) {
            return false
          }
          return true
        })
        .map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isStreaming && message.role === "assistant" && message === lastMessage}
          />
        ))}

      {showTypingIndicator && <TypingIndicator />}

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

      <div ref={bottomRef} aria-hidden="true" className="h-16" />
    </div>
    </div>
  )
}
