import { useEffect, useRef, type MutableRefObject } from "react"
import type { Conversation } from "@/lib/chat/conversations"
import { resolveConversationTitle } from "@/lib/chat/conversations"
import {
  buildMissionScopeKey,
  mergeIncomingAgentMessages,
  OPTIMISTIC_ID_REGEX,
  type IncomingAgentMessage,
} from "./shared"

export function useAgentMessageMerge(params: {
  agentMessages: IncomingAgentMessage[]
  activeConvo: Conversation | null
  conversations: Conversation[]
  activeUserIdRef: MutableRefObject<string>
  latestConversationsRef: MutableRefObject<Conversation[]>
  optimisticIdToServerIdRef: MutableRefObject<Map<string, string>>
  missionInFlightByScopeRef: MutableRefObject<Map<string, { signature: string; startedAt: number; cooldownUntil: number }>>
  processedAgentMessageKeysRef: MutableRefObject<Set<string>>
  mergedCountRef: MutableRefObject<number>
  persist: (convos: Conversation[], active: Conversation | null) => void
  scheduleServerSync: (convo: Conversation) => void
  patchServerConversation: (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => Promise<void>
  resolveSessionConversationIdForAgent: (conversationId: string) => string
}) {
  const {
    agentMessages,
    activeConvo,
    conversations,
    activeUserIdRef,
    optimisticIdToServerIdRef,
    missionInFlightByScopeRef,
    processedAgentMessageKeysRef,
    mergedCountRef,
    persist,
    scheduleServerSync,
    patchServerConversation,
    resolveSessionConversationIdForAgent,
  } = params

  // Tracks last-seen content length per assistant id across runs.
  // Used to detect "stabilized" content (stream done) for final merge.
  const assistantSeenLenRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (agentMessages.length === 0) {
      mergedCountRef.current = 0
      processedAgentMessageKeysRef.current.clear()
      return
    }
    if (conversations.length === 0) return

    const processedKeys = processedAgentMessageKeysRef.current

    // For user messages: content-aware key (they don't stream)
    const makeUserMergeKey = (item: IncomingAgentMessage): string => {
      const cid = typeof item.conversationId === "string" ? item.conversationId.trim() : ""
      const content = String(item.content || "")
      return [item.id, item.role, cid, String(item.ts || 0), String(content.length), content.slice(0, 32), content.slice(-32)].join("|")
    }

    // For assistant messages: stable key by id only. Streaming mutations
    // must NOT generate new keys or each delta re-merges into the conversation.
    const makeAssistantStableKey = (item: IncomingAgentMessage): string => {
      return `asst|${item.id}`
    }

    // Collect the latest (longest-content) snapshot per assistant id
    const latestAssistantById = new Map<string, IncomingAgentMessage>()
    for (const item of agentMessages) {
      if (item.role !== "assistant") continue
      const prev = latestAssistantById.get(item.id)
      if (!prev || String(item.content || "").length >= String(prev.content || "").length) {
        latestAssistantById.set(item.id, item)
      }
    }

    const seenLens = assistantSeenLenRef.current

    const newOnes: Array<{ item: IncomingAgentMessage; key: string }> = []
    for (const item of agentMessages) {
      if (item.role === "assistant") {
        const latest = latestAssistantById.get(item.id)
        if (latest && latest !== item) continue
        const content = String(item.content || "").trim()
        if (!content) continue
        const stableKey = makeAssistantStableKey(item)
        const prevSeenLen = seenLens.get(item.id) || 0
        seenLens.set(item.id, content.length)

        if (processedKeys.has(stableKey)) {
          // Already merged once.  Skip while content is still growing
          // (streaming in progress).  Allow a final re-merge once content
          // has stabilized (length unchanged since last effect run).
          if (content.length !== prevSeenLen) continue
          processedKeys.delete(stableKey)
        }
        processedKeys.add(stableKey)
        newOnes.push({ item, key: stableKey })
      } else {
        const key = makeUserMergeKey(item)
        if (processedKeys.has(key)) continue
        processedKeys.add(key)
        newOnes.push({ item, key })
      }
    }

    if (processedKeys.size > 8000) {
      const compacted = new Set<string>()
      const recent = agentMessages.slice(-400)
      for (const item of recent) {
        compacted.add(item.role === "assistant" ? makeAssistantStableKey(item) : makeUserMergeKey(item))
      }
      processedAgentMessageKeysRef.current = compacted
    }

    mergedCountRef.current = agentMessages.length
    if (newOnes.length === 0) return

    const incomingByConversation = new Map<string, IncomingAgentMessage[]>()
    const conversationIds = new Set(conversations.map((c) => c.id))
    const activeConversationId = String(activeConvo?.id || "").trim()
    const resolveIncomingConversationId = (rawConversationId: string, hasExplicitId: boolean, source: string): string => {
      const normalized = String(rawConversationId || "").trim()
      if (!normalized) {
        // Only file into the active conversation for HUD-sourced messages
        // (the user actually typed in that conversation). Voice/other sources
        // without a conversationId must not pollute unrelated chats.
        if (source === "hud" && activeConversationId && conversationIds.has(activeConversationId)) return activeConversationId
        return ""
      }

      const equivalentIds: string[] = [normalized]
      const mappedServerId = optimisticIdToServerIdRef.current.get(normalized)
      if (mappedServerId && !equivalentIds.includes(mappedServerId)) equivalentIds.push(mappedServerId)
      for (const [optimisticId, serverId] of optimisticIdToServerIdRef.current.entries()) {
        if (serverId !== normalized) continue
        if (!equivalentIds.includes(optimisticId)) equivalentIds.push(optimisticId)
      }

      if (
        activeConversationId &&
        equivalentIds.includes(activeConversationId) &&
        conversationIds.has(activeConversationId)
      ) {
        return activeConversationId
      }

      for (const candidate of equivalentIds) {
        if (!conversationIds.has(candidate)) continue
        if (OPTIMISTIC_ID_REGEX.test(candidate)) return candidate
      }
      for (const candidate of equivalentIds) {
        if (conversationIds.has(candidate)) return candidate
      }
      // Only fall back to activeConversationId for HUD-sourced messages that
      // carried no explicit conversationId.  Messages with an unrecognised
      // conversationId or from non-HUD sources must not be mis-filed into
      // whichever chat happens to be open.
      if (!hasExplicitId && source === "hud" && activeConversationId && conversationIds.has(activeConversationId)) return activeConversationId
      return ""
    }
    for (const entry of newOnes) {
      const item = entry.item
      const explicitConversationId =
        typeof item.conversationId === "string" ? item.conversationId.trim() : ""
      const hasExplicitId = explicitConversationId.length > 0
      const itemSource = typeof item.source === "string" ? item.source : ""
      const targetConversationId = resolveIncomingConversationId(
        explicitConversationId || activeConversationId,
        hasExplicitId,
        itemSource,
      )
      if (!targetConversationId) {
        // Keep it eligible for a future pass once mapping/active conversation resolves.
        processedKeys.delete(entry.key)
        continue
      }
      const bucket = incomingByConversation.get(targetConversationId)
      if (bucket) {
        bucket.push(item)
      } else {
        incomingByConversation.set(targetConversationId, [item])
      }
    }
    if (incomingByConversation.size === 0) return

    const existingById = new Map(conversations.map((convo) => [convo.id, convo]))
    const changedById = new Map<string, Conversation>()
    const convos = conversations.map((convo) => {
      const incoming = incomingByConversation.get(convo.id)
      if (!incoming || incoming.length === 0) return convo

      const mergedMessages = mergeIncomingAgentMessages(convo.messages, incoming)
      const updated: Conversation = {
        ...convo,
        messages: mergedMessages,
        updatedAt: new Date().toISOString(),
        title: resolveConversationTitle({
          messages: mergedMessages,
          currentTitle: convo.title,
          conversations,
          conversationId: convo.id,
        }),
      }
      changedById.set(updated.id, updated)
      return updated
    })
    if (changedById.size === 0) return

    const userContextId = String(activeUserIdRef.current || "").trim()
    for (const [conversationId, incoming] of incomingByConversation.entries()) {
      if (!incoming.some((item) => item.role === "assistant")) continue
      const sessionConversationId = resolveSessionConversationIdForAgent(conversationId)
      const missionScopeKey = buildMissionScopeKey(userContextId, sessionConversationId)
      missionInFlightByScopeRef.current.delete(missionScopeKey)
    }

    const nextActive = activeConvo ? convos.find((c) => c.id === activeConvo.id) ?? activeConvo : null
    persist(convos, nextActive)

    for (const updated of changedById.values()) {
      scheduleServerSync(updated)
      const previous = existingById.get(updated.id)
      if (previous && updated.title !== previous.title) {
        void patchServerConversation(updated.id, { title: updated.title }).catch(() => {})
      }
    }
  }, [
    activeConvo,
    activeUserIdRef,
    agentMessages,
    conversations,
    mergedCountRef,
    missionInFlightByScopeRef,
    optimisticIdToServerIdRef,
    patchServerConversation,
    persist,
    processedAgentMessageKeysRef,
    resolveSessionConversationIdForAgent,
    scheduleServerSync,
  ])
}
