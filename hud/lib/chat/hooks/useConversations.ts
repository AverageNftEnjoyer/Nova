"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  type Conversation,
  getActiveId,
  loadConversations,
  saveConversations,
  setActiveId,
  DEFAULT_CONVERSATION_TITLE,
} from "@/lib/chat/conversations"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"
import { computeBackoffDelayMs, defaultPollIntervalMs } from "@/lib/novachat/polling-resilience"
import {
  OPTIMISTIC_ID_REGEX,
  mergeConversationsPreferLocal,
  isLikelyOptimisticDuplicate,
  type IncomingAgentMessage,
} from "@/lib/chat/hooks/use-conversations/shared"
import { usePendingNovaChatPolling } from "@/lib/chat/hooks/use-conversations/pending-poll"
import { useAgentMessageMerge } from "@/lib/chat/hooks/use-conversations/agent-merge"
import { useConversationActions } from "@/lib/chat/hooks/use-conversations/conversation-actions"

export interface UseConversationsOptions {
  agentConnected: boolean
  agentMessages: IncomingAgentMessage[]
  clearAgentMessages: () => void
}

export interface UseConversationsReturn {
  conversations: Conversation[]
  activeConvo: Conversation | null
  isLoaded: boolean
  mergedCountRef: React.MutableRefObject<number>
  sendMessage: (
    content: string,
    sendToAgent: (
      content: string,
      voiceEnabled: boolean,
      ttsVoice: string,
      meta: Record<string, unknown>,
    ) => void,
  ) => Promise<void>
  handleNewChat: () => void
  handleSelectConvo: (id: string) => Promise<void>
  handleDeleteConvo: (id: string) => Promise<void>
  handleRenameConvo: (id: string, title: string) => void
  handleArchiveConvo: (id: string, archived: boolean) => void
  handlePinConvo: (id: string, pinned: boolean) => void
  addUserMessage: (
    content: string,
    options?: {
      sessionConversationId?: string
      sessionKey?: string
    },
  ) => Conversation | null
  addAssistantMessage: (content: string, options?: { sender?: string }) => Conversation | null
  ensureServerConversationForOptimistic: (convo: Conversation) => Promise<void>
  resolveConversationIdForAgent: (conversationId: string) => string
  resolveSessionConversationIdForAgent: (conversationId: string) => string
  pendingQueueStatus: {
    mode: "idle" | "processing" | "retrying"
    message: string
    retryInSeconds: number
  }
}

export function useConversations({
  agentConnected,
  agentMessages,
  clearAgentMessages,
}: UseConversationsOptions): UseConversationsReturn {
  const router = useRouter()
  const searchParams = useSearchParams()
  const shouldOpenPendingNovaChat = searchParams.get("open") === "novachat"

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [retryNowMs, setRetryNowMs] = useState(0)

  const mergedCountRef = useRef(0)
  const syncTimersRef = useRef<Map<string, number>>(new Map())
  const activeUserIdRef = useRef("")
  const [activeUserScopeVersion, setActiveUserScopeVersion] = useState(0)
  const missionInFlightByScopeRef = useRef<Map<string, { signature: string; startedAt: number; cooldownUntil: number }>>(new Map())
  const processedAgentMessageKeysRef = useRef<Set<string>>(new Set())
  const optimisticIdToServerIdRef = useRef<Map<string, string>>(new Map())
  const sessionConversationIdByConversationIdRef = useRef<Map<string, string>>(new Map())
  const optimisticEnsureInFlightRef = useRef<Set<string>>(new Set())
  const latestConversationsRef = useRef<Conversation[]>([])
  const latestActiveConvoIdRef = useRef<string>("")

  useEffect(() => {
    latestConversationsRef.current = conversations
    latestActiveConvoIdRef.current = String(activeConvo?.id || "").trim()
  }, [conversations, activeConvo])

  useEffect(() => {
    const updateActiveUser = () => {
      const nextUserId = String(getActiveUserId() || "").trim()
      if (activeUserIdRef.current === nextUserId) return
      activeUserIdRef.current = nextUserId
      setActiveUserScopeVersion((prev) => prev + 1)
    }
    updateActiveUser()
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, updateActiveUser as EventListener)
    return () => {
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, updateActiveUser as EventListener)
    }
  }, [])

  const fetchConversationsFromServer = useCallback(async (): Promise<Conversation[]> => {
    const res = await fetch("/api/threads", { cache: "no-store" })
    const data = await res.json().catch(() => ({})) as { conversations?: Conversation[] }
    if (!res.ok) throw new Error("Failed to load conversations.")
    return Array.isArray(data.conversations) ? data.conversations : []
  }, [])

  const createServerConversation = useCallback(async (title?: string): Promise<Conversation> => {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: (title && String(title).trim()) || DEFAULT_CONVERSATION_TITLE }),
    })
    const data = await res.json().catch(() => ({})) as { conversation?: Conversation; error?: string }
    if (!res.ok || !data.conversation) throw new Error(data.error || "Failed to create conversation.")
    return data.conversation
  }, [])

  const patchServerConversation = useCallback(async (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error("Failed to update conversation.")
  }, [])

  const deleteServerConversation = useCallback(async (id: string) => {
    const normalized = String(id || "").trim()
    if (!normalized) return
    const mappedServerId = optimisticIdToServerIdRef.current.get(normalized)
    const targetId = mappedServerId || normalized
    if (OPTIMISTIC_ID_REGEX.test(targetId)) return

    const res = await fetch(`/api/threads/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    })
    if (!res.ok) throw new Error("Failed to delete conversation.")
  }, [])

  const syncServerMessages = useCallback(async (convo: Conversation): Promise<boolean> => {
    const mappedId = optimisticIdToServerIdRef.current.get(convo.id)
    const targetId = mappedId || convo.id
    if (OPTIMISTIC_ID_REGEX.test(targetId)) return false

    const res = await fetch(`/api/threads/${encodeURIComponent(targetId)}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: convo.messages }),
    })
    return res.ok
  }, [])

  const resolveConversationIdForAgent = useCallback((conversationId: string): string => {
    const normalized = String(conversationId || "").trim()
    if (!normalized) return ""
    return optimisticIdToServerIdRef.current.get(normalized) || normalized
  }, [])

  const resolveSessionConversationIdForAgent = useCallback((conversationId: string): string => {
    const normalized = String(conversationId || "").trim()
    if (!normalized) return ""
    return sessionConversationIdByConversationIdRef.current.get(normalized) || normalized
  }, [])

  const reconcileOptimisticConversationMappings = useCallback(
    (localConvos: Conversation[], remoteConvos: Conversation[]) => {
      if (!Array.isArray(localConvos) || !Array.isArray(remoteConvos)) return
      if (localConvos.length === 0 || remoteConvos.length === 0) return

      const optimisticMap = optimisticIdToServerIdRef.current
      const sessionMap = sessionConversationIdByConversationIdRef.current

      for (const localConvo of localConvos) {
        const localId = String(localConvo?.id || "").trim()
        if (!OPTIMISTIC_ID_REGEX.test(localId)) continue

        const existingServerId = optimisticMap.get(localId)
        if (existingServerId) {
          const canonicalSessionId = sessionMap.get(localId) || localId
          sessionMap.set(localId, canonicalSessionId)
          sessionMap.set(existingServerId, canonicalSessionId)
          continue
        }

        const matchedServerConvo = remoteConvos.find((remoteConvo) =>
          isLikelyOptimisticDuplicate(localConvo, remoteConvo),
        )
        if (!matchedServerConvo) continue

        optimisticMap.set(localId, matchedServerConvo.id)
        const canonicalSessionId = sessionMap.get(localId) || localId
        sessionMap.set(localId, canonicalSessionId)
        sessionMap.set(matchedServerConvo.id, canonicalSessionId)
      }
    },
    [],
  )

  const resolveConversationSelectionId = useCallback(
    (conversationId: string, availableConversations?: Conversation[]): string => {
      const pool = availableConversations ?? latestConversationsRef.current
      const normalized = String(conversationId || "").trim()
      if (!normalized) return ""

      const availableIds = new Set(pool.map((entry) => String(entry.id || "").trim()))
      if (availableIds.has(normalized)) return normalized

      const mappedServerId = optimisticIdToServerIdRef.current.get(normalized)
      if (mappedServerId && availableIds.has(mappedServerId)) return mappedServerId

      for (const [optimisticId, serverId] of optimisticIdToServerIdRef.current.entries()) {
        if (serverId === normalized && availableIds.has(optimisticId)) return optimisticId
      }

      return mappedServerId || normalized
    },
    [],
  )

  const scheduleServerSync = useCallback((convo: Conversation) => {
    const existing = syncTimersRef.current.get(convo.id)
    if (typeof existing === "number") {
      window.clearTimeout(existing)
    }
    const scheduledConvoId = convo.id
    const timer = window.setTimeout(() => {
      syncTimersRef.current.delete(scheduledConvoId)
      const mappedId = optimisticIdToServerIdRef.current.get(scheduledConvoId)
      const latestConversations = latestConversationsRef.current
      const latestMapped = mappedId
        ? latestConversations.find((entry) => entry.id === mappedId)
        : null
      const latestByOriginal = latestConversations.find((entry) => entry.id === scheduledConvoId)
      const latestToSync = latestMapped || latestByOriginal || convo

      if (mappedId && OPTIMISTIC_ID_REGEX.test(scheduledConvoId) && !latestMapped && !latestByOriginal) {
        return
      }

      void syncServerMessages(latestToSync).catch(() => {})
    }, 280)
    syncTimersRef.current.set(convo.id, timer)
  }, [syncServerMessages])

  const persist = useCallback(
    (convos: Conversation[], active: Conversation | null) => {
      setConversations(convos)
      saveConversations(convos)
      writeShellUiCache({ conversations: convos })
      if (active) {
        setActiveConvo(active)
        setActiveId(active.id)
        scheduleServerSync(active)
      }
      if (!active) {
        setActiveConvo(null)
        setActiveId(null)
      }
    },
    [scheduleServerSync],
  )

  useLayoutEffect(() => {
    const cachedConversations = readShellUiCache().conversations ?? loadConversations()
    if (cachedConversations.length === 0) {
      queueMicrotask(() => setIsLoaded(true))
      return
    }
    if (shouldOpenPendingNovaChat) {
      const activeId = getActiveId()
      const activeFromCache =
        (activeId ? cachedConversations.find((c) => c.id === activeId) : null) ?? cachedConversations[0]
      queueMicrotask(() => {
        setConversations(cachedConversations)
        setActiveConvo(activeFromCache || null)
        if (activeFromCache) setActiveId(activeFromCache.id)
        setIsLoaded(true)
      })
      return
    }
    const activeId = getActiveId()
    const activeFromCache =
      (activeId ? cachedConversations.find((c) => c.id === activeId) : null) ?? cachedConversations[0]
    queueMicrotask(() => {
      setConversations(cachedConversations)
      setActiveConvo(activeFromCache || null)
      if (activeFromCache) setActiveId(activeFromCache.id)
      setIsLoaded(true)
    })
  }, [shouldOpenPendingNovaChat])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const convos = await fetchConversationsFromServer()
        if (cancelled) return
        const localSnapshot = readShellUiCache().conversations ?? loadConversations()
        reconcileOptimisticConversationMappings(localSnapshot, convos)
        const mergedConvos = mergeConversationsPreferLocal(localSnapshot, convos, optimisticIdToServerIdRef.current)
        const activeId = getActiveId()
        const selectedActiveId = resolveConversationSelectionId(activeId || "", mergedConvos)
        const found = mergedConvos.find((c) => c.id === selectedActiveId)
        if (shouldOpenPendingNovaChat) {
          const fallbackActiveId = getActiveId()
          const fallbackActive =
            (fallbackActiveId ? mergedConvos.find((c) => c.id === fallbackActiveId) : null) ?? mergedConvos[0] ?? null
          setConversations(mergedConvos)
          saveConversations(mergedConvos)
          writeShellUiCache({ conversations: mergedConvos })
          setActiveConvo(fallbackActive)
          if (fallbackActive) setActiveId(fallbackActive.id)
          setIsLoaded(true)
          return
        }
        if (found) {
          setConversations(mergedConvos)
          saveConversations(mergedConvos)
          writeShellUiCache({ conversations: mergedConvos })
          setActiveConvo(found)
          if (selectedActiveId && activeId !== selectedActiveId) {
            setActiveId(selectedActiveId)
          }
          setIsLoaded(true)
          return
        }
        if (mergedConvos.length > 0) {
          setConversations(mergedConvos)
          saveConversations(mergedConvos)
          writeShellUiCache({ conversations: mergedConvos })
          setActiveConvo(mergedConvos[0])
          setActiveId(mergedConvos[0].id)
          setIsLoaded(true)
          return
        }
        const fresh = await createServerConversation()
        if (cancelled) return
        setConversations([fresh])
        saveConversations([fresh])
        writeShellUiCache({ conversations: [fresh] })
        setActiveConvo(fresh)
        setActiveId(fresh.id)
        setIsLoaded(true)
      } catch {
        if (cancelled) return
        const fallback = readShellUiCache().conversations ?? loadConversations()
        if (fallback.length > 0) {
          const activeId = getActiveId()
          const found = fallback.find((c) => c.id === activeId) ?? fallback[0]
          setConversations(fallback)
          setActiveConvo(found)
          setActiveId(found.id)
        } else {
          setConversations([])
          setActiveConvo(null)
        }
        setIsLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [createServerConversation, fetchConversationsFromServer, reconcileOptimisticConversationMappings, resolveConversationSelectionId, shouldOpenPendingNovaChat])

  const { pendingQueueStatus, processPendingNovaChatMessages, pendingRedirectTimerRef, pendingPollBackoffAttemptsRef } = usePendingNovaChatPolling({
    isLoaded,
    shouldOpenPendingNovaChat,
    activeUserScopeVersion,
    activeUserIdRef,
    latestConversationsRef,
    createServerConversation,
    syncServerMessages,
    persist,
  })

  useEffect(() => {
    let resetTimer: number | null = null
    let tickTimer: number | null = null

    if (pendingQueueStatus.mode !== "retrying") {
      resetTimer = window.setTimeout(() => {
        setRetryNowMs(0)
      }, 0)
      return
    }

    resetTimer = window.setTimeout(() => {
      setRetryNowMs(Date.now())
    }, 0)
    tickTimer = window.setInterval(() => {
      setRetryNowMs(Date.now())
    }, 1000)

    return () => {
      if (resetTimer !== null) window.clearTimeout(resetTimer)
      if (tickTimer !== null) window.clearInterval(tickTimer)
    }
  }, [pendingQueueStatus.mode, pendingQueueStatus.retryAtMs])

  useEffect(() => {
    if (!isLoaded) return
    if (!shouldOpenPendingNovaChat) return
    let attempts = 0
    let cancelled = false
    const maxAttempts = 20
    const scheduleNext = (delayMs: number) => {
      if (cancelled) return
      if (pendingRedirectTimerRef.current !== null) window.clearTimeout(pendingRedirectTimerRef.current)
      pendingRedirectTimerRef.current = window.setTimeout(() => {
        pendingRedirectTimerRef.current = null
        void runPoll()
      }, delayMs)
    }
    const runPoll = async () => {
      if (cancelled) return
      const consumed = await processPendingNovaChatMessages()
      if (cancelled) return
      if (consumed > 0 || attempts >= maxAttempts) {
        router.replace("/chat")
        return
      }
      attempts += 1
      const delayMs = computeBackoffDelayMs({
        attempt: pendingPollBackoffAttemptsRef.current,
        baseMs: defaultPollIntervalMs(),
      })
      scheduleNext(Math.max(defaultPollIntervalMs(), delayMs))
    }
    void runPoll()
    return () => {
      cancelled = true
      if (pendingRedirectTimerRef.current !== null) {
        window.clearTimeout(pendingRedirectTimerRef.current)
        pendingRedirectTimerRef.current = null
      }
    }
  }, [isLoaded, pendingPollBackoffAttemptsRef, pendingRedirectTimerRef, processPendingNovaChatMessages, router, shouldOpenPendingNovaChat])

  useAgentMessageMerge({
    agentMessages,
    activeConvo,
    conversations,
    activeUserIdRef,
    latestConversationsRef,
    optimisticIdToServerIdRef,
    missionInFlightByScopeRef,
    processedAgentMessageKeysRef,
    mergedCountRef,
    persist,
    scheduleServerSync,
    patchServerConversation,
    resolveSessionConversationIdForAgent,
  })

  useEffect(() => {
    const syncTimers = syncTimersRef.current
    return () => {
      for (const timer of syncTimers.values()) {
        window.clearTimeout(timer)
      }
      syncTimers.clear()
    }
  }, [])

  const {
    handleNewChat,
    handleSelectConvo,
    handleDeleteConvo,
    handleRenameConvo,
    handleArchiveConvo,
    handlePinConvo,
    addUserMessage,
    addAssistantMessage,
    ensureServerConversationForOptimistic,
    sendMessage,
  } = useConversationActions({
    router,
    conversations,
    activeConvo,
    agentConnected,
    clearAgentMessages,
    createServerConversation,
    deleteServerConversation,
    fetchConversationsFromServer,
    reconcileOptimisticConversationMappings,
    resolveConversationSelectionId,
    patchServerConversation,
    persist,
    syncServerMessages,
    resolveConversationIdForAgent,
    resolveSessionConversationIdForAgent,
    optimisticIdToServerIdRef,
    sessionConversationIdByConversationIdRef,
    optimisticEnsureInFlightRef,
    latestConversationsRef,
    latestActiveConvoIdRef,
    missionInFlightByScopeRef,
    mergedCountRef,
    processedAgentMessageKeysRef,
  })

  return {
    conversations,
    activeConvo,
    isLoaded,
    mergedCountRef,
    sendMessage,
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
    pendingQueueStatus: {
      mode: pendingQueueStatus.mode,
      message: pendingQueueStatus.message,
      retryInSeconds:
        pendingQueueStatus.mode === "retrying"
          ? Math.max(1, Math.ceil((pendingQueueStatus.retryAtMs - retryNowMs) / 1000))
          : 0,
    },
  }
}
