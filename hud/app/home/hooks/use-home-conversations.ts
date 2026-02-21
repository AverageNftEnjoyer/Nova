"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  createConversation,
  DEFAULT_CONVERSATION_TITLE,
  generateId,
  getActiveId,
  loadConversations,
  resolveConversationTitle,
  saveConversations,
  setActiveId,
  type ChatMessage,
  type Conversation,
} from "@/lib/chat/conversations"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { generateHandoffOperationToken, PENDING_CHAT_SESSION_KEY } from "@/lib/chat/handoff"

interface AgentMessage {
  id: string
  role: "user" | "assistant"
  content: string
  ts: number
  source?: string
}

function normalizeSource(source: string | undefined): "agent" | "hud" | "voice" {
  return source === "agent" || source === "hud" || source === "voice" ? source : "voice"
}

interface UseHomeConversationsInput {
  connected: boolean
  agentMessages: AgentMessage[]
  clearAgentMessages: () => void
}

export function useHomeConversations({ connected, agentMessages, clearAgentMessages }: UseHomeConversationsInput) {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
    writeShellUiCache({ conversations: next })
  }, [])

  const fetchConversationsFromServer = useCallback(async (): Promise<Conversation[]> => {
    const res = await fetch("/api/threads", { cache: "no-store" })
    if (res.status === 401) {
      router.replace(`/login?next=${encodeURIComponent("/home")}`)
      throw new Error("Unauthorized")
    }
    const data = await res.json().catch(() => ({})) as { conversations?: Conversation[] }
    if (!res.ok) throw new Error("Failed to load conversations.")
    return Array.isArray(data.conversations) ? data.conversations : []
  }, [router])

  const createServerConversation = useCallback(async (title = DEFAULT_CONVERSATION_TITLE): Promise<Conversation> => {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
    if (res.status === 401) {
      router.replace(`/login?next=${encodeURIComponent("/home")}`)
      throw new Error("Unauthorized")
    }
    const data = await res.json().catch(() => ({})) as { conversation?: Conversation; error?: string }
    if (!res.ok || !data.conversation) throw new Error(data.error || "Failed to create conversation.")
    return data.conversation
  }, [router])

  const syncServerMessages = useCallback(async (convo: Conversation) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(convo.id)}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: convo.messages }),
    })
    if (res.status === 401) {
      router.replace(`/login?next=${encodeURIComponent("/home")}`)
      throw new Error("Unauthorized")
    }
    if (!res.ok) throw new Error("Failed to sync conversation messages.")
  }, [router])

  const deleteServerConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (res.status === 401) {
      router.replace(`/login?next=${encodeURIComponent("/home")}`)
      throw new Error("Unauthorized")
    }
    if (!res.ok) throw new Error("Failed to delete conversation.")
  }, [router])

  const ensureServerConversation = useCallback(async (convo: Conversation): Promise<Conversation> => {
    const remoteConversations = await fetchConversationsFromServer().catch(() => [])
    const existing = remoteConversations.find((entry) => entry.id === convo.id)
    if (existing) return existing

    const created = await createServerConversation(convo.title || DEFAULT_CONVERSATION_TITLE)
    const migrated: Conversation = {
      ...created,
      messages: convo.messages,
      title: convo.title || created.title,
      updatedAt: convo.updatedAt || created.updatedAt,
      createdAt: convo.createdAt || created.createdAt,
    }
    await syncServerMessages(migrated)

    const next = conversations.map((entry) => (entry.id === convo.id ? migrated : entry))
    persistConversations(next)
    return migrated
  }, [conversations, createServerConversation, fetchConversationsFromServer, persistConversations, syncServerMessages])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const loadedConversations = cached.conversations ?? loadConversations()
    setConversations(loadedConversations)
    writeShellUiCache({ conversations: loadedConversations })
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchConversationsFromServer()
      .then((remote) => {
        if (cancelled) return
        persistConversations(remote)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [fetchConversationsFromServer, persistConversations])

  const voiceConvoCreatedRef = useRef(false)
  useEffect(() => {
    if (agentMessages.length === 0) {
      voiceConvoCreatedRef.current = false
      return
    }

    const voiceUserMsg = agentMessages.find((m) => m.role === "user" && m.source === "voice")
    if (voiceUserMsg && !voiceConvoCreatedRef.current) {
      voiceConvoCreatedRef.current = true

      const convo = createConversation()
      const mergedVoiceMessages: ChatMessage[] = []
      for (const m of agentMessages) {
        const incoming: ChatMessage = {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.ts).toISOString(),
          source: normalizeSource(m.source),
        }
        if (incoming.role !== "assistant") {
          mergedVoiceMessages.push(incoming)
          continue
        }
        const existingIdx = mergedVoiceMessages.findIndex((entry) => entry.role === "assistant" && entry.id === incoming.id)
        if (existingIdx === -1) {
          mergedVoiceMessages.push(incoming)
          continue
        }
        const existing = mergedVoiceMessages[existingIdx]
        mergedVoiceMessages[existingIdx] = {
          ...existing,
          content: `${existing.content}${incoming.content}`,
          createdAt: incoming.createdAt,
          source: incoming.source ?? existing.source,
        }
      }
      convo.messages = mergedVoiceMessages
      convo.title = resolveConversationTitle({
        messages: convo.messages,
        currentTitle: convo.title,
        conversations,
        conversationId: convo.id,
      })

      const next = [convo, ...conversations]
      persistConversations(next)
      setActiveId(convo.id)
      clearAgentMessages()
      router.push("/chat")
    }
  }, [agentMessages, conversations, persistConversations, clearAgentMessages, router])

  const handleSend = useCallback((finalText: string) => {
    const text = finalText.trim()
    if (!text || !connected) return

    const provisionalUserMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: finalText,
      createdAt: new Date().toISOString(),
      source: "agent",
    }
    const seededTitle = resolveConversationTitle({
      messages: [provisionalUserMessage],
      currentTitle: DEFAULT_CONVERSATION_TITLE,
      conversations,
    })
    // Optimistic local conversation so we can navigate immediately
    const optimisticConvo: Conversation = {
      ...createConversation(),
      messages: [provisionalUserMessage],
      title: seededTitle,
      updatedAt: new Date().toISOString(),
    }

    const next = [optimisticConvo, ...conversations.filter((existing) => existing.id !== optimisticConvo.id)]
    persistConversations(next)
    setActiveId(optimisticConvo.id)
    try {
      sessionStorage.setItem(
        PENDING_CHAT_SESSION_KEY,
        JSON.stringify({
          convoId: optimisticConvo.id,
          content: finalText,
          messageId: provisionalUserMessage.id,
          opToken: generateHandoffOperationToken(),
          messageCreatedAt: provisionalUserMessage.createdAt,
          createdAt: Date.now(),
        }),
      )
    } catch {}
    router.push("/chat")
    // Server create/sync runs on the chat page so it can replace the optimistic convo in state
  }, [connected, conversations, persistConversations, router])

  const handleSelectConvo = useCallback(async (id: string) => {
    const local = conversations.find((entry) => entry.id === id)
    if (!local) {
      setActiveId(id)
      router.push("/chat")
      return
    }
    const ensured = await ensureServerConversation(local).catch(() => null)
    setActiveId(ensured?.id || id)
    router.push("/chat")
  }, [conversations, ensureServerConversation, router])

  const handleNewChat = useCallback(() => {
    // Home screen "New chat" should not navigate or create a conversation.
  }, [])

  const handleDeleteConvo = useCallback(async (id: string) => {
    const previous = conversations
    const remaining = conversations.filter((c) => c.id !== id)
    persistConversations(remaining)
    if (getActiveId() === id) {
      setActiveId(null)
    }

    try {
      await deleteServerConversation(id)
      const remote = await fetchConversationsFromServer()
      persistConversations(remote)
    } catch {
      persistConversations(previous)
    }
  }, [conversations, deleteServerConversation, fetchConversationsFromServer, persistConversations])

  const handleRenameConvo = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const next = conversations.map((c) =>
      c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handleArchiveConvo = useCallback((id: string, archived: boolean) => {
    const next = conversations.map((c) =>
      c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handlePinConvo = useCallback((id: string, pinned: boolean) => {
    const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
    persistConversations(next)
  }, [conversations, persistConversations])

  return {
    conversations,
    handleSend,
    handleSelectConvo,
    handleNewChat,
    handleDeleteConvo,
    handleRenameConvo,
    handleArchiveConvo,
    handlePinConvo,
  }
}
