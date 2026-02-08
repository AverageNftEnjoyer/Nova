"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessageSquareDashed, Volume2, VolumeX, PanelLeftOpen, PanelLeftClose, ZoomIn, ZoomOut } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "./composer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "./chat-sidebar"
import { PartyOverlay } from "./party-overlay"
import { ThemeToggle } from "./theme-toggle"
import {
  type Conversation,
  type ChatMessage,
  generateId,
  loadConversations,
  saveConversations,
  getActiveId,
  setActiveId,
  createConversation,
  autoTitle,
} from "@/lib/conversations"

// Adapter: the MessageList expects this shape
export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: Date
  imageData?: string
  source?: "hud" | "agent" | "voice" | "telegram"
  sender?: string
}

export function ChatShell() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [voiceMode, setVoiceMode] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const [chatZoom, setChatZoom] = useState(100)

  // Load zoom preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("nova-chat-zoom")
    if (saved) {
      const val = parseInt(saved, 10)
      if (val >= 70 && val <= 130) setChatZoom(val)
    }
  }, [])

  const adjustZoom = useCallback((delta: number) => {
    setChatZoom(prev => {
      const next = Math.max(70, Math.min(130, prev + delta))
      localStorage.setItem("nova-chat-zoom", String(next))
      return next
    })
  }, [])
  const { state: novaState, connected: agentConnected, agentMessages, telegramMessages, sendToAgent, interrupt, clearAgentMessages, clearTelegramMessages, partyMode, stopParty, transcript } = useNovaState()

  const mergedCountRef = useRef(0)
  const telegramMergedCountRef = useRef(0)

  // Load conversations on mount
  useEffect(() => {
    const convos = loadConversations()
    setConversations(convos)

    const activeId = getActiveId()
    const found = convos.find((c) => c.id === activeId)
    if (found) {
      setActiveConvo(found)
    } else if (convos.length > 0) {
      setActiveConvo(convos[0])
      setActiveId(convos[0].id)
    } else {
      const fresh = createConversation()
      setConversations([fresh])
      setActiveConvo(fresh)
      setActiveId(fresh.id)
      saveConversations([fresh])
    }
    setIsLoaded(true)
  }, [])

  // Persist conversations whenever they change
  const persist = useCallback(
    (convos: Conversation[], active: Conversation | null) => {
      setConversations(convos)
      saveConversations(convos)
      if (active) {
        setActiveConvo(active)
        setActiveId(active.id)
      }
    },
    [],
  )

  // Merge incoming agent messages into the active conversation
  useEffect(() => {
    if (!activeConvo || agentMessages.length <= mergedCountRef.current) return

    const newOnes = agentMessages.slice(mergedCountRef.current)
    mergedCountRef.current = agentMessages.length

    const newMsgs: ChatMessage[] = newOnes.map((am) => ({
      id: am.id,
      role: am.role,
      content: am.content,
      createdAt: new Date(am.ts).toISOString(),
      source: am.source || "agent",
      sender: am.sender,
    }))

    const updated: Conversation = {
      ...activeConvo,
      messages: [...activeConvo.messages, ...newMsgs],
      updatedAt: new Date().toISOString(),
      title: activeConvo.messages.length === 0 ? autoTitle(newMsgs) : activeConvo.title,
    }

    const convos = conversations.map((c) => (c.id === updated.id ? updated : c))
    persist(convos, updated)
  }, [agentMessages])

  // Handle Telegram messages - create new conversation for each session
  useEffect(() => {
    if (telegramMessages.length <= telegramMergedCountRef.current) return

    const newOnes = telegramMessages.slice(telegramMergedCountRef.current)
    telegramMergedCountRef.current = telegramMessages.length

    const newMsgs: ChatMessage[] = newOnes.map((am) => ({
      id: am.id,
      role: am.role,
      content: am.content,
      createdAt: new Date(am.ts).toISOString(),
      source: "telegram" as const,
      sender: am.sender,
    }))

    // Find or create a Telegram conversation
    let telegramConvo = conversations.find((c) => c.title.startsWith("Telegram"))

    if (!telegramConvo) {
      // Create new Telegram conversation
      const now = new Date()
      const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      telegramConvo = {
        id: generateId(),
        title: `Telegram - ${dateStr}`,
        messages: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
    }

    const updated: Conversation = {
      ...telegramConvo,
      messages: [...telegramConvo.messages, ...newMsgs],
      updatedAt: new Date().toISOString(),
    }

    // Update or add the Telegram conversation
    const existingIdx = conversations.findIndex((c) => c.id === updated.id)
    let convos: Conversation[]
    if (existingIdx >= 0) {
      convos = conversations.map((c) => (c.id === updated.id ? updated : c))
    } else {
      convos = [updated, ...conversations]
    }

    persist(convos, activeConvo)
  }, [telegramMessages])

  // Convert ChatMessage[] to Message[] for MessageList
  const displayMessages: Message[] = activeConvo
    ? activeConvo.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(m.createdAt),
        source: m.source,
        sender: m.sender,
      }))
    : []

  const [localThinking, setLocalThinking] = useState(false)
  const isThinking = novaState === "thinking" || localThinking

  // Clear local thinking flag ONLY when agent starts speaking (TTS begins)
  // This keeps the thinking animation visible through the full OpenAI response time
  useEffect(() => {
    if (novaState === "speaking") {
      setLocalThinking(false)
    }
  }, [novaState])

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !agentConnected || !activeConvo) return

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        createdAt: new Date().toISOString(),
        source: "agent",
      }

      const updated: Conversation = {
        ...activeConvo,
        messages: [...activeConvo.messages, userMsg],
        updatedAt: new Date().toISOString(),
        title: activeConvo.messages.length === 0 ? autoTitle([userMsg]) : activeConvo.title,
      }

      const convos = conversations.map((c) => (c.id === updated.id ? updated : c))
      persist(convos, updated)

      // bump merged count so the user echo from WebSocket doesn't duplicate
      mergedCountRef.current += 1

      // Show thinking animation immediately
      setLocalThinking(true)

      sendToAgent(content.trim(), voiceMode)
    },
    [activeConvo, conversations, agentConnected, voiceMode, sendToAgent, persist],
  )

  // New conversation
  const handleNewChat = useCallback(() => {
    clearAgentMessages()
    mergedCountRef.current = 0

    const fresh = createConversation()
    const convos = [fresh, ...conversations]
    persist(convos, fresh)
  }, [conversations, clearAgentMessages, persist])

  // Switch conversation
  const handleSelectConvo = useCallback(
    (id: string) => {
      clearAgentMessages()
      mergedCountRef.current = 0

      const found = conversations.find((c) => c.id === id)
      if (found) {
        setActiveConvo(found)
        setActiveId(found.id)
      }
    },
    [conversations, clearAgentMessages],
  )

  // Delete conversation
  const handleDeleteConvo = useCallback(
    (id: string) => {
      const remaining = conversations.filter((c) => c.id !== id)

      if (activeConvo?.id === id) {
        clearAgentMessages()
        mergedCountRef.current = 0

        if (remaining.length > 0) {
          persist(remaining, remaining[0])
        } else {
          const fresh = createConversation()
          persist([fresh], fresh)
        }
      } else {
        persist(remaining, activeConvo)
      }
    },
    [conversations, activeConvo, clearAgentMessages, persist],
  )

  // Clear current chat
  const clearChat = useCallback(() => {
    if (!activeConvo) return
    clearAgentMessages()
    mergedCountRef.current = 0

    const updated: Conversation = {
      ...activeConvo,
      messages: [],
      title: "New chat",
      updatedAt: new Date().toISOString(),
    }
    const convos = conversations.map((c) => (c.id === updated.id ? updated : c))
    persist(convos, updated)
  }, [activeConvo, conversations, clearAgentMessages, persist])

  return (
    <div className="flex h-dvh bg-page">
      {/* Party mode */}
      <PartyOverlay active={partyMode} onEnd={stopParty} />

      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvo?.id || null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
      />

      {/* Main chat area */}
      <div
        className="relative flex-1 h-dvh"
        style={{
          boxShadow:
            "rgba(139, 92, 246, 0.03) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 1px 1px -0.5px",
        }}
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-3 py-2">
          {/* Left buttons */}
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

            <Button
              onClick={clearChat}
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-s-5 hover:bg-s-10 text-s-60"
              aria-label="Clear chat"
            >
              <MessageSquareDashed className="w-4 h-4" />
            </Button>
          </div>

          {/* Center — Nova status */}
          <div className="flex-1 flex justify-center">
            {agentConnected && (
              <button
                onClick={novaState === "speaking" ? interrupt : undefined}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-full text-xs transition-colors",
                  novaState === "speaking"
                    ? "bg-violet-500/20 text-violet-400 hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                    : "bg-s-5 text-s-50 cursor-default",
                )}
                aria-label={novaState === "speaking" ? "Click to interrupt Nova" : undefined}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      novaState === "speaking"
                        ? "#a78bfa"
                        : novaState === "thinking"
                        ? "#fbbf24"
                        : novaState === "listening"
                        ? "#34d399"
                        : "#94a3b8",
                  }}
                />
                {novaState === "speaking" ? "Nova speaking — click to stop" : `Nova ${novaState}`}
              </button>
            )}

            {!agentConnected && (
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/10 text-xs text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                Agent offline
              </div>
            )}
          </div>

          {/* Right — Zoom + Voice toggle + Theme toggle */}
          <div className="flex items-center gap-1.5">
            <Button
              onClick={() => adjustZoom(-10)}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full bg-s-5 hover:bg-s-10 text-s-60"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-s-40 w-8 text-center select-none">{chatZoom}%</span>
            <Button
              onClick={() => adjustZoom(10)}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full bg-s-5 hover:bg-s-10 text-s-60"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              onClick={() => setVoiceMode(!voiceMode)}
              variant="ghost"
              size="icon"
              className={`h-9 w-9 rounded-full ${
                voiceMode ? "bg-violet-500/20 hover:bg-violet-500/30 text-violet-400" : "bg-s-5 hover:bg-s-10 text-s-60"
              }`}
              aria-label={voiceMode ? "Disable voice mode" : "Enable voice mode"}
            >
              {voiceMode ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <ThemeToggle />
          </div>
        </div>

        <MessageList messages={displayMessages} isStreaming={isThinking} novaState={novaState} error={null} onRetry={() => {}} isLoaded={isLoaded} zoom={chatZoom} />

        <Composer
          onSend={sendMessage}
          onStop={() => {}}
          isStreaming={isThinking}
          disabled={!agentConnected}
        />
      </div>
    </div>
  )
}
