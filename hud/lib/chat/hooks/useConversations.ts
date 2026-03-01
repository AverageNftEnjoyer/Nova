"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  type ChatMessage,
  type Conversation,
  getActiveId,
  loadConversations,
  resolveConversationTitle,
  saveConversations,
  setActiveId,
  DEFAULT_CONVERSATION_TITLE,
} from "@/lib/chat/conversations"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"
import {
  OPTIMISTIC_ID_REGEX,
  mergeConversationsPreferLocal,
  isLikelyOptimisticDuplicate,
  normalizeMessageComparableText,
  parseIsoTimestamp,
} from "@/lib/chat/hooks/use-conversations/shared"
import type { ChatTransportEvent } from "@/lib/chat/hooks/useNovaState"
import { useConversationActions } from "@/lib/chat/hooks/use-conversations/conversation-actions"

export interface UseConversationsOptions {
  agentConnected: boolean
  chatTransportEvents: ChatTransportEvent[]
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

function shouldPreferIncomingAssistantVersion(base: string, incoming: string): boolean {
  const left = normalizeMessageComparableText(base)
  const right = normalizeMessageComparableText(incoming)
  if (!left || !right) return false
  if (left === right) return true

  const leftCompact = left.replace(/[^a-z0-9]+/g, "")
  const rightCompact = right.replace(/[^a-z0-9]+/g, "")
  if (!leftCompact || !rightCompact) return false
  if (rightCompact.includes(leftCompact)) return true
  if (leftCompact.includes(rightCompact)) return false

  const leftWords = new Set(left.split(/\s+/g).filter(Boolean))
  const rightWords = new Set(right.split(/\s+/g).filter(Boolean))
  if (leftWords.size < 8 || rightWords.size < 8) return false
  let overlap = 0
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1
  }
  const smaller = Math.min(leftWords.size, rightWords.size)
  const overlapRatio = smaller > 0 ? overlap / smaller : 0
  const lenRatio = Math.min(leftCompact.length, rightCompact.length) / Math.max(leftCompact.length, rightCompact.length)
  return overlapRatio >= 0.82 && lenRatio >= 0.62
}

function mergeAssistantStreamContent(base: string, incoming: string): string {
  const left = String(base || "")
  const right = String(incoming || "")
  if (!right) return left
  if (!left) return right
  if (shouldPreferIncomingAssistantVersion(left, right)) {
    return right.length >= left.length ? right : left
  }
  if (right.length >= left.length && right.startsWith(left)) return right
  if (left.length >= right.length && left.startsWith(right)) return left
  if (left.endsWith(right)) return left
  if (right.endsWith(left)) return right
  return `${left}${right}`
}

function resolveTransportSource(value: unknown): "agent" | "hud" | "voice" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "hud") return "hud"
  if (normalized === "voice") return "voice"
  return "agent"
}

export function useConversations({
  agentConnected,
  chatTransportEvents,
  clearAgentMessages,
}: UseConversationsOptions): UseConversationsReturn {
  const router = useRouter()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  const mergedCountRef = useRef(0)
  const processedTransportSeqRef = useRef(0)
  const activeUserIdRef = useRef("")
  const missionInFlightByScopeRef = useRef<Map<string, { signature: string; startedAt: number; cooldownUntil: number }>>(new Map())
  const optimisticIdToServerIdRef = useRef<Map<string, string>>(new Map())
  const sessionConversationIdByConversationIdRef = useRef<Map<string, string>>(new Map())
  const optimisticEnsureInFlightRef = useRef<Set<string>>(new Set())
  const latestConversationsRef = useRef<Conversation[]>([])
  const latestActiveConvoIdRef = useRef<string>("")
  const threadsFetchInFlightRef = useRef<Promise<Conversation[]> | null>(null)
  const threadsFetchCacheRef = useRef<Conversation[] | null>(null)
  const threadsFetchLastAtRef = useRef(0)

  useEffect(() => {
    latestConversationsRef.current = conversations
    latestActiveConvoIdRef.current = String(activeConvo?.id || "").trim()
  }, [conversations, activeConvo])

  useEffect(() => {
    const updateActiveUser = () => {
      const nextUserId = String(getActiveUserId() || "").trim()
      if (activeUserIdRef.current === nextUserId) return
      activeUserIdRef.current = nextUserId
    }
    updateActiveUser()
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, updateActiveUser as EventListener)
    return () => {
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, updateActiveUser as EventListener)
    }
  }, [])

  const fetchConversationsFromServer = useCallback(async (): Promise<Conversation[]> => {
    const nowMs = Date.now()
    if (threadsFetchInFlightRef.current) return threadsFetchInFlightRef.current
    if (threadsFetchCacheRef.current && nowMs - threadsFetchLastAtRef.current < 1_500) {
      return threadsFetchCacheRef.current
    }
    const request = (async () => {
      const res = await fetch("/api/threads", { cache: "no-store" })
      const data = await res.json().catch(() => ({})) as { conversations?: Conversation[] }
      if (!res.ok) throw new Error("Failed to load conversations.")
      const convos = Array.isArray(data.conversations) ? data.conversations : []
      threadsFetchCacheRef.current = convos
      threadsFetchLastAtRef.current = Date.now()
      return convos
    })()
    threadsFetchInFlightRef.current = request
    try {
      return await request
    } finally {
      threadsFetchInFlightRef.current = null
    }
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

  const persist = useCallback(
    (convos: Conversation[], active: Conversation | null) => {
      setConversations(convos)
      saveConversations(convos)
      writeShellUiCache({ conversations: convos })
      if (active) {
        setActiveConvo(active)
        setActiveId(active.id)
      }
      if (!active) {
        setActiveConvo(null)
        setActiveId(null)
      }
    },
    [],
  )

  const resolveTransportConversationId = useCallback(
    (rawConversationId: string, source: string, role: "user" | "assistant", pool: Conversation[]): string => {
      const activeConversationId = String(latestActiveConvoIdRef.current || "").trim()
      const availableIds = new Set(pool.map((entry) => String(entry.id || "").trim()))
      const normalized = String(rawConversationId || "").trim()
      if (normalized) {
        const candidates: string[] = [normalized]
        const mappedServerId = optimisticIdToServerIdRef.current.get(normalized)
        if (mappedServerId && !candidates.includes(mappedServerId)) candidates.push(mappedServerId)
        for (const [optimisticId, serverId] of optimisticIdToServerIdRef.current.entries()) {
          if (serverId !== normalized) continue
          if (!candidates.includes(optimisticId)) candidates.push(optimisticId)
        }
        if (activeConversationId && candidates.includes(activeConversationId) && availableIds.has(activeConversationId)) {
          return activeConversationId
        }
        for (const candidate of candidates) {
          if (availableIds.has(candidate)) return candidate
        }
      }

      if (!activeConversationId || !availableIds.has(activeConversationId)) return ""
      if (role === "assistant") {
        // Enforce strict thread isolation: assistant events must include conversationId.
        // Falling back to the active thread can leak output into the wrong session.
        return ""
      }
      if (source === "hud") return activeConversationId
      return ""
    },
    [],
  )

  const applyTransportEventToConversation = useCallback(
    (convo: Conversation, event: ChatTransportEvent, allConversations: Conversation[]) => {
      let nextMessages = convo.messages
      let changed = false
      let titleChanged = false
      let shouldSync = false
      const eventTsIso = new Date(Number(event.ts || Date.now())).toISOString()

      const updateConversation = () => {
        if (!changed) return convo
        const nextTitle = titleChanged
          ? resolveConversationTitle({
              messages: nextMessages,
              currentTitle: convo.title,
              conversations: allConversations,
              conversationId: convo.id,
            })
          : convo.title
        return {
          ...convo,
          messages: nextMessages,
          updatedAt: eventTsIso,
          title: nextTitle,
        }
      }

      if (event.type === "message") {
        const normalizedContent = String(event.content || "").trim()
        if (!normalizedContent) return { conversation: convo, changed, shouldSync, titleChanged }
        const source = String(event.source || "").trim().toLowerCase()
        const sender = String(event.sender || "").trim().toLowerCase()
        if (source === "hud" || sender === "hud-user") {
          return { conversation: convo, changed, shouldSync, titleChanged }
        }
        const existsById = convo.messages.some((msg) => String(msg.id || "").trim() === String(event.id || "").trim())
        const comparableContent = normalizeMessageComparableText(normalizedContent)
        const eventTs = Number(event.ts || 0)
        const existsBySemanticWindow = comparableContent
          ? convo.messages.some((msg) => {
              if (msg.role !== "user") return false
              if (normalizeMessageComparableText(String(msg.content || "")) !== comparableContent) return false
              if (eventTs <= 0) return false
              return Math.abs(parseIsoTimestamp(msg.createdAt) - eventTs) <= 2_000
            })
          : false
        if (!existsById && !existsBySemanticWindow) {
          const nextUserMessage: ChatMessage = {
            id: String(event.id || "").trim() || `evt-${event.seq}`,
            role: "user",
            content: normalizedContent,
            createdAt: eventTsIso,
            source: resolveTransportSource(event.source),
            sender: event.sender,
            ...(event.nlpCleanText ? { nlpCleanText: event.nlpCleanText } : {}),
            ...(typeof event.nlpConfidence === "number" ? { nlpConfidence: event.nlpConfidence } : {}),
            ...(typeof event.nlpCorrectionCount === "number" ? { nlpCorrectionCount: event.nlpCorrectionCount } : {}),
            ...(event.nlpBypass ? { nlpBypass: true } : {}),
          }
          nextMessages = [...convo.messages, nextUserMessage]
          changed = true
          titleChanged = true
          shouldSync = true
        }
        return { conversation: updateConversation(), changed, shouldSync, titleChanged }
      }

      const assistantId = String(event.id || "").trim()
      if (!assistantId) return { conversation: convo, changed, shouldSync, titleChanged }
      const existingIdx = convo.messages.findIndex((msg) => msg.role === "assistant" && String(msg.id || "").trim() === assistantId)

      if (event.type === "assistant_stream_start") {
        if (existingIdx === -1) {
          const nextAssistantMessage: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: eventTsIso,
            source: resolveTransportSource(event.source),
            sender: event.sender,
          }
          nextMessages = [...convo.messages, nextAssistantMessage]
          changed = true
        }
        return { conversation: updateConversation(), changed, shouldSync, titleChanged }
      }

      if (event.type === "assistant_stream_delta") {
        const deltaContent = String(event.content || "")
        if (!deltaContent) return { conversation: convo, changed, shouldSync, titleChanged }
        if (existingIdx === -1) {
          const nextAssistantMessage: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: deltaContent,
            createdAt: eventTsIso,
            source: resolveTransportSource(event.source),
            sender: event.sender,
          }
          nextMessages = [...convo.messages, nextAssistantMessage]
          changed = true
          return { conversation: updateConversation(), changed, shouldSync, titleChanged }
        }
        const existing = convo.messages[existingIdx]
        const mergedContent = mergeAssistantStreamContent(existing.content, deltaContent)
        if (mergedContent !== existing.content) {
          const next = [...convo.messages]
          next[existingIdx] = {
            ...existing,
            content: mergedContent,
            source: resolveTransportSource(event.source),
            sender: event.sender || existing.sender,
            createdAt: parseIsoTimestamp(existing.createdAt) >= Number(event.ts || 0) ? existing.createdAt : eventTsIso,
          }
          nextMessages = next
          changed = true
        }
        return { conversation: updateConversation(), changed, shouldSync, titleChanged }
      }

      if (event.type === "assistant_stream_done") {
        shouldSync = true
        return { conversation: updateConversation(), changed, shouldSync, titleChanged }
      }

      return { conversation: convo, changed, shouldSync, titleChanged }
    },
    [],
  )

  useLayoutEffect(() => {
    const cachedConversations = readShellUiCache().conversations ?? loadConversations()
    if (cachedConversations.length === 0) {
      queueMicrotask(() => setIsLoaded(true))
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
  }, [])

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
  }, [createServerConversation, fetchConversationsFromServer, reconcileOptimisticConversationMappings, resolveConversationSelectionId])

  useEffect(() => {
    if (chatTransportEvents.length === 0) {
      processedTransportSeqRef.current = 0
      mergedCountRef.current = 0
      return
    }
    const latestSeq = chatTransportEvents[chatTransportEvents.length - 1]?.seq ?? 0
    if (latestSeq < processedTransportSeqRef.current) {
      processedTransportSeqRef.current = 0
    }
    const pending = chatTransportEvents.filter((event) => event.seq > processedTransportSeqRef.current)
    if (pending.length === 0) return
    processedTransportSeqRef.current = pending[pending.length - 1].seq
    mergedCountRef.current = processedTransportSeqRef.current

    const baseConversations = latestConversationsRef.current
    if (baseConversations.length === 0) return

    let nextConversations = baseConversations
    let conversationsChanged = false
    const changedById = new Map<string, Conversation>()
    const syncConversationIds = new Set<string>()
    const titledConversationIds = new Set<string>()

    for (const event of pending) {
      const targetConversationId = resolveTransportConversationId(
        typeof event.conversationId === "string" ? event.conversationId : "",
        typeof event.source === "string" ? event.source : "",
        event.type === "message" ? "user" : "assistant",
        nextConversations,
      )
      if (!targetConversationId) continue
      const convoIndex = nextConversations.findIndex((entry) => entry.id === targetConversationId)
      if (convoIndex < 0) continue
      const currentConversation = nextConversations[convoIndex]
      const outcome = applyTransportEventToConversation(currentConversation, event, nextConversations)
      if (outcome.shouldSync) syncConversationIds.add(targetConversationId)
      if (!outcome.changed) continue

      if (!conversationsChanged) {
        nextConversations = [...nextConversations]
        conversationsChanged = true
      }
      nextConversations[convoIndex] = outcome.conversation
      changedById.set(targetConversationId, outcome.conversation)
      if (outcome.titleChanged) titledConversationIds.add(targetConversationId)
    }

    if (conversationsChanged) {
      const nextActiveId = String(latestActiveConvoIdRef.current || "").trim()
      const nextActive = nextActiveId ? nextConversations.find((entry) => entry.id === nextActiveId) ?? null : null
      persist(nextConversations, nextActive)
    }

    if (titledConversationIds.size > 0) {
      for (const convoId of titledConversationIds) {
        const previous = baseConversations.find((entry) => entry.id === convoId)
        const next = changedById.get(convoId) || nextConversations.find((entry) => entry.id === convoId)
        if (!previous || !next || next.title === previous.title) continue
        void patchServerConversation(convoId, { title: next.title }).catch(() => {})
      }
    }

    if (syncConversationIds.size > 0) {
      for (const convoId of syncConversationIds) {
        const convo = changedById.get(convoId) || nextConversations.find((entry) => entry.id === convoId)
        if (!convo) continue
        void syncServerMessages(convo).catch(() => {})
      }
    }
  }, [
    applyTransportEventToConversation,
    chatTransportEvents,
    mergedCountRef,
    patchServerConversation,
    persist,
    resolveTransportConversationId,
    syncServerMessages,
  ])

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
      mode: "idle",
      message: "",
      retryInSeconds: 0,
    },
  }
}
