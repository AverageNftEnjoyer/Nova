"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PanelLeftOpen, PanelLeftClose } from "lucide-react"
import { AnimatedOrb } from "@/components/animated-orb"
import { useNovaState } from "@/lib/useNovaState"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChatSidebar } from "@/components/chat-sidebar"
import { Button } from "@/components/ui/button"
import {
  createConversation,
  saveConversations,
  loadConversations,
  setActiveId,
  generateId,
  type ChatMessage,
  type Conversation,
} from "@/lib/conversations"

const GREETINGS = [
  "Hello sir, what are we working on today?",
  "Good to see you! What's on the agenda?",
  "Hey there! Ready when you are.",
  "Welcome back! What can I help with?",
  "Hi! What would you like to tackle today?",
  "Hello! I'm all yours. What do you need?",
  "Hey! What's the plan for today?",
  "Good to have you back. What are we building?",
  "Hi there! What's on your mind?",
  "Hey! I'm ready to go. What's first?",
  "Welcome! What challenge are we solving today?",
  "Hello! Just say the word and I'm on it.",
  "Hey! What exciting things are we doing today?",
  "Hi! Systems are all green. What do you need?",
  "Good to see you again! What's the mission?",
  "Hey! I've been waiting. What are we up to?",
  "Hello sir! All systems nominal. What's the task?",
  "Hi! Let's make something happen. What do you need?",
  "Hey there! What can I do for you today?",
  "Welcome back! I'm locked in and ready.",
  "Hello! What's the move today?",
  "Hi! Another day, another project. What's up?",
  "Hey! I'm fired up and ready. What's first on the list?",
  "Good to have you! What are we creating today?",
  "Hello! Tell me what you need and I'll make it happen.",
  "Hey! What problem are we solving today?",
  "Hi sir! Ready for action. What's the plan?",
  "Welcome! What's the first order of business?",
  "Hey there! Let's get to it. What do you need?",
  "Hello! I'm all ears. What are we working on?",
  "Hi! What's cooking today?",
  "Hey! Boot sequence complete. What's the task?",
  "Hello there! What would you like to accomplish?",
  "Hi! Nova online and at your service. What's up?",
  "Hey! Let's make today productive. What's first?",
]

export default function HomePage() {
  const router = useRouter()
  const { state: novaState, connected, sendToAgent, sendGreeting } = useNovaState()
  const [hasAnimated, setHasAnimated] = useState(false)
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const greetingSentRef = useRef(false)

  useEffect(() => {
    setConversations(loadConversations())
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

  // Send a random greeting when agent connects
  useEffect(() => {
    if (connected && !greetingSentRef.current) {
      greetingSentRef.current = true
      const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      // Small delay to let the home page settle
      const t = setTimeout(() => sendGreeting(greeting), 1500)
      return () => clearTimeout(t)
    }
  }, [connected, sendGreeting])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || !connected) return

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

    const convos = [convo, ...conversations]
    setConversations(convos)
    saveConversations(convos)
    setActiveId(convo.id)

    sendToAgent(text, true)
    router.push("/chat")
  }, [input, connected, sendToAgent, router, conversations])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectConvo = useCallback((id: string) => {
    setActiveId(id)
    router.push("/chat")
  }, [router])

  const handleNewChat = useCallback(() => {
    const fresh = createConversation()
    const convos = [fresh, ...conversations]
    setConversations(convos)
    saveConversations(convos)
    setActiveId(fresh.id)
    router.push("/chat")
  }, [conversations, router])

  const handleDeleteConvo = useCallback((id: string) => {
    const remaining = conversations.filter((c) => c.id !== id)
    setConversations(remaining)
    saveConversations(remaining)
  }, [conversations])

  return (
    <div className="flex h-dvh bg-page">
      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
      />

      {/* Main area */}
      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden">
        {/* Subtle background grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 40%, rgba(139,92,246,0.04) 0%, transparent 60%)",
          }}
        />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-s-5 hover:bg-s-10 text-s-60"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-s-5">
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
              <span className="text-xs text-s-50 font-mono">
                {connected ? `Nova ${novaState}` : "Agent offline"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>

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
      </div>
    </div>
  )
}
