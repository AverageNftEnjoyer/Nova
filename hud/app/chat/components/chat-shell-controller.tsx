"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Blocks, Pin, Settings, BarChart3 } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "@/components/composer"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "@/components/chat-sidebar"
import { cn } from "@/lib/utils"
import { loadUserSettings } from "@/lib/userSettings"
import { getActiveUserId } from "@/lib/active-user"
import { DiscordIcon } from "@/components/discord-icon"
import { BraveIcon } from "@/components/brave-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { XAIIcon } from "@/components/xai-icon"
import { GeminiIcon } from "@/components/gemini-icon"
import { GmailIcon } from "@/components/gmail-icon"
import { TelegramIcon } from "@/components/telegram-icon"

// Hooks
import { useConversations } from "@/lib/useConversations"
import { useIntegrationsStatus } from "@/lib/useIntegrationsStatus"
import { useMissions, formatDailyTime } from "@/lib/useMissions"
import { useChatBackground } from "@/lib/useChatBackground"

const PENDING_CHAT_SESSION_KEY = "nova_pending_chat_message"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: Date
  imageData?: string
  source?: "hud" | "agent" | "voice"
  sender?: string
}

function hasRenderableAssistantContent(content: string | undefined): boolean {
  if (!content) return false
  return content.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().length > 0
}

export function ChatShellController() {
  const router = useRouter()

  // Nova state
  const {
    state: novaState,
    connected: agentConnected,
    agentMessages,
    streamingAssistantId,
    sendToAgent,
    clearAgentMessages,
    setMuted,
  } = useNovaState()

  // Background & theme
  const {
    isLight,
    orbPalette,
    spotlightEnabled,
  } = useChatBackground()

  // Conversations
  const {
    conversations,
    activeConvo,
    isLoaded,
    handleNewChat,
    handleSelectConvo,
    handleDeleteConvo,
    handleRenameConvo,
    handleArchiveConvo,
    handlePinConvo,
    addUserMessage,
  } = useConversations({
    agentConnected,
    agentMessages,
    clearAgentMessages,
  })

  // Integrations
  const {
    integrationsHydrated,
    telegramConnected,
    discordConnected,
    braveConnected,
    braveConfigured,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
    integrationGuardNotice,
    handleToggleTelegramIntegration,
    handleToggleDiscordIntegration,
    handleToggleBraveIntegration,
    handleToggleOpenAIIntegration,
    handleToggleClaudeIntegration,
    handleToggleGrokIntegration,
    handleToggleGeminiIntegration,
    handleToggleGmailIntegration,
  } = useIntegrationsStatus()

  // Missions
  const { missions } = useMissions()

  // Local state
  const pendingBootSendHandledRef = useRef(false)
  const sidebarPanelsRef = useRef<HTMLElement | null>(null)

  const [localThinking, setLocalThinking] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const [thinkingStalled, setThinkingStalled] = useState(false)
  const isThinking = !thinkingStalled && (novaState === "thinking" || localThinking)

  // Mute state sync
  useEffect(() => {
    if (novaState === "muted") {
      setIsMuted(true)
    }
  }, [novaState])

  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted)
    localStorage.setItem("nova-muted", String(newMuted))
    setMuted(newMuted)
  }, [isMuted, setMuted])

  useLayoutEffect(() => {
    const storedMuted = localStorage.getItem("nova-muted")
    const muted = storedMuted === null ? true : storedMuted === "true"
    setIsMuted(muted)
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    if (agentConnected && muteHydrated) {
      setMuted(isMuted)
    }
  }, [agentConnected, isMuted, muteHydrated, setMuted])

  // Thinking state management
  useEffect(() => {
    if (novaState === "speaking") {
      setLocalThinking(false)
    }
  }, [novaState])

  useEffect(() => {
    const last = agentMessages[agentMessages.length - 1]
    if (last?.role === "user") {
      setLocalThinking(true)
      setThinkingStalled(false)
      return
    }
    if (last?.role === "assistant" && hasRenderableAssistantContent(last.content)) {
      setLocalThinking(false)
      setThinkingStalled(false)
    }
  }, [agentMessages])

  useEffect(() => {
    if (!(novaState === "thinking" || localThinking)) return
    const timer = window.setTimeout(() => {
      setLocalThinking(false)
      setThinkingStalled(true)
    }, 35000)
    return () => window.clearTimeout(timer)
  }, [novaState, localThinking])

  useEffect(() => {
    if (novaState !== "thinking") {
      setThinkingStalled(false)
    }
  }, [novaState])

  // Home -> Chat handoff
  useEffect(() => {
    if (pendingBootSendHandledRef.current || !agentConnected || !activeConvo) return

    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(PENDING_CHAT_SESSION_KEY)
    } catch {
      return
    }
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as {
        convoId?: string
        content?: string
        messageId?: string
        messageCreatedAt?: string
      }
      const pendingConvoId = typeof parsed.convoId === "string" ? parsed.convoId.trim() : ""
      if (pendingConvoId && pendingConvoId !== activeConvo.id) {
        void handleSelectConvo(pendingConvoId)
        return
      }

      const pendingContent = typeof parsed.content === "string" ? parsed.content.trim() : ""
      if (!pendingContent) return

      const pendingMessageId = typeof parsed.messageId === "string" ? parsed.messageId.trim() : ""
      const userAlreadyPresent = activeConvo.messages.some(
        (m) =>
          m.role === "user" &&
          (
            (pendingMessageId.length > 0 && m.id === pendingMessageId) ||
            m.content.trim() === pendingContent
          )
      )
      let pendingLocalMessageId = ""
      if (!userAlreadyPresent) {
        const updatedConvo = addUserMessage(pendingContent)
        const lastMessage = updatedConvo?.messages?.[updatedConvo.messages.length - 1]
        pendingLocalMessageId = lastMessage?.role === "user" ? String(lastMessage.id || "") : ""
      } else if (pendingMessageId) {
        pendingLocalMessageId = pendingMessageId
      }

      pendingBootSendHandledRef.current = true
      sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)

      setLocalThinking(true)
      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        setLocalThinking(false)
        return
      }
      sendToAgent(pendingContent, settings.app.voiceEnabled, settings.app.ttsVoice, {
        conversationId: activeConvo.id,
        sender: "hud-user",
        messageId: pendingLocalMessageId || pendingMessageId,
        userId: activeUserId,
        assistantName: settings.personalization.assistantName,
        communicationStyle: settings.personalization.communicationStyle,
        tone: settings.personalization.tone,
      })
    } catch {
      sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
      pendingBootSendHandledRef.current = true
    }
  }, [activeConvo, agentConnected, sendToAgent, addUserMessage, handleSelectConvo])

  // Spotlight effect
  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement) => {
      const spotlight = document.createElement("div")
      spotlight.className = "home-global-spotlight"
      section.appendChild(spotlight)

      const handleMouseMove = (e: MouseEvent) => {
        const rect = section.getBoundingClientRect()
        spotlight.style.left = `${e.clientX - rect.left}px`
        spotlight.style.top = `${e.clientY - rect.top}px`
        spotlight.style.opacity = "1"

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
          const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-radius", "120px")
          const inX = e.clientX >= cardRect.left && e.clientX <= cardRect.right
          const inY = e.clientY >= cardRect.top && e.clientY <= cardRect.bottom
          card.style.setProperty("--glow-intensity", inX && inY ? "1" : "0")
        })
      }

      const handleMouseLeave = () => {
        spotlight.style.opacity = "0"
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        spotlight.remove()
      }
    }

    const cleanups: Array<() => void> = []
    if (sidebarPanelsRef.current) cleanups.push(setupSectionSpotlight(sidebarPanelsRef.current))

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [spotlightEnabled])

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !agentConnected || !activeConvo) return

      const updatedConvo = addUserMessage(content)
      const lastMessage = updatedConvo?.messages?.[updatedConvo.messages.length - 1]
      const localMessageId = lastMessage?.role === "user" ? String(lastMessage.id || "") : ""
      setLocalThinking(true)
      setThinkingStalled(false)

      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        setLocalThinking(false)
        return
      }
      sendToAgent(content.trim(), settings.app.voiceEnabled, settings.app.ttsVoice, {
        conversationId: activeConvo.id,
        sender: "hud-user",
        messageId: localMessageId,
        userId: activeUserId,
        assistantName: settings.personalization.assistantName,
        communicationStyle: settings.personalization.communicationStyle,
        tone: settings.personalization.tone,
      })
    },
    [activeConvo, agentConnected, sendToAgent, addUserMessage],
  )

  // Convert ChatMessage[] to Message[] for MessageList
  const displayMessages: Message[] = useMemo(() => {
    if (!activeConvo) return []
    return activeConvo.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
      source: m.source,
      sender: m.sender,
    }))
  }, [activeConvo])

  // UI styling
  const panelClass = isLight
    ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
    : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const missionHover = isLight
    ? "hover:bg-[#eef3fb] hover:border-[#d5dce8]"
    : "hover:bg-[#141923] hover:border-[#2b3240]"

  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-page" : "bg-transparent")}>

      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvo?.id || null}
        isOpen={true}
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
        <div className="relative z-10 h-full w-full px-6 pt-4 pb-6">
          <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="relative min-h-0 overflow-hidden rounded-2xl">
              <MessageList
                messages={displayMessages}
                isStreaming={isThinking}
                streamingAssistantId={streamingAssistantId}
                error={null}
                onRetry={() => {}}
                isLoaded={isLoaded}
                zoom={100}
                orbPalette={orbPalette}
              />
              <Composer
                onSend={sendMessage}
                isStreaming={isThinking}
                disabled={!agentConnected}
                isMuted={isMuted}
                onToggleMute={handleMuteToggle}
                muteHydrated={muteHydrated}
              />
            </div>

            {/* Right sidebar panels */}
            <aside ref={sidebarPanelsRef} className="home-spotlight-shell relative hidden min-h-0 flex-col gap-4 pt-0 xl:flex">
              {/* Mission Pipeline */}
              <section style={panelStyle} className={`${panelClass} p-4 min-h-0 flex-1 flex flex-col`}>
                <div className="flex items-center justify-between gap-2 text-s-80">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline</h2>
                  </div>
                  <button
                    onClick={() => router.push("/missions")}
                    className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow group/mission-gear`, subPanelClass)}
                    aria-label="Open mission settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/mission-gear:text-accent group-hover/mission-gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Scheduled Nova workflows</p>

                <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5 px-1 py-1">
                  {missions.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                      No missions yet. Add one in Mission Settings.
                    </p>
                  )}
                  {missions.map((mission) => (
                    <div key={mission.id} className={cn(`${subPanelClass} p-2 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover mission-spotlight-card`, missionHover)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[13px] leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{mission.title}</p>
                        <div className="flex items-center gap-1 flex-nowrap shrink-0">
                          <span
                            className={cn(
                              "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap",
                              mission.enabledCount > 0
                                ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                                : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                            )}
                          >
                            {mission.enabledCount > 0 ? "Active" : "Paused"}
                          </span>
                        </div>
                      </div>
                      {mission.description && (
                        <p className={cn("mt-0.5 text-[11px] leading-4 line-clamp-2", isLight ? "text-s-60" : "text-slate-400")}>{mission.description}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {mission.times.map((time) => (
                          <span key={`${mission.id}-${time}`} className={cn("text-[10px] px-1.5 py-0.5 rounded-md border", isLight ? "border-[#d6deea] bg-[#edf2fb] text-s-70" : "border-white/10 bg-white/4 text-slate-300")}>
                            {formatDailyTime(time, mission.timezone)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Integrations */}
              <section style={panelStyle} className={`${panelClass} p-4`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-s-80">
                    <Blocks className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Nova Integrations</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => router.push("/analytics")}
                      className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow`, subPanelClass)}
                      aria-label="Open analytics"
                      title="Open analytics"
                    >
                      <BarChart3 className="w-3.5 h-3.5 mx-auto text-s-50 transition-colors hover:text-accent" />
                    </button>
                    <button
                      onClick={() => router.push("/integrations")}
                      className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow group/gear`, subPanelClass)}
                      aria-label="Open integrations settings"
                    >
                      <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                    </button>
                  </div>
                </div>

                <div className="relative mt-1 h-5">
                  <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>
                  {integrationGuardNotice ? (
                    <div className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2">
                      <div className={cn("rounded-xl border px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap backdrop-blur-xl shadow-[0_14px_30px_-16px_rgba(0,0,0,0.7)]", isLight ? "border-rose-300 bg-rose-100 text-rose-700" : "border-rose-300/50 bg-rose-950 text-rose-100")}>
                        {integrationGuardNotice}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={cn("mt-3 p-2 rounded-lg", subPanelClass)}>
                  <div className="grid grid-cols-6 gap-1">
                    <button
                      onClick={handleToggleTelegramIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(telegramConnected))}
                      title={telegramConnected ? "Telegram connected" : "Telegram disconnected"}
                    >
                      <TelegramIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleDiscordIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(discordConnected))}
                      title={discordConnected ? "Discord connected" : "Discord disconnected"}
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button
                      onClick={handleToggleOpenAIIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(openaiConnected))}
                      title={openaiConnected ? "OpenAI connected" : "OpenAI disconnected"}
                    >
                      <OpenAIIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleClaudeIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(claudeConnected))}
                      title={claudeConnected ? "Claude connected" : "Claude disconnected"}
                    >
                      <ClaudeIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleGrokIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(grokConnected))}
                      title={grokConnected ? "Grok connected" : "Grok disconnected"}
                    >
                      <XAIIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGeminiIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(geminiConnected))}
                      title={geminiConnected ? "Gemini connected" : "Gemini disconnected"}
                    >
                      <GeminiIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGmailIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(gmailConnected))}
                      title={gmailConnected ? "Gmail connected" : "Gmail disconnected"}
                    >
                      <GmailIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleBraveIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(braveConnected))}
                      title={braveConnected ? "Brave connected" : braveConfigured ? "Brave disconnected" : "Brave key required"}
                    >
                      <BraveIcon className="w-4 h-4" />
                    </button>
                    {Array.from({ length: 16 }).map((_, index) => (
                      <div key={index} className={cn("h-9 rounded-sm border home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20")} />
                    ))}
                  </div>
                </div>
                <div className="mt-2" />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
