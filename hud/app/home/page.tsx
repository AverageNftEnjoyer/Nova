"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AnimatedOrb } from "@/components/animated-orb"
import { useNovaState } from "@/lib/useNovaState"
import { ThemeToggle } from "@/components/theme-toggle"
import { createConversation, saveConversations, loadConversations, setActiveId, generateId, type ChatMessage } from "@/lib/conversations"

export default function HomePage() {
  const router = useRouter()
  const { state: novaState, connected, sendToAgent } = useNovaState()
  const [hasAnimated, setHasAnimated] = useState(false)
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setHasAnimated(true)
    audioRef.current = new Audio("/sounds/launch.mp3")
    audioRef.current.volume = 0.5
    audioRef.current.play().catch(() => {})
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || !connected) return

    // Create a new conversation and navigate to chat
    const convo = createConversation()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      source: "agent",
    }
    convo.messages = [userMsg]
    convo.title = text.length > 40 ? text.slice(0, 40) + "..." : text

    const convos = [convo, ...loadConversations()]
    saveConversations(convos)
    setActiveId(convo.id)

    sendToAgent(text, true)
    router.push("/chat")
  }, [input, connected, sendToAgent, router])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-dvh bg-page flex flex-col items-center justify-center relative overflow-hidden">
      {/* Subtle background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(139,92,246,0.04) 0%, transparent 60%)",
        }}
      />

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 relative z-10">
        {/* Floating Nova Orb */}
        <div className={`${hasAnimated ? "orb-intro" : ""}`}>
          <AnimatedOrb size={240} />
        </div>

        {/* Greeting */}
        <div className="text-center mt-4">
          <p
            className={`text-2xl font-light text-s-70 ${
              hasAnimated ? "text-blur-intro" : ""
            }`}
          >
            Hi, I&apos;m Nova
          </p>
          <p
            className={`text-sm mt-2 text-s-30 ${
              hasAnimated ? "text-blur-intro-delay" : ""
            }`}
          >
            What can I help you with today?
          </p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 mt-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: connected
                ? novaState === "speaking"
                  ? "#a78bfa"
                  : novaState === "listening"
                  ? "#34d399"
                  : novaState === "thinking"
                  ? "#fbbf24"
                  : "#94a3b8"
                : "#ef4444",
            }}
          />
          <span className="text-xs text-s-30 font-mono">
            {connected ? `Nova ${novaState}` : "Agent offline"}
          </span>
        </div>
      </div>

      {/* Composer at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="relative rounded-2xl bg-s-3 border border-s-10 focus-within:border-violet-500/30 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected ? "Message Nova..." : "Waiting for agent..."}
              disabled={!connected}
              rows={1}
              className="w-full bg-transparent text-s-90 text-sm placeholder:text-s-20 px-5 py-4 pr-14 resize-none outline-none disabled:opacity-40"
              style={{ maxHeight: 120 }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="absolute right-3 bottom-3 p-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-20 disabled:hover:bg-violet-500/20 transition-colors"
            >
              <AnimatedOrb size={20} />
            </button>
          </div>
          <p className="text-[10px] text-s-10 text-center mt-2 font-mono">
            Press Enter to send
          </p>
        </div>
      </div>

      {/* Corner HUD */}
      <div className="absolute top-4 left-4 font-mono text-[9px] text-s-10">
        NOVA HOME
      </div>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span className="font-mono text-[9px] text-s-10 text-right">
          {connected ? "CONNECTED" : "OFFLINE"}
        </span>
        <ThemeToggle />
      </div>
    </div>
  )
}
