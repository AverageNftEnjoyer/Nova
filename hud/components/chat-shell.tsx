"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { PanelLeftOpen, PanelLeftClose } from "lucide-react"
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
import { loadUserSettings, ORB_COLORS, type OrbColor, type BackgroundType, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import FloatingLines from "@/components/FloatingLines"
import "@/components/FloatingLines.css"

// Adapter: the MessageList expects this shape
export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: Date
  imageData?: string
  source?: "hud" | "agent" | "voice" | "telegram" | "telegram_history"
  sender?: string
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export function ChatShell() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<BackgroundType>("default")
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const { state: novaState, connected: agentConnected, agentMessages, telegramMessages, sendToAgent, clearAgentMessages } = useNovaState()
  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(
    () => [orbPalette.circle1, orbPalette.circle2],
    [orbPalette.circle1, orbPalette.circle2],
  )

  const mergedCountRef = useRef(0)
  const telegramMergedCountRef = useRef(0)

  // Load conversations and muted state on mount
  useEffect(() => {
    const convos = loadConversations()
    setConversations(convos)

    const settings = loadUserSettings()
    setOrbColor(settings.app.orbColor)
    setBackground(settings.app.background || "default")
    setSettingsLoaded(true)

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

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setOrbColor(settings.app.orbColor)
      setBackground(settings.app.background || "default")
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
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
    const liveTelegram = newOnes.filter((am) => am.source === "telegram")
    if (liveTelegram.length === 0) return

    const newMsgs: ChatMessage[] = liveTelegram.map((am) => ({
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

  // Also clear thinking as soon as we receive a non-empty assistant text message.
  useEffect(() => {
    const last = agentMessages[agentMessages.length - 1]
    if (last?.role === "assistant" && last.content.trim().length > 0) {
      setLocalThinking(false)
    }
  }, [agentMessages])

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
    router.push("/home")
  }, [router])

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

  return (
    <div className="relative flex h-dvh overflow-hidden bg-page">
      {settingsLoaded && background === "default" && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background:
                `radial-gradient(circle at 48% 46%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.18)} 28%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent 35%)`,
            }}
          />
          <div className="absolute inset-0">
            <div
              className="absolute top-[12%] left-[16%] h-72 w-72 rounded-full blur-[110px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle1, 0.24) }}
            />
            <div
              className="absolute bottom-[8%] right-[14%] h-64 w-64 rounded-full blur-[100px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle2, 0.22) }}
            />
          </div>
        </div>
      )}
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
        className="relative flex flex-col flex-1 h-dvh overflow-hidden"
        style={{
          marginLeft: "0",
          boxShadow: isLight
            ? "0 0 0 1px rgba(217, 224, 234, 1)"
            : "rgba(139, 92, 246, 0.03) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 1px 1px -0.5px",
        }}
      >
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          <div className="group relative">
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="ghost"
              size="icon"
              className={cn(
                "chat-sidebar-card home-spotlight-card home-border-glow home-spotlight-card--hover h-9 w-9 rounded-full transition-all duration-150 hover:[--glow-intensity:1]",
                isLight
                  ? "border border-[#d9e0ea] bg-[#f4f7fd] text-s-70"
                  : "border border-white/10 bg-white/4 text-slate-300 hover:bg-[#141923] hover:border-[#2b3240]",
              )}
              aria-label={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
              ) : (
                <PanelLeftOpen className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
              )}
            </Button>
          </div>
          <div className="flex-1" />
        </div>

        <div className="relative z-10 flex-1 min-h-0">
        <MessageList messages={displayMessages} isStreaming={isThinking} novaState={novaState} error={null} onRetry={() => {}} isLoaded={isLoaded} zoom={100} orbPalette={orbPalette} />
        </div>

        <Composer
          onSend={sendMessage}
          isStreaming={isThinking}
          disabled={!agentConnected}
        />
      </div>
    </div>
  )
}
