"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { MessageSquareDashed, PanelLeftOpen, PanelLeftClose, House } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "./composer"
import { Button } from "@/components/ui/button"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "./chat-sidebar"
import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
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
import { loadUserSettings } from "@/lib/userSettings"

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
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const { state: novaState, connected: agentConnected, agentMessages, telegramMessages, sendToAgent, clearAgentMessages, clearTelegramMessages, transcript } = useNovaState()

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

      const settings = loadUserSettings()
      sendToAgent(content.trim(), settings.app.voiceEnabled, settings.app.ttsVoice)
    },
    [activeConvo, conversations, agentConnected, sendToAgent, persist],
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

  const handleRenameConvo = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const next = conversations.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
      )
      const nextActive = activeConvo ? next.find((c) => c.id === activeConvo.id) ?? activeConvo : null
      persist(next, nextActive)
    },
    [conversations, activeConvo, persist],
  )

  const handleArchiveConvo = useCallback(
    (id: string, archived: boolean) => {
      const next = conversations.map((c) =>
        c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
      )

      if (activeConvo?.id === id && archived) {
        const fallback = next.find((c) => !c.archived && c.id !== id) ?? next.find((c) => c.id !== id) ?? null
        persist(next, fallback)
        return
      }

      const nextActive = activeConvo ? next.find((c) => c.id === activeConvo.id) ?? activeConvo : null
      persist(next, nextActive)
    },
    [conversations, activeConvo, persist],
  )

  const handlePinConvo = useCallback(
    (id: string, pinned: boolean) => {
      const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
      const nextActive = activeConvo ? next.find((c) => c.id === activeConvo.id) ?? activeConvo : null
      persist(next, nextActive)
    },
    [conversations, activeConvo, persist],
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
      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvo?.id || null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        novaState={novaState}
        agentConnected={agentConnected}
      />

      {/* Main chat area */}
      <div
        className="flex flex-col flex-1 h-dvh"
        style={{
          boxShadow: isLight
            ? "0 0 0 1px rgba(217, 224, 234, 1)"
            : "rgba(139, 92, 246, 0.03) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 1px 1px -0.5px",
        }}
      >
        {/* Top bar */}
        <div className={cn("z-20 flex items-center px-3 py-2 border-b", isLight ? "border-[#d9e0ea] bg-[#f6f8fc]" : "border-s-5 bg-page/90 backdrop-blur-md")}>
          {/* Left buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => router.push("/home")}
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9 rounded-full text-s-60", isLight ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "bg-s-5 hover:bg-s-10")}
              aria-label="Go to home"
            >
              <House className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9 rounded-full text-s-60", isLight ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "bg-s-5 hover:bg-s-10")}
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </Button>

            <Button
              onClick={clearChat}
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9 rounded-full text-s-60", isLight ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "bg-s-5 hover:bg-s-10")}
              aria-label="Clear chat"
            >
              <MessageSquareDashed className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1" />

          <div className="w-[120px]" />
        </div>

        <div className="relative flex-1 min-h-0">
        <MessageList messages={displayMessages} isStreaming={isThinking} novaState={novaState} error={null} onRetry={() => {}} isLoaded={isLoaded} zoom={100} />
        </div>

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

