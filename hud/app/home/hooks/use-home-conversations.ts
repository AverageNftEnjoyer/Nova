"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  createConversation,
  loadConversations,
  resolveConversationTitle,
  saveConversations,
  setActiveId,
  type ChatMessage,
  type Conversation,
} from "@/lib/chat/conversations"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"

interface AgentMessage {
  id: string
  role: "user" | "assistant"
  content: string
  ts: number
  source?: string
}

interface UseHomeConversationsInput {
  agentMessages: AgentMessage[]
  clearAgentMessages: () => void
}

function normalizeSource(source: string | undefined): "agent" | "hud" | "voice" {
  return source === "agent" || source === "hud" || source === "voice" ? source : "voice"
}

/** Merges streamed assistant chunks of one reply into a single message. */
function mergeVoiceMessages(agentMessages: AgentMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = []
  for (const m of agentMessages) {
    const incoming: ChatMessage = {
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.ts).toISOString(),
      source: normalizeSource(m.source),
    }
    const existingIdx = incoming.role === "assistant" ? merged.findIndex((entry) => entry.role === "assistant" && entry.id === incoming.id) : -1
    if (existingIdx === -1) {
      merged.push(incoming)
      continue
    }
    const existing = merged[existingIdx]
    merged[existingIdx] = {
      ...existing,
      content: `${existing.content}${incoming.content}`,
      createdAt: incoming.createdAt,
      source: incoming.source ?? existing.source,
    }
  }
  return merged
}

/**
 * The chat list for Home's recent chats (local cache first, then GET /api/threads), and the voice handoff: a voice
 * conversation that starts while Home is open becomes a conversation and opens /chat.
 */
export function useHomeConversations({ agentMessages, clearAgentMessages }: UseHomeConversationsInput) {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
    writeShellUiCache({ conversations: next })
  }, [])

  useLayoutEffect(() => {
    const cached = readShellUiCache().conversations ?? loadConversations()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cache lives in localStorage (client only)
    setConversations(cached)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/threads", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { conversations?: Conversation[] } | null
        if (!res.ok) throw new Error("Failed to load conversations.")
        return Array.isArray(data?.conversations) ? data.conversations : []
      })
      .then((remote) => {
        if (!cancelled) persistConversations(remote)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [persistConversations])

  const voiceConvoCreatedRef = useRef(false)
  useEffect(() => {
    if (agentMessages.length === 0) {
      voiceConvoCreatedRef.current = false
      return
    }
    const startedByVoice = agentMessages.some((m) => m.role === "user" && m.source === "voice")
    if (!startedByVoice || voiceConvoCreatedRef.current) return
    voiceConvoCreatedRef.current = true

    const convo = createConversation()
    convo.messages = mergeVoiceMessages(agentMessages)
    convo.title = resolveConversationTitle({
      messages: convo.messages,
      currentTitle: convo.title,
      conversations,
      conversationId: convo.id,
    })
    // Home navigates away right after, so only the stores need the new conversation (no state update here).
    const next = [convo, ...conversations]
    saveConversations(next)
    writeShellUiCache({ conversations: next })
    setActiveId(convo.id)
    clearAgentMessages()
    router.push("/chat")
  }, [agentMessages, conversations, clearAgentMessages, router])

  return { conversations }
}
