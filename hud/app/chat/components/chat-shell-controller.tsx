"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Blocks, Pin, Settings, BarChart3 } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "@/components/chat/composer"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { cn } from "@/lib/shared/utils"
import { loadUserSettings } from "@/lib/settings/userSettings"
import { getActiveUserId } from "@/lib/auth/active-user"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"
import { BraveIcon, ClaudeIcon, CoinbaseIcon, DiscordIcon, GeminiIcon, GmailCalendarIcon, GmailIcon, OpenAIIcon, SpotifyIcon, TelegramIcon, XAIIcon } from "@/components/icons"
import { normalizeHandoffOperationToken, PENDING_CHAT_SESSION_KEY } from "@/lib/chat/handoff"

// Hooks
import { useConversations } from "@/lib/chat/hooks/useConversations"
import { useIntegrationsStatus } from "@/lib/integrations/hooks/useIntegrationsStatus"
import { useMissions, formatDailyTime } from "@/lib/missions/hooks/useMissions"
import { useChatBackground } from "@/lib/chat/hooks/useChatBackground"
import { buildEmailAssistantFailureReply, buildEmailAssistantReply, extractEmailSummaryMaxResults, isEmailAssistantIntent, type GmailSummaryApiResponse } from "@/lib/chat/email-assistant"

const PENDING_BOOT_ACK_TIMEOUT_MS = 8_000

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: Date
  imageData?: string
  source?: "hud" | "agent" | "voice"
  sender?: string
  nlpCleanText?: string
  nlpConfidence?: number
  nlpCorrectionCount?: number
  nlpBypass?: boolean
}

export function ChatShellController() {
  const router = useRouter()

  // Nova state
  const {
    state: novaState,
    thinkingStatus,
    connected: agentConnected,
    chatTransportEvents,
    streamingAssistantId,
    hudMessageAckVersion,
    hasHudMessageAck,
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
    addAssistantMessage,
    ensureServerConversationForOptimistic,
    resolveConversationIdForAgent,
    resolveSessionConversationIdForAgent,
    pendingQueueStatus,
  } = useConversations({
    agentConnected,
    chatTransportEvents,
    clearAgentMessages,
  })

  // Integrations
  const {
    integrationsHydrated,
    telegramConnected,
    discordConnected,
    braveConnected,
    braveConfigured,
    coinbaseConnected,
    coinbaseConfigured,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
    spotifyConnected,
    gcalendarConnected,
    integrationGuardNotice,
    handleToggleTelegramIntegration,
    handleToggleDiscordIntegration,
    handleToggleBraveIntegration,
    handleToggleCoinbaseIntegration,
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
  const pendingBootSendOpTokenRef = useRef("")
  const pendingBootSendDispatchedAtRef = useRef(0)
  const sidebarPanelsRef = useRef<HTMLElement | null>(null)

  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)

  // Single canonical thinking signal from runtime state + active stream id.
  const isThinking = useMemo(() => {
    if (novaState === "thinking") return true
    if (streamingAssistantId) return true
    return false
  }, [novaState, streamingAssistantId])

  const getSupabaseAccessToken = useCallback(async (): Promise<string> => {
    if (!hasSupabaseClientConfig || !supabaseBrowser) return ""
    const { data } = await supabaseBrowser.auth.getSession()
    return String(data.session?.access_token || "").trim()
  }, [])

  const buildHudSessionKey = useCallback(
    (userId: string, conversationId: string): string => {
      const normalizedUserId = String(userId || "").trim()
      const sessionConversationId = resolveSessionConversationIdForAgent(conversationId)
      if (!normalizedUserId || !sessionConversationId) return ""
      return `agent:nova:hud:user:${normalizedUserId}:dm:${sessionConversationId}`
    },
    [resolveSessionConversationIdForAgent],
  )

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
    const name = !newMuted ? loadUserSettings().personalization.assistantName : undefined
    setMuted(newMuted, name)
  }, [isMuted, setMuted])

  useLayoutEffect(() => {
    const storedMuted = localStorage.getItem("nova-muted")
    const muted = storedMuted === null ? true : storedMuted === "true"
    setIsMuted(muted)
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    if (agentConnected && muteHydrated) {
      const name = !isMuted ? loadUserSettings().personalization.assistantName : undefined
      setMuted(isMuted, name)
    }
  }, [agentConnected, isMuted, muteHydrated, setMuted])

  // Home -> Chat handoff
  useEffect(() => {
    const opToken = String(pendingBootSendOpTokenRef.current || "").trim()
    if (!opToken) return
    if (!hasHudMessageAck(opToken)) return
    pendingBootSendHandledRef.current = true
    pendingBootSendOpTokenRef.current = ""
    pendingBootSendDispatchedAtRef.current = 0
    try {
      sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
    } catch {}
  }, [hudMessageAckVersion, hasHudMessageAck])

  useEffect(() => {
    if (pendingBootSendHandledRef.current || !agentConnected || !activeConvo) return

    const markPendingBootHandled = () => {
      pendingBootSendHandledRef.current = Boolean(1)
    }

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
        opToken?: string
        messageCreatedAt?: string
      }
      const pendingOpToken = normalizeHandoffOperationToken(parsed.opToken)
      if (pendingOpToken && hasHudMessageAck(pendingOpToken)) {
        markPendingBootHandled()
        pendingBootSendOpTokenRef.current = ""
        pendingBootSendDispatchedAtRef.current = 0
        sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
        return
      }
      if (pendingOpToken && pendingBootSendOpTokenRef.current === pendingOpToken) {
        const elapsedSinceDispatch = Date.now() - Number(pendingBootSendDispatchedAtRef.current || 0)
        if (elapsedSinceDispatch < PENDING_BOOT_ACK_TIMEOUT_MS) return
        pendingBootSendOpTokenRef.current = ""
        pendingBootSendDispatchedAtRef.current = 0
      }

      const pendingConvoId = typeof parsed.convoId === "string" ? parsed.convoId.trim() : ""
      const resolvedPendingConvoId = pendingConvoId
        ? resolveConversationIdForAgent(pendingConvoId) || pendingConvoId
        : ""
      const targetConvoExists = resolvedPendingConvoId
        ? conversations.some((entry) => String(entry.id || "").trim() === resolvedPendingConvoId)
        : false
      if (resolvedPendingConvoId && resolvedPendingConvoId !== activeConvo.id && targetConvoExists) {
        void handleSelectConvo(resolvedPendingConvoId)
        return
      }

      const pendingContent = typeof parsed.content === "string" ? parsed.content.trim() : ""
      if (!pendingContent) return

      const pendingMessageId = typeof parsed.messageId === "string" ? parsed.messageId.trim() : ""

      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        return
      }

      if (pendingOpToken) {
        pendingBootSendOpTokenRef.current = pendingOpToken
        pendingBootSendDispatchedAtRef.current = Date.now()
      } else {
        pendingBootSendHandledRef.current = true
        pendingBootSendOpTokenRef.current = ""
        pendingBootSendDispatchedAtRef.current = 0
        sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
      }

      void (async () => {
        const supabaseAccessToken = await getSupabaseAccessToken()
        const sessionKey = buildHudSessionKey(activeUserId, activeConvo.id)
        sendToAgent(pendingContent, settings.app.voiceEnabled, settings.app.ttsVoice, {
          conversationId: resolveConversationIdForAgent(activeConvo.id),
          sender: "hud-user",
          ...(sessionKey ? { sessionKey } : {}),
          ...(pendingMessageId ? { messageId: pendingMessageId } : {}),
          ...(pendingOpToken ? { opToken: pendingOpToken } : {}),
          userId: activeUserId,
          supabaseAccessToken: supabaseAccessToken || undefined,
          assistantName: settings.personalization.assistantName,
          communicationStyle: settings.personalization.communicationStyle,
          tone: settings.personalization.tone,
          proactivity: settings.personalization.proactivity,
          humor_level: settings.personalization.humor_level,
          risk_tolerance: settings.personalization.risk_tolerance,
          structure_preference: settings.personalization.structure_preference,
          challenge_level: settings.personalization.challenge_level,
        })
        // Create/sync optimistic convo on server in background so list stays in sync
        void ensureServerConversationForOptimistic(activeConvo)
      })()
    } catch {
      sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
      markPendingBootHandled()
      pendingBootSendOpTokenRef.current = ""
      pendingBootSendDispatchedAtRef.current = 0
    }
  }, [
    activeConvo,
    conversations,
    agentConnected,
    hasHudMessageAck,
    sendToAgent,
    handleSelectConvo,
    getSupabaseAccessToken,
    ensureServerConversationForOptimistic,
    resolveConversationIdForAgent,
    buildHudSessionKey,
  ])

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

  useEffect(() => {
    const lockLayerSelector = [
      "[aria-modal='true']",
      "[role='dialog'][data-state='open']",
      "[role='alertdialog'][data-state='open']",
      "[data-slot='dropdown-menu-content'][data-state='open']",
      "[data-slot='dropdown-menu-sub-content'][data-state='open']",
    ].join(", ")
    const interval = window.setInterval(() => {
      const body = document.body
      const root = document.documentElement
      if (!body || !root) return
      const bodyPointer = String(body.style.pointerEvents || "").trim().toLowerCase()
      const rootPointer = String(root.style.pointerEvents || "").trim().toLowerCase()
      if (bodyPointer !== "none" && rootPointer !== "none") return
      if (document.querySelector(lockLayerSelector)) return
      body.style.removeProperty("pointer-events")
      root.style.removeProperty("pointer-events")
    }, 2_000)
    return () => window.clearInterval(interval)
  }, [])

  // Send message
  const sendMessage = useCallback(
    async (content: string, options?: { nlpBypass?: boolean }) => {
      if (!content.trim() || !agentConnected || !activeConvo) return

      const updatedConvo = addUserMessage(content)
      const lastMessage = updatedConvo?.messages?.[updatedConvo.messages.length - 1]
      const localMessageId = lastMessage?.role === "user" ? String(lastMessage.id || "") : ""

      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        return
      }
      const supabaseAccessToken = await getSupabaseAccessToken()
      if (gmailConnected && isEmailAssistantIntent(content)) {
        const maxResults = extractEmailSummaryMaxResults(content, 6)
        try {
          const response = await fetch("/api/integrations/gmail/summary", {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              ...(supabaseAccessToken ? { authorization: `Bearer ${supabaseAccessToken}` } : {}),
            },
            body: JSON.stringify({ maxResults }),
          })
          const payload = (await response.json().catch(() => ({}))) as GmailSummaryApiResponse
          if (!response.ok || !payload.ok) {
            const message = response.status === 401
              ? buildEmailAssistantFailureReply({
                  nickname: settings.personalization.nickname,
                  communicationStyle: settings.personalization.communicationStyle,
                  tone: settings.personalization.tone,
                  characteristics: settings.personalization.characteristics,
                  customInstructions: settings.personalization.customInstructions,
                  reason: "unauthorized",
                })
              : (payload.error || buildEmailAssistantFailureReply({
                  nickname: settings.personalization.nickname,
                  communicationStyle: settings.personalization.communicationStyle,
                  tone: settings.personalization.tone,
                  characteristics: settings.personalization.characteristics,
                  customInstructions: settings.personalization.customInstructions,
                  reason: "temporary",
                }))
            addAssistantMessage(message, { sender: settings.personalization.assistantName })
            return
          }
          const assistantReply = buildEmailAssistantReply({
            prompt: content,
            nickname: settings.personalization.nickname,
            assistantName: settings.personalization.assistantName,
            communicationStyle: settings.personalization.communicationStyle,
            tone: settings.personalization.tone,
            characteristics: settings.personalization.characteristics,
            customInstructions: settings.personalization.customInstructions,
            summary: String(payload.summary || ""),
            emails: Array.isArray(payload.emails) ? payload.emails : [],
          })
          addAssistantMessage(assistantReply, { sender: settings.personalization.assistantName })
          return
        } catch {
          addAssistantMessage(buildEmailAssistantFailureReply({
            nickname: settings.personalization.nickname,
            communicationStyle: settings.personalization.communicationStyle,
            tone: settings.personalization.tone,
            characteristics: settings.personalization.characteristics,
            customInstructions: settings.personalization.customInstructions,
            reason: "temporary",
          }), { sender: settings.personalization.assistantName })
          return
        }
      }
      const sessionKey = buildHudSessionKey(activeUserId, activeConvo.id)
      sendToAgent(content.trim(), settings.app.voiceEnabled, settings.app.ttsVoice, {
        conversationId: resolveConversationIdForAgent(activeConvo.id),
        sender: "hud-user",
        ...(sessionKey ? { sessionKey } : {}),
        messageId: localMessageId,
        ...(options?.nlpBypass ? { nlpBypass: true } : {}),
        userId: activeUserId,
        supabaseAccessToken: supabaseAccessToken || undefined,
        assistantName: settings.personalization.assistantName,
        communicationStyle: settings.personalization.communicationStyle,
        tone: settings.personalization.tone,
        proactivity: settings.personalization.proactivity,
        humor_level: settings.personalization.humor_level,
        risk_tolerance: settings.personalization.risk_tolerance,
        structure_preference: settings.personalization.structure_preference,
        challenge_level: settings.personalization.challenge_level,
      })
    },
    [activeConvo, agentConnected, sendToAgent, addUserMessage, addAssistantMessage, getSupabaseAccessToken, resolveConversationIdForAgent, buildHudSessionKey, gmailConnected],
  )

  const handleUseSuggestedWording = useCallback(
    async (message: Message) => {
      const suggested = String(message.nlpCleanText || "").trim()
      if (!suggested) return
      await sendMessage(suggested, { nlpBypass: true })
    },
    [sendMessage],
  )

  // Convert ChatMessage[] to Message[] for MessageList
  const displayMessages: Message[] = useMemo(() => {
    if (!activeConvo) return []
    const msgs: Message[] = activeConvo.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
      source: m.source,
      sender: m.sender,
      nlpCleanText: m.nlpCleanText,
      nlpConfidence: m.nlpConfidence,
      nlpCorrectionCount: m.nlpCorrectionCount,
      nlpBypass: m.nlpBypass,
    }))
    if (streamingAssistantId && !msgs.some((m) => m.id === streamingAssistantId)) {
      msgs.push({
        id: streamingAssistantId,
        role: "assistant",
        content: "",
        createdAt: new Date(),
      })
    }
    return msgs
  }, [activeConvo, streamingAssistantId])

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
      {pendingQueueStatus.mode !== "idle" ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs backdrop-blur-md shadow-lg",
              isLight
                ? "border-amber-300/40 bg-amber-500/12 text-amber-700"
                : "border-amber-300/40 bg-amber-500/15 text-amber-200",
            )}
          >
            {pendingQueueStatus.mode === "retrying"
              ? `${pendingQueueStatus.message} Retrying in ${pendingQueueStatus.retryInSeconds}s.`
              : "Processing pending mission output..."}
          </div>
        </div>
      ) : null}

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
                thinkingStatus={thinkingStatus}
                error={null}
                onRetry={() => {}}
                isLoaded={isLoaded}
                zoom={100}
                orbPalette={orbPalette}
                onUseSuggestedWording={handleUseSuggestedWording}
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
                    onClick={() => {
                      window.location.href = "/missions"
                    }}
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
                  <div className="flex items-center gap-2 min-w-0 text-s-80">
                    <Blocks className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Integrations</h2>
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
                      <TelegramIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleDiscordIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(discordConnected))}
                      title={discordConnected ? "Discord connected" : "Discord disconnected"}
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-white -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleOpenAIIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(openaiConnected))}
                      title={openaiConnected ? "OpenAI connected" : "OpenAI disconnected"}
                    >
                      <OpenAIIcon className="w-4 h-4 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleClaudeIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(claudeConnected))}
                      title={claudeConnected ? "Claude connected" : "Claude disconnected"}
                    >
                      <ClaudeIcon className="w-4 h-4 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleGrokIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(grokConnected))}
                      title={grokConnected ? "Grok connected" : "Grok disconnected"}
                    >
                      <span className="inline-flex -translate-y-0.5"><XAIIcon size={16} /></span>
                    </button>
                    <button
                      onClick={handleToggleGeminiIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(geminiConnected))}
                      title={geminiConnected ? "Gemini connected" : "Gemini disconnected"}
                    >
                      <span className="inline-flex -translate-y-0.5"><GeminiIcon size={16} /></span>
                    </button>
                    <button
                      onClick={handleToggleGmailIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(gmailConnected))}
                      title={gmailConnected ? "Gmail connected" : "Gmail disconnected"}
                    >
                      <GmailIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={() => router.push("/integrations")}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(spotifyConnected))}
                      title={spotifyConnected ? "Spotify connected" : "Spotify disconnected"}
                    >
                      <SpotifyIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={() => router.push("/integrations")}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(gcalendarConnected))}
                      title={gcalendarConnected ? "Google Calendar connected" : "Google Calendar disconnected"}
                    >
                      <GmailCalendarIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleBraveIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(braveConnected))}
                      title={braveConnected ? "Brave connected" : braveConfigured ? "Brave disconnected" : "Brave key required"}
                    >
                      <BraveIcon className="w-4 h-4 -translate-y-0.5" />
                    </button>
                    <button
                      onClick={handleToggleCoinbaseIntegration}
                      className={cn("h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow", integrationBadgeClass(coinbaseConnected))}
                      title={coinbaseConnected ? "Coinbase connected" : coinbaseConfigured ? "Coinbase disconnected" : "Coinbase keys required"}
                    >
                      <CoinbaseIcon className="w-4 h-4 -translate-y-0.5" />
                    </button>
                    {Array.from({ length: 13 }).map((_, index) => (
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



