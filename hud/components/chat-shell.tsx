"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { MessageSquareDashed, Volume2, VolumeX, PanelLeftOpen, PanelLeftClose } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "./composer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "./chat-sidebar"
import { BootScreen } from "./boot-screen"
import { PartyOverlay } from "./party-overlay"
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
  source?: "hud" | "agent"
}

export function ChatShell() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [voiceMode, setVoiceMode] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const [booting, setBooting] = useState(true)

  const { state: novaState, connected: agentConnected, agentMessages, sendToAgent, interrupt, clearAgentMessages, partyMode, stopParty } = useNovaState()

  const mergedCountRef = useRef(0)

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
      source: "agent",
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

  // Convert ChatMessage[] to Message[] for MessageList
  const displayMessages: Message[] = activeConvo
    ? activeConvo.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(m.createdAt),
        source: m.source,
      }))
    : []

  const isThinking = novaState === "thinking"

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
    <div className="flex h-dvh bg-[#0a0a0f]">
      {/* Boot screen */}
      {booting && <BootScreen onComplete={() => setBooting(false)} />}

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
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          {/* Left buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-white/60"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </Button>

            <Button
              onClick={clearChat}
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-white/60"
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
                    : "bg-white/5 text-white/50 cursor-default",
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

          {/* Right — Voice toggle */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setVoiceMode(!voiceMode)}
              variant="ghost"
              size="icon"
              className={`h-9 w-9 rounded-full ${
                voiceMode ? "bg-violet-500/20 hover:bg-violet-500/30 text-violet-400" : "bg-white/5 hover:bg-white/10 text-white/60"
              }`}
              aria-label={voiceMode ? "Disable voice mode" : "Enable voice mode"}
            >
              {voiceMode ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <MessageList messages={displayMessages} isStreaming={isThinking} error={null} onRetry={() => {}} isLoaded={isLoaded} />

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
