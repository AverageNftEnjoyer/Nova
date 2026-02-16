import { getActiveUserId } from "@/lib/active-user"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  source?: "hud" | "agent" | "voice"
  sender?: string
}

export interface Conversation {
  id: string
  title: string
  pinned?: boolean
  archived?: boolean
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

const CONVERSATIONS_KEY_PREFIX = "nova-conversations"
const ACTIVE_KEY_PREFIX = "nova-active-conversation"
const LEGACY_CONVERSATIONS_KEY = "nova-conversations"
const LEGACY_ACTIVE_KEY = "nova-active-conversation"

function getConversationsKey(): string {
  const userId = getActiveUserId()
  return userId ? `${CONVERSATIONS_KEY_PREFIX}:${userId}` : ""
}

function getActiveKey(): string {
  const userId = getActiveUserId()
  return userId ? `${ACTIVE_KEY_PREFIX}:${userId}` : ""
}

function migrateLegacyConversationsIfNeeded(): void {
  const scopedConversationsKey = getConversationsKey()
  if (!scopedConversationsKey) return
  if (!localStorage.getItem(scopedConversationsKey)) {
    const legacy = localStorage.getItem(LEGACY_CONVERSATIONS_KEY)
    if (legacy) {
      localStorage.setItem(scopedConversationsKey, legacy)
      localStorage.removeItem(LEGACY_CONVERSATIONS_KEY)
    }
  }
  const scopedActiveKey = getActiveKey()
  if (!scopedActiveKey) return
  if (!localStorage.getItem(scopedActiveKey)) {
    const legacyActive = localStorage.getItem(LEGACY_ACTIVE_KEY)
    if (legacyActive) {
      localStorage.setItem(scopedActiveKey, legacyActive)
      localStorage.removeItem(LEGACY_ACTIVE_KEY)
    }
  }
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function loadConversations(): Conversation[] {
  try {
    const key = getConversationsKey()
    if (!key) return []
    migrateLegacyConversationsIfNeeded()
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveConversations(convos: Conversation[]) {
  const key = getConversationsKey()
  if (!key) return
  localStorage.setItem(key, JSON.stringify(convos))
}

export function getActiveId(): string | null {
  const key = getActiveKey()
  if (!key) return null
  migrateLegacyConversationsIfNeeded()
  return localStorage.getItem(key)
}

export function setActiveId(id: string | null) {
  const key = getActiveKey()
  if (!key) return
  if (id) localStorage.setItem(key, id)
  else localStorage.removeItem(key)
}

export function createConversation(): Conversation {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function autoTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return "New chat"
  const text = firstUser.content.trim()
  return text.length > 40 ? text.slice(0, 40) + "..." : text
}
