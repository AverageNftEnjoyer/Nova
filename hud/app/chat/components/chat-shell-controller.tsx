"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Blocks, Pin, Settings } from "lucide-react"
import { MessageList } from "./message-list"
import { Composer } from "@/components/chat/composer"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { NovaCatPortrait, resolveNovaCatState, type NovaCatState } from "@/components/chat/nova-cat-portrait"
import { loadUserSettings } from "@/lib/settings/userSettings"
import { readVoiceMuted, writeVoiceMuted } from "@/lib/chat/voice-mode"
import { getActiveUserId } from "@/lib/auth/active-user"
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

  const activeConversationStreaming = useMemo(() => {
    const activeConversationId = String(activeConvo?.id || "").trim()
    if (!activeConversationId) return false
    for (let i = chatTransportEvents.length - 1; i >= 0; i -= 1) {
      const event = chatTransportEvents[i]
      const eventConversationId =
        "conversationId" in event && typeof event.conversationId === "string"
          ? event.conversationId.trim()
          : ""
      if (eventConversationId && eventConversationId !== activeConversationId) continue
      if (event.type === "assistant_stream_done") return false
      if (event.type === "assistant_stream_start" || event.type === "assistant_stream_delta") return true
    }
    return false
  }, [activeConvo?.id, chatTransportEvents])

  // Single canonical thinking signal from runtime state + active stream id.
  const isThinking = useMemo(() => {
    if (novaState === "thinking") return true
    if (streamingAssistantId) return true
    if (activeConversationStreaming) return true
    return false
  }, [activeConversationStreaming, novaState, streamingAssistantId])

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
    writeVoiceMuted(newMuted)
    const name = !newMuted ? loadUserSettings().personalization.assistantName : undefined
    setMuted(newMuted, name)
  }, [isMuted, setMuted])

  useLayoutEffect(() => {
    setIsMuted(readVoiceMuted())
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
      if (resolvedPendingConvoId && resolvedPendingConvoId !== activeConvo.id) {
        void handleSelectConvo(resolvedPendingConvoId)
        return
      }

      const pendingContent = typeof parsed.content === "string" ? parsed.content.trim() : ""
      if (!pendingContent) return

      const pendingMessageId = typeof parsed.messageId === "string" ? parsed.messageId.trim() : ""

      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        pendingBootSendHandledRef.current = true
        pendingBootSendOpTokenRef.current = ""
        pendingBootSendDispatchedAtRef.current = 0
        sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
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
        const sessionKey = buildHudSessionKey(activeUserId, activeConvo.id)
        sendToAgent(pendingContent, settings.app.voiceEnabled, settings.app.ttsVoice, {
          conversationId: resolveConversationIdForAgent(activeConvo.id),
          sender: "hud-user",
          ...(sessionKey ? { sessionKey } : {}),
          ...(pendingMessageId ? { messageId: pendingMessageId } : {}),
          ...(pendingOpToken ? { opToken: pendingOpToken } : {}),
          userId: activeUserId,
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
    ensureServerConversationForOptimistic,
    resolveConversationIdForAgent,
    buildHudSessionKey,
  ])

  // Spotlight effect
  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement) => {
      const clampPct = (value: number) => Math.max(0, Math.min(100, value))
      const clearCards = () => {
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }

      const handleMouseMove = (e: MouseEvent) => {
        const hoveredElement = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const hoveredCandidate = hoveredElement?.closest(".home-spotlight-card") as HTMLElement | null
        const hoveredCard = hoveredCandidate && section.contains(hoveredCandidate) ? hoveredCandidate : null

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          if (cardRect.width <= 1 || cardRect.height <= 1) {
            card.style.setProperty("--glow-intensity", "0")
            return
          }
          const relativeX = clampPct(((e.clientX - cardRect.left) / cardRect.width) * 100)
          const relativeY = clampPct(((e.clientY - cardRect.top) / cardRect.height) * 100)
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-radius", "120px")
          card.style.setProperty("--glow-intensity", hoveredCard === card ? "1" : "0")
        })
      }

      const handleMouseLeave = () => {
        clearCards()
      }
      const handleWindowBlur = () => {
        clearCards()
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)
      window.addEventListener("blur", handleWindowBlur)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        window.removeEventListener("blur", handleWindowBlur)
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
    async (content: string, options?: { nlpBypass?: boolean; imageData?: string }) => {
      if ((!content.trim() && !options?.imageData) || !agentConnected || !activeConvo) return

      const outboundContent = content.trim() || (options?.imageData ? "Please analyze this image." : "")
      const updatedConvo = addUserMessage(outboundContent, {
        ...(options?.imageData ? { imageData: options.imageData } : {}),
      })
      const lastMessage = updatedConvo?.messages?.[updatedConvo.messages.length - 1]
      const localMessageId = lastMessage?.role === "user" ? String(lastMessage.id || "") : ""

      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      if (!activeUserId) {
        return
      }
      if (gmailConnected && isEmailAssistantIntent(outboundContent)) {
        const maxResults = extractEmailSummaryMaxResults(outboundContent, 6)
        try {
          const response = await fetch("/api/integrations/gmail/summary", {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ maxResults }),
          })
          const payload = (await response.json()) as GmailSummaryApiResponse
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
            prompt: outboundContent,
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
      sendToAgent(outboundContent, settings.app.voiceEnabled, settings.app.ttsVoice, {
        conversationId: resolveConversationIdForAgent(activeConvo.id),
        sender: "hud-user",
        ...(sessionKey ? { sessionKey } : {}),
        messageId: localMessageId,
        ...(options?.nlpBypass ? { nlpBypass: true } : {}),
        ...(options?.imageData ? { imageData: options.imageData } : {}),
        userId: activeUserId,
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
    [activeConvo, agentConnected, sendToAgent, addUserMessage, addAssistantMessage, resolveConversationIdForAgent, buildHudSessionKey, gmailConnected],
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
      imageData: m.imageData,
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

  // UI styling (pixel skin lives in app/styles/pixel-ui.css "Chat page")
  const catState = resolveNovaCatState({ agentConnected, novaState, thinking: isThinking })
  const CAT_STATE_LABEL: Record<NovaCatState, string> = {
    idle: "Idle",
    thinking: "Thinking",
    speaking: "Speaking",
    listening: "Listening",
    muted: "Muted",
    offline: "Offline",
  }
  const activeTitle = String(activeConvo?.title || "").trim() || "New conversation"

  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated ? "pc-slot pc-slot--wait" : connected ? "pc-slot pc-slot--on" : "pc-slot pc-slot--off"

  return (
    <div className="pixel-ui pixel-chat pc-root relative flex overflow-hidden">
      {pendingQueueStatus.mode !== "idle" ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
          <div className="pc-banner">
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
      <div className="pc-main relative flex flex-col flex-1 overflow-hidden">
        <div className="relative z-10 h-full w-full px-6 pt-4 pb-6">
          <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
            <div className="pc-dialog pixel-notch relative flex min-h-0 flex-col overflow-hidden">
              <header className="pc-dialog-head">
                <div className="pc-portrait-frame">
                  <NovaCatPortrait state={catState} scale={3} accent={orbPalette.circle1} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="pc-dialog-name">Nova</h2>
                  <p className="pc-dialog-topic truncate" title={activeTitle}>{activeTitle}</p>
                </div>
                <span className="pc-state" data-state={catState} role="status" aria-label={`Nova is ${CAT_STATE_LABEL[catState].toLowerCase()}`}>
                  <i aria-hidden="true" />
                  {CAT_STATE_LABEL[catState]}
                </span>
              </header>
              <div className="pc-dialog-body relative min-h-0 flex-1 overflow-hidden">
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
            </div>

            {/* Right sidebar panels */}
            <aside ref={sidebarPanelsRef} className="relative hidden min-h-0 flex-col gap-4 pt-0 xl:flex">
              {/* Mission Pipeline */}
              <section className="pc-panel pixel-notch min-h-0 flex-1 flex flex-col">
                <div className="pc-panel-head">
                  <div className="flex min-w-0 items-center gap-2">
                    <Pin className="w-4 h-4 shrink-0" />
                    <h2 className="pc-panel-title truncate">Mission Pipeline</h2>
                  </div>
                  <button
                    onClick={() => {
                      router.push("/deployments?mode=advanced&kind=automation")
                    }}
                    className="pc-icon-btn group/mission-gear"
                    aria-label="Open mission settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto group-hover/mission-gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>
                <div className="pc-panel-body flex min-h-0 flex-1 flex-col">
                  <p className="pc-hint pc-hint--flush">Scheduled Nova workflows</p>

                  <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-2">
                    {missions.length === 0 && (
                      <p className="pc-hint pc-hint--flush">
                        No missions yet. Add one in Mission Settings.
                      </p>
                    )}
                    {missions.map((mission) => (
                      <div key={mission.id} className="pc-card">
                        <div className="flex items-start justify-between gap-2">
                          <p className="pc-card-title text-[13px] leading-tight">{mission.title}</p>
                          <div className="flex items-center gap-1 flex-nowrap shrink-0">
                            <span className="pc-tag" data-on={mission.enabledCount > 0 ? "true" : "false"}>
                              {mission.enabledCount > 0 ? "Active" : "Paused"}
                            </span>
                          </div>
                        </div>
                        {mission.description && (
                          <p className="pc-card-desc mt-0.5 text-[11px] leading-4 line-clamp-2">{mission.description}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {mission.times.map((time) => (
                            <span key={`${mission.id}-${time}`} className="pc-time-chip">
                              {formatDailyTime(time, mission.timezone)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Integrations */}
              <section className="pc-panel pixel-notch">
                <div className="pc-panel-head">
                  <div className="flex min-w-0 items-center gap-2">
                    <Blocks className="w-4 h-4 shrink-0" />
                    <h2 className="pc-panel-title truncate">Integrations</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => router.push("/integrations")}
                      className="pc-icon-btn group/gear"
                      aria-label="Open integrations settings"
                    >
                      <Settings className="w-3.5 h-3.5 mx-auto group-hover/gear:rotate-90 transition-transform duration-200" />
                    </button>
                  </div>
                </div>

                <div className="pc-panel-body">
                  <div className="relative min-h-5">
                    <p className="pc-hint pc-hint--flush">Node connectivity</p>
                    {integrationGuardNotice ? (
                      <div className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2">
                        <div className="pc-toast">{integrationGuardNotice}</div>
                      </div>
                    ) : null}
                  </div>

                  <div className="pc-slots mt-3">
                    <div className="grid grid-cols-6 gap-1.5">
                      <button
                        onClick={handleToggleTelegramIntegration}
                        className={integrationBadgeClass(telegramConnected)}
                        title={telegramConnected ? "Telegram connected" : "Telegram disconnected"}
                      >
                        <TelegramIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleDiscordIntegration}
                        className={integrationBadgeClass(discordConnected)}
                        title={discordConnected ? "Discord connected" : "Discord disconnected"}
                      >
                        <DiscordIcon className="w-3.5 h-3.5 text-white -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleOpenAIIntegration}
                        className={integrationBadgeClass(openaiConnected)}
                        title={openaiConnected ? "OpenAI connected" : "OpenAI disconnected"}
                      >
                        <OpenAIIcon className="w-4 h-4 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleClaudeIntegration}
                        className={integrationBadgeClass(claudeConnected)}
                        title={claudeConnected ? "Claude connected" : "Claude disconnected"}
                      >
                        <ClaudeIcon className="w-4 h-4 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleGrokIntegration}
                        className={integrationBadgeClass(grokConnected)}
                        title={grokConnected ? "Grok connected" : "Grok disconnected"}
                      >
                        <span className="inline-flex -translate-y-0.5"><XAIIcon size={16} /></span>
                      </button>
                      <button
                        onClick={handleToggleGeminiIntegration}
                        className={integrationBadgeClass(geminiConnected)}
                        title={geminiConnected ? "Gemini connected" : "Gemini disconnected"}
                      >
                        <span className="inline-flex -translate-y-0.5"><GeminiIcon size={16} /></span>
                      </button>
                      <button
                        onClick={handleToggleGmailIntegration}
                        className={integrationBadgeClass(gmailConnected)}
                        title={gmailConnected ? "Gmail connected" : "Gmail disconnected"}
                      >
                        <GmailIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={() => router.push("/integrations")}
                        className={integrationBadgeClass(spotifyConnected)}
                        title={spotifyConnected ? "Spotify connected" : "Spotify disconnected"}
                      >
                        <SpotifyIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={() => router.push("/integrations")}
                        className={integrationBadgeClass(gcalendarConnected)}
                        title={gcalendarConnected ? "Google Calendar connected" : "Google Calendar disconnected"}
                      >
                        <GmailCalendarIcon className="w-3.5 h-3.5 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleBraveIntegration}
                        className={integrationBadgeClass(braveConnected)}
                        title={braveConnected ? "Brave connected" : braveConfigured ? "Brave disconnected" : "Brave key required"}
                      >
                        <BraveIcon className="w-4 h-4 -translate-y-0.5" />
                      </button>
                      <button
                        onClick={handleToggleCoinbaseIntegration}
                        className={integrationBadgeClass(coinbaseConnected)}
                        title={coinbaseConnected ? "Coinbase connected" : coinbaseConfigured ? "Coinbase disconnected" : "Coinbase keys required"}
                      >
                        <CoinbaseIcon className="w-4 h-4 -translate-y-0.5" />
                      </button>
                      {Array.from({ length: 13 }).map((_, index) => (
                        <div key={index} className="pc-slot pc-slot--empty" />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
