import { useCallback, useEffect, type MutableRefObject } from "react"
import { getActiveUserId } from "@/lib/auth/active-user"
import type { ChatMessage, Conversation } from "@/lib/chat/conversations"
import { generateId, resolveConversationTitle } from "@/lib/chat/conversations"
import {
  mergeConversationsPreferLocal,
  buildMissionScopeKey,
  isLikelyMissionPrompt,
  normalizeMissionPromptSignature,
  parseIsoTimestamp,
  MISSION_INFLIGHT_MAX_MS,
  MISSION_SPAM_COOLDOWN_MS,
  OPTIMISTIC_ID_REGEX,
} from "./shared"

export function useConversationActions(params: {
  router: { push: (href: string) => void }
  conversations: Conversation[]
  activeConvo: Conversation | null
  agentConnected: boolean
  clearAgentMessages: () => void
  createServerConversation: (title?: string) => Promise<Conversation>
  deleteServerConversation: (id: string) => Promise<void>
  fetchConversationsFromServer: () => Promise<Conversation[]>
  reconcileOptimisticConversationMappings: (localConvos: Conversation[], remoteConvos: Conversation[]) => void
  resolveConversationSelectionId: (conversationId: string, availableConversations?: Conversation[]) => string
  patchServerConversation: (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => Promise<void>
  persist: (convos: Conversation[], active: Conversation | null) => void
  syncServerMessages: (convo: Conversation) => Promise<boolean>
  resolveConversationIdForAgent: (conversationId: string) => string
  resolveSessionConversationIdForAgent: (conversationId: string) => string
  optimisticIdToServerIdRef: MutableRefObject<Map<string, string>>
  sessionConversationIdByConversationIdRef: MutableRefObject<Map<string, string>>
  optimisticEnsureInFlightRef: MutableRefObject<Set<string>>
  latestConversationsRef: MutableRefObject<Conversation[]>
  latestActiveConvoIdRef: MutableRefObject<string>
  missionInFlightByScopeRef: MutableRefObject<Map<string, { signature: string; startedAt: number; cooldownUntil: number }>>
  mergedCountRef: MutableRefObject<number>
  processedAgentMessageKeysRef: MutableRefObject<Set<string>>
}) {
  const {
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
  } = params

  const handleNewChat = useCallback(() => {
    router.push("/home")
  }, [router])

  const handleSelectConvo = useCallback(
    async (id: string) => {
      let nextConversations = conversations
      const selectedLocalId = resolveConversationSelectionId(id, conversations)
      let found = conversations.find((c) => c.id === selectedLocalId)
      if (!found) {
        const remote = await fetchConversationsFromServer().catch(() => [])
        if (remote.length > 0) {
          reconcileOptimisticConversationMappings(conversations, remote)
          const merged = mergeConversationsPreferLocal(conversations, remote, optimisticIdToServerIdRef.current)
          nextConversations = merged
          const selectedRemoteId = resolveConversationSelectionId(id, merged)
          found = merged.find((c) => c.id === selectedRemoteId)
        }
      }
      if (found) {
        persist(nextConversations, found)
      }
    },
    [conversations, fetchConversationsFromServer, persist, reconcileOptimisticConversationMappings, resolveConversationSelectionId, optimisticIdToServerIdRef],
  )

  const handleDeleteConvo = useCallback(
    async (id: string) => {
      const normalizedId = String(id || "").trim()
      if (!normalizedId) return
      const mappedServerId = optimisticIdToServerIdRef.current.get(normalizedId) || ""
      const requiresServerDelete = !OPTIMISTIC_ID_REGEX.test(mappedServerId || normalizedId)
      if (requiresServerDelete) {
        try {
          await deleteServerConversation(normalizedId)
        } catch {
          return
        }
      }
      const remaining = conversations.filter((c) => c.id !== normalizedId)

      if (activeConvo?.id === normalizedId) {
        clearAgentMessages()
        mergedCountRef.current = 0
        processedAgentMessageKeysRef.current.clear()

        if (remaining.length > 0) {
          persist(remaining, remaining[0])
        } else {
          const fresh = await createServerConversation().catch(() => null)
          if (!fresh) {
            persist([], null)
            return
          }
          persist([fresh], fresh)
        }
      } else {
        persist(remaining, activeConvo)
      }
      const optimisticMap = optimisticIdToServerIdRef.current
      const sessionMap = sessionConversationIdByConversationIdRef.current
      const linkedIds = new Set<string>([normalizedId])
      if (mappedServerId) linkedIds.add(mappedServerId)
      for (const [optimisticId, serverId] of optimisticMap.entries()) {
        if (
          optimisticId === normalizedId
          || serverId === normalizedId
          || (mappedServerId && serverId === mappedServerId)
        ) {
          linkedIds.add(optimisticId)
          linkedIds.add(serverId)
          optimisticMap.delete(optimisticId)
        }
      }
      for (const linkedId of linkedIds) {
        sessionMap.delete(linkedId)
      }
    },
    [conversations, activeConvo, clearAgentMessages, createServerConversation, deleteServerConversation, mergedCountRef, persist, processedAgentMessageKeysRef, optimisticIdToServerIdRef, sessionConversationIdByConversationIdRef],
  )

  const handleRenameConvo = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      void patchServerConversation(id, { title: trimmed }).catch(() => {})
      const next = conversations.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
      )
      const nextActive = activeConvo ? next.find((c) => c.id === activeConvo.id) ?? activeConvo : null
      persist(next, nextActive)
    },
    [conversations, activeConvo, patchServerConversation, persist],
  )

  const handleArchiveConvo = useCallback(
    (id: string, archived: boolean) => {
      void patchServerConversation(id, { archived }).catch(() => {})
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
    [conversations, activeConvo, patchServerConversation, persist],
  )

  const handlePinConvo = useCallback(
    (id: string, pinned: boolean) => {
      void patchServerConversation(id, { pinned }).catch(() => {})
      const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
      const nextActive = activeConvo ? next.find((c) => c.id === activeConvo.id) ?? activeConvo : null
      persist(next, nextActive)
    },
    [conversations, activeConvo, patchServerConversation, persist],
  )

  const addUserMessage = useCallback(
    (
      content: string,
      options?: {
        sessionConversationId?: string
        sessionKey?: string
      },
    ): Conversation | null => {
      if (!content.trim() || !activeConvo) return null

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        createdAt: new Date().toISOString(),
        source: "agent",
        ...(options?.sessionConversationId ? { sessionConversationId: options.sessionConversationId } : {}),
        ...(options?.sessionKey ? { sessionKey: options.sessionKey } : {}),
      }

      const updated: Conversation = {
        ...activeConvo,
        messages: [...activeConvo.messages, userMsg],
        updatedAt: new Date().toISOString(),
        title: resolveConversationTitle({
          messages: [...activeConvo.messages, userMsg],
          currentTitle: activeConvo.title,
          conversations,
          conversationId: activeConvo.id,
        }),
      }

      const convos = conversations.map((c) => (c.id === updated.id ? updated : c))
      persist(convos, updated)
      if (updated.title !== activeConvo.title) {
        const mappedId = optimisticIdToServerIdRef.current.get(updated.id)
        const targetId = mappedId || updated.id
        if (!OPTIMISTIC_ID_REGEX.test(targetId)) {
          void patchServerConversation(targetId, { title: updated.title }).catch(() => {})
        }
      }

      return updated
    },
    [activeConvo, conversations, patchServerConversation, persist, optimisticIdToServerIdRef],
  )

  const addAssistantMessage = useCallback(
    (
      content: string,
      options?: { sender?: string },
    ): Conversation | null => {
      if (!content.trim() || !activeConvo) return null

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: content.trim(),
        createdAt: new Date().toISOString(),
        source: "agent",
        sender: String(options?.sender || "Nova").trim() || "Nova",
      }

      const updated: Conversation = {
        ...activeConvo,
        messages: [...activeConvo.messages, assistantMsg],
        updatedAt: new Date().toISOString(),
      }
      const convos = conversations.map((c) => (c.id === updated.id ? updated : c))
      persist(convos, updated)
      void syncServerMessages(updated).catch(() => {})
      return updated
    },
    [activeConvo, conversations, persist, syncServerMessages],
  )

  const ensureServerConversationForOptimistic = useCallback(
    async (convo: Conversation): Promise<void> => {
      if (!OPTIMISTIC_ID_REGEX.test(convo.id)) return
      if (optimisticIdToServerIdRef.current.has(convo.id)) return
      if (optimisticEnsureInFlightRef.current.has(convo.id)) return
      optimisticEnsureInFlightRef.current.add(convo.id)
      try {
        const serverConvo = await createServerConversation(convo.title)
        optimisticIdToServerIdRef.current.set(convo.id, serverConvo.id)
        const canonicalSessionConversationId = resolveSessionConversationIdForAgent(convo.id) || convo.id
        sessionConversationIdByConversationIdRef.current.set(convo.id, canonicalSessionConversationId)
        sessionConversationIdByConversationIdRef.current.set(serverConvo.id, canonicalSessionConversationId)
        const latest = latestConversationsRef.current.find((c) => c.id === convo.id)
        const messagesToSync = latest?.messages ?? convo.messages
        const withMessages: Conversation = {
          ...serverConvo,
          messages: messagesToSync,
          title: convo.title,
          updatedAt: (latest ?? convo).updatedAt,
          pinned: convo.pinned ?? serverConvo.pinned,
          archived: convo.archived ?? serverConvo.archived,
        }
        const beforeSyncConversations = latestConversationsRef.current
        const existingServerConvo = beforeSyncConversations.find((c) => c.id === serverConvo.id)
        const seededServerConvo: Conversation = {
          ...(existingServerConvo ?? serverConvo),
          ...withMessages,
          messages:
            (existingServerConvo?.messages?.length || 0) > withMessages.messages.length
              ? (existingServerConvo?.messages ?? withMessages.messages)
              : withMessages.messages,
          updatedAt:
            parseIsoTimestamp(existingServerConvo?.updatedAt) > parseIsoTimestamp(withMessages.updatedAt)
              ? (existingServerConvo?.updatedAt ?? withMessages.updatedAt)
              : withMessages.updatedAt,
        }
        const preSyncNext = beforeSyncConversations
          .map((c) => (c.id === convo.id || c.id === serverConvo.id ? seededServerConvo : c))
          .filter((c, index, arr) => arr.findIndex((entry) => entry.id === c.id) === index)
        const latestActiveId = latestActiveConvoIdRef.current
        const preSyncActive = !latestActiveId
          ? null
          : (latestActiveId === convo.id || latestActiveId === serverConvo.id)
            ? seededServerConvo
            : preSyncNext.find((entry) => entry.id === latestActiveId) ?? null
        persist(preSyncNext, preSyncActive)
        const synced = await syncServerMessages(seededServerConvo)
        if (!synced) return
        const current = latestConversationsRef.current
        const latestNow = current.find((c) => c.id === serverConvo.id) ?? current.find((c) => c.id === convo.id)
        const candidateMessages = latestNow?.messages ?? seededServerConvo.messages
        const existingInCurrent = latestNow?.messages ?? []
        const totalLen = (m: ChatMessage[]) => m.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0)
        const useExisting = totalLen(existingInCurrent) > totalLen(candidateMessages)
        const messagesToUse = useExisting ? existingInCurrent : candidateMessages
        const serverConvoWithLatestMessages: Conversation = {
          ...seededServerConvo,
          messages: messagesToUse,
          updatedAt: latestNow?.updatedAt ?? seededServerConvo.updatedAt,
        }
        const next = current
          .map((c) => (c.id === convo.id || c.id === serverConvo.id ? serverConvoWithLatestMessages : c))
          .filter((c, index, arr) => arr.findIndex((entry) => entry.id === c.id) === index)
        const refreshedActiveId = latestActiveConvoIdRef.current
        const nextActive = !refreshedActiveId
          ? null
          : (refreshedActiveId === convo.id || refreshedActiveId === serverConvo.id)
            ? serverConvoWithLatestMessages
            : next.find((entry) => entry.id === refreshedActiveId) ?? null
        persist(next, nextActive)
        void syncServerMessages(serverConvoWithLatestMessages).catch(() => {})
      } catch {
      } finally {
        optimisticEnsureInFlightRef.current.delete(convo.id)
      }
    },
    [createServerConversation, latestActiveConvoIdRef, latestConversationsRef, optimisticEnsureInFlightRef, optimisticIdToServerIdRef, persist, resolveSessionConversationIdForAgent, sessionConversationIdByConversationIdRef, syncServerMessages],
  )

  useEffect(() => {
    if (!activeConvo) return
    if (!OPTIMISTIC_ID_REGEX.test(activeConvo.id)) return
    void ensureServerConversationForOptimistic(activeConvo)
  }, [activeConvo, ensureServerConversationForOptimistic])

  const sendMessage = useCallback(
    async (
      content: string,
      sendToAgent: (content: string, voiceEnabled: boolean, ttsVoice: string, meta: Record<string, unknown>) => void,
    ) => {
      if (!content.trim() || !agentConnected || !activeConvo) return

      const { loadUserSettings } = await import("@/lib/settings/userSettings")
      const settings = loadUserSettings()
      const activeUserId = getActiveUserId()
      const sessionConversationId = resolveSessionConversationIdForAgent(activeConvo.id)
      const sessionKey = sessionConversationId
        && activeUserId
        ? `agent:nova:hud:user:${activeUserId}:dm:${sessionConversationId}`
        : ""
      const missionPrompt = isLikelyMissionPrompt(content)
      if (missionPrompt) {
        const nowMs = Date.now()
        const scopeKey = buildMissionScopeKey(activeUserId, sessionConversationId || activeConvo.id)
        const signature = normalizeMissionPromptSignature(content)
        for (const [key, value] of missionInFlightByScopeRef.current.entries()) {
          if (!value) continue
          if (nowMs - Number(value.startedAt || 0) > MISSION_INFLIGHT_MAX_MS) {
            missionInFlightByScopeRef.current.delete(key)
          }
        }
        const existing = missionInFlightByScopeRef.current.get(scopeKey)
        if (
          existing
          && existing.signature === signature
          && nowMs < Number(existing.cooldownUntil || 0)
        ) {
          const activeSnapshot = latestConversationsRef.current.find((entry) => entry.id === activeConvo.id) || activeConvo
          const notice: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: "Still processing your mission request. I did not send a duplicate. I will update you once it finishes.",
            createdAt: new Date().toISOString(),
            source: "agent",
            sender: "Nova",
          }
          const updated = { ...activeSnapshot, messages: [...activeSnapshot.messages, notice], updatedAt: new Date().toISOString() }
          const nextConvos = latestConversationsRef.current.map((entry) => (entry.id === updated.id ? updated : entry))
          persist(nextConvos, updated)
          return
        }
        missionInFlightByScopeRef.current.set(scopeKey, {
          signature,
          startedAt: nowMs,
          cooldownUntil: nowMs + MISSION_SPAM_COOLDOWN_MS,
        })
      }
      const updatedConvo = addUserMessage(content, {
        ...(sessionConversationId ? { sessionConversationId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
      })
      const lastMessage = updatedConvo?.messages?.[updatedConvo.messages.length - 1]
      const localMessageId = lastMessage?.role === "user" ? String(lastMessage.id || "") : ""
      if (!activeUserId) return
      sendToAgent(content.trim(), settings.app.voiceEnabled, settings.app.ttsVoice, {
        conversationId: resolveConversationIdForAgent(activeConvo.id),
        sender: "hud-user",
        ...(sessionKey ? { sessionKey } : {}),
        messageId: localMessageId,
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
    [activeConvo, agentConnected, addUserMessage, latestConversationsRef, missionInFlightByScopeRef, persist, resolveConversationIdForAgent, resolveSessionConversationIdForAgent],
  )

  return {
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
  }
}
