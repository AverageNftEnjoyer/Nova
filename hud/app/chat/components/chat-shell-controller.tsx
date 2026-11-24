"use client"

import type React from "react"
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { PanelLeftOpen, WifiOff } from "lucide-react"
import { PageContainer } from "@/components/shell"
import { IconButton, Tooltip } from "@/components/ui"
import { Composer } from "@/components/chat/composer"
import { ChatSidebar, DeleteThreadDialog, RenameThreadDialog, ThreadMenu } from "@/components/chat/chat-sidebar"
import { BraveIcon, CoinbaseIcon, GmailCalendarIcon, GmailIcon, SpotifyIcon } from "@/components/icons"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { useConversations } from "@/lib/chat/hooks/useConversations"
import { useIntegrationsStatus } from "@/lib/integrations/hooks/useIntegrationsStatus"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { readVoiceMuted, writeVoiceMuted } from "@/lib/chat/voice-mode"
import { getActiveUserId } from "@/lib/auth/active-user"
import { normalizeHandoffOperationToken, PENDING_CHAT_SESSION_KEY } from "@/lib/chat/handoff"
import { DEFAULT_CONVERSATION_TITLE, type Conversation } from "@/lib/chat/conversations"
import {
  buildEmailAssistantFailureReply,
  buildEmailAssistantReply,
  extractEmailSummaryMaxResults,
  isEmailAssistantIntent,
  type GmailSummaryApiResponse,
} from "@/lib/chat/email-assistant"
import { CHAT_COLUMN_CLASS, MessageList } from "./message-list"
import { NovaMark } from "./message-bubble"
import type { Message } from "./chat-types"

const PENDING_BOOT_ACK_TIMEOUT_MS = 8_000
const THREADS_COLLAPSED_KEY = "nova-chat-threads-collapsed"

interface Starter {
  id: string
  prompt: string
  icon: React.ReactNode
}

function readThreadsCollapsed(): boolean {
  try {
    return window.localStorage.getItem(THREADS_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function writeThreadsCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(THREADS_COLLAPSED_KEY, collapsed ? "1" : "0")
  } catch {}
}

export function ChatShellController() {
  const searchParams = useSearchParams()

  const {
    state: novaState,
    thinkingStatus,
    connected: agentConnected,
    chatTransportEvents,
    streamingAssistantId,
    hudMessageAckVersion,
    hasHudMessageAck,
    latestUsage,
    sendToAgent,
    interrupt,
    clearAgentMessages,
    setMuted,
  } = useNovaState()

  const {
    conversations,
    activeConvo,
    isLoaded,
    isSynced,
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
  } = useConversations({
    agentConnected,
    chatTransportEvents,
    clearAgentMessages,
  })

  const { gmailConnected, gcalendarConnected, coinbaseConnected, braveConnected, spotifyConnected, activeLlmModel } =
    useIntegrationsStatus()

  const pendingBootSendHandledRef = useRef(false)
  const pendingBootSendOpTokenRef = useRef("")
  const pendingBootSendDispatchedAtRef = useRef(0)

  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const [threadsCollapsed, setThreadsCollapsed] = useState(false)
  const [assistantName, setAssistantName] = useState("Nova")
  const [modelByMessageId, setModelByMessageId] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [deleting, setDeleting] = useState<Conversation | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState("")

  const activeConversationStreaming = useMemo(() => {
    const activeConversationId = String(activeConvo?.id || "").trim()
    if (!activeConversationId) return false
    for (let i = chatTransportEvents.length - 1; i >= 0; i -= 1) {
      const event = chatTransportEvents[i]
      const eventConversationId =
        "conversationId" in event && typeof event.conversationId === "string" ? event.conversationId.trim() : ""
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

  useLayoutEffect(() => {
    setThreadsCollapsed(readThreadsCollapsed())
  }, [])

  useEffect(() => {
    const sync = () => setAssistantName(loadUserSettings().personalization.assistantName || "Nova")
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  const toggleThreads = useCallback(() => {
    setThreadsCollapsed((prev) => {
      writeThreadsCollapsed(!prev)
      return !prev
    })
  }, [])

  // Attribute each usage report to the reply that was streaming when it arrived, so replies show their model.
  const lastStreamIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (streamingAssistantId) lastStreamIdRef.current = streamingAssistantId
  }, [streamingAssistantId])
  useEffect(() => {
    if (!latestUsage) return
    const id = streamingAssistantId || lastStreamIdRef.current
    if (!id) return
    setModelByMessageId((prev) => (prev[id] === latestUsage.model ? prev : { ...prev, [id]: latestUsage.model }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestUsage])

  // Mute state sync
  useEffect(() => {
    if (novaState === "muted") setIsMuted(true)
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

  // Home -> Chat handoff (sessionStorage): acknowledged once the runtime confirms the op token.
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

    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(PENDING_CHAT_SESSION_KEY)
    } catch {
      return
    }
    if (!raw) return

    const resetPendingBoot = (handled: boolean) => {
      pendingBootSendHandledRef.current = handled
      pendingBootSendOpTokenRef.current = ""
      pendingBootSendDispatchedAtRef.current = 0
    }

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
        resetPendingBoot(true)
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
      const resolvedPendingConvoId = pendingConvoId ? resolveConversationIdForAgent(pendingConvoId) || pendingConvoId : ""
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
        resetPendingBoot(true)
        sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
        return
      }

      if (pendingOpToken) {
        pendingBootSendOpTokenRef.current = pendingOpToken
        pendingBootSendDispatchedAtRef.current = Date.now()
      } else {
        resetPendingBoot(true)
        sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
      }

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
      // Create/sync the optimistic thread on the server in the background so the list stays in sync.
      void ensureServerConversationForOptimistic(activeConvo)
    } catch {
      sessionStorage.removeItem(PENDING_CHAT_SESSION_KEY)
      resetPendingBoot(true)
    }
  }, [
    activeConvo,
    agentConnected,
    hasHudMessageAck,
    sendToAgent,
    handleSelectConvo,
    ensureServerConversationForOptimistic,
    resolveConversationIdForAgent,
    buildHudSessionKey,
  ])

  // Radix menus occasionally leave pointer-events: none on <body> after a route change; release it when no layer is open.
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
      if (!activeUserId) return
      const personalization = {
        nickname: settings.personalization.nickname,
        communicationStyle: settings.personalization.communicationStyle,
        tone: settings.personalization.tone,
        characteristics: settings.personalization.characteristics,
        customInstructions: settings.personalization.customInstructions,
      }
      if (gmailConnected && isEmailAssistantIntent(outboundContent)) {
        const maxResults = extractEmailSummaryMaxResults(outboundContent, 6)
        try {
          const response = await fetch("/api/integrations/gmail/summary", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ maxResults }),
          })
          const payload = (await response.json()) as GmailSummaryApiResponse
          if (!response.ok || !payload.ok) {
            const message =
              response.status === 401
                ? buildEmailAssistantFailureReply({ ...personalization, reason: "unauthorized" })
                : payload.error || buildEmailAssistantFailureReply({ ...personalization, reason: "temporary" })
            addAssistantMessage(message, { sender: settings.personalization.assistantName })
            return
          }
          const assistantReply = buildEmailAssistantReply({
            prompt: outboundContent,
            ...personalization,
            assistantName: settings.personalization.assistantName,
            summary: String(payload.summary || ""),
            emails: Array.isArray(payload.emails) ? payload.emails : [],
          })
          addAssistantMessage(assistantReply, { sender: settings.personalization.assistantName })
          return
        } catch {
          addAssistantMessage(buildEmailAssistantFailureReply({ ...personalization, reason: "temporary" }), {
            sender: settings.personalization.assistantName,
          })
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

  // URL contract: /chat?thread=<id>, /chat?new=1, /chat?new=1&prompt=<text>. Handled once per distinct query
  // (also while mounted), then the URL is cleaned so a reload does not repeat it.
  const handledIntentRef = useRef("")
  const threadParam = String(searchParams.get("thread") || "").trim()
  const newParam = searchParams.get("new") === "1"
  const promptParam = String(searchParams.get("prompt") || "").trim()
  useEffect(() => {
    if (!threadParam && !newParam) {
      handledIntentRef.current = ""
      return
    }
    if (!isSynced) return
    const intentKey = `${threadParam}|${newParam ? 1 : 0}|${promptParam}`
    if (handledIntentRef.current === intentKey) return
    handledIntentRef.current = intentKey
    if (threadParam) {
      void handleSelectConvo(threadParam)
    } else {
      handleNewChat()
      setPendingPrompt(promptParam)
    }
    window.history.replaceState(window.history.state, "", "/chat")
  }, [threadParam, newParam, promptParam, isSynced, handleSelectConvo, handleNewChat])

  // Send a ?prompt= once the fresh thread is active and the runtime is connected.
  useEffect(() => {
    if (!pendingPrompt || !agentConnected || !activeConvo || activeConvo.messages.length > 0) return
    setPendingPrompt("")
    void sendMessage(pendingPrompt)
  }, [pendingPrompt, activeConvo, agentConnected, sendMessage])

  const handleUseSuggestedWording = useCallback(
    async (message: Message) => {
      const suggested = String(message.nlpCleanText || "").trim()
      if (!suggested) return
      await sendMessage(suggested, { nlpBypass: true })
    },
    [sendMessage],
  )

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
      missionLabel: m.missionLabel,
    }))
    if (streamingAssistantId && !msgs.some((m) => m.id === streamingAssistantId)) {
      msgs.push({ id: streamingAssistantId, role: "assistant", content: "", createdAt: new Date() })
    }
    return msgs
  }, [activeConvo, streamingAssistantId])

  // Starters come only from integrations that are actually connected.
  const starters = useMemo<Starter[]>(() => {
    const list: Starter[] = []
    if (gmailConnected) list.push({ id: "gmail", prompt: "Summarize my latest emails", icon: <GmailIcon className="size-4" /> })
    if (gcalendarConnected) list.push({ id: "gcalendar", prompt: "What is on my calendar today?", icon: <GmailCalendarIcon className="size-4" /> })
    if (coinbaseConnected) list.push({ id: "coinbase", prompt: "How is my crypto portfolio doing?", icon: <CoinbaseIcon className="size-4" /> })
    if (braveConnected) list.push({ id: "brave", prompt: "Search the web for today's top tech news", icon: <BraveIcon className="size-4" /> })
    if (spotifyConnected) list.push({ id: "spotify", prompt: "Play something to focus to on Spotify", icon: <SpotifyIcon className="size-4" /> })
    return list.slice(0, 4)
  }, [gmailConnected, gcalendarConnected, coinbaseConnected, braveConnected, spotifyConnected])

  const rawTitle = String(activeConvo?.title || "").trim()
  const isUntitled = !rawTitle || rawTitle === DEFAULT_CONVERSATION_TITLE || (activeConvo?.messages.length ?? 0) === 0
  const activeTitle = isUntitled ? "New chat" : rawTitle

  const emptyState = (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <NovaMark className="mt-0.5" />
        <div>
          <h2 className="text-md font-medium text-fg">What should {assistantName} work on?</h2>
          <p className="mt-1 text-sm text-muted">
            Ask a question or hand over a task. {assistantName} can use your connected tools and will say when it needs your approval.
          </p>
        </div>
      </div>
      {starters.length > 0 ? (
        <ul aria-label="Suggestions from your connected integrations" className="ml-9 flex flex-col overflow-hidden rounded-lg border border-border">
          {starters.map((starter) => (
            <li key={starter.id} className="border-b border-subtle last:border-b-0">
              <button
                type="button"
                disabled={!agentConnected}
                onClick={() => void sendMessage(starter.prompt)}
                className="flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm text-muted transition-colors duration-150 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden className="flex size-4 items-center justify-center">{starter.icon}</span>
                {starter.prompt}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ml-9 text-xs text-muted">
          Connect Gmail, Calendar, Coinbase or web search in{" "}
          <Link href="/integrations" className="text-accent-text underline-offset-2 hover:underline">
            Integrations
          </Link>{" "}
          to give {assistantName} more to work with.
        </p>
      )}
    </div>
  )

  return (
    <PageContainer width="full" fill flush className="flex-row pb-0">
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvo?.id || null}
        isOpen={!threadsCollapsed}
        onSelect={(id) => void handleSelectConvo(id)}
        onNew={handleNewChat}
        onDelete={(id) => void handleDeleteConvo(id)}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        onCollapse={toggleThreads}
      />

      <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-subtle px-3">
          {threadsCollapsed ? (
            <Tooltip content="Show threads">
              <IconButton size="sm" aria-label="Show threads" onClick={toggleThreads}>
                <PanelLeftOpen />
              </IconButton>
            </Tooltip>
          ) : null}
          <h1 className={isUntitled ? "min-w-0 truncate text-sm text-muted" : "min-w-0 truncate text-sm font-medium text-fg"} title={activeTitle}>
            {activeTitle}
          </h1>
          {activeConvo && !isUntitled ? (
            <ThreadMenu
              convo={activeConvo}
              align="start"
              onRename={() => setRenaming(activeConvo)}
              onArchive={handleArchiveConvo}
              onPin={handlePinConvo}
              onDelete={() => setDeleting(activeConvo)}
            />
          ) : null}
        </header>
        <RenameThreadDialog
          convo={renaming}
          onCancel={() => setRenaming(null)}
          onRename={(id, title) => {
            setRenaming(null)
            handleRenameConvo(id, title)
          }}
        />
        <DeleteThreadDialog
          convo={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={(id) => {
            setDeleting(null)
            void handleDeleteConvo(id)
          }}
        />

        <MessageList
          messages={displayMessages}
          isStreaming={isThinking}
          streamingAssistantId={streamingAssistantId}
          thinkingStatus={thinkingStatus}
          isLoaded={isLoaded}
          assistantName={assistantName}
          modelByMessageId={modelByMessageId}
          emptyState={emptyState}
          onUseSuggestedWording={handleUseSuggestedWording}
        />

        <div className={`${CHAT_COLUMN_CLASS} shrink-0 pb-4`}>
          {!agentConnected ? (
            <div role="status" className="mb-2 flex items-start gap-2.5 rounded-lg border border-border bg-warning-muted px-3 py-2 text-sm">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-fg">
                The Nova runtime is not connected.{" "}
                <span className="text-muted">
                  {pendingPrompt
                    ? "Your message will send as soon as it reconnects."
                    : "Chat reconnects on its own once the runtime is running."}
                </span>
              </p>
            </div>
          ) : null}
          <Composer
            onSend={sendMessage}
            isStreaming={isThinking}
            onStop={interrupt}
            disabled={!agentConnected || !activeConvo}
            disabledReason={!agentConnected ? "Waiting for the runtime to connect" : "Loading thread"}
            isMuted={isMuted}
            onToggleMute={handleMuteToggle}
            muteHydrated={muteHydrated}
            modelId={activeLlmModel}
            autoFocus
          />
        </div>
      </section>
    </PageContainer>
  )
}
