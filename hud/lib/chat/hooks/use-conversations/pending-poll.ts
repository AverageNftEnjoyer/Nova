import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import type { Conversation } from "@/lib/chat/conversations"
import { generateId } from "@/lib/chat/conversations"
import {
  buildPendingPollScopeKey,
  computeBackoffDelayMs,
  defaultPollIntervalMs,
  parseRetryAfterMs,
} from "@/lib/novachat/polling-resilience"
import {
  normalizeMessageComparableCompact,
  parseIsoTimestamp,
  resolvePendingMissionDeliveryKey,
  resolvePendingMissionGroupKey,
  type PendingMissionMessage,
} from "./shared"
import type { ChatMessage } from "@/lib/chat/conversations"

const PENDING_POLL_LEASE_TTL_MS = 12_000
const PENDING_POLL_MIN_INTERVAL_MS = 1_200
const PENDING_POLL_LEASE_STORAGE_KEY = "nova_pending_poll_lease_v1"
const PENDING_POLL_COOLDOWN_STORAGE_KEY = "nova_pending_poll_cooldown_v1"
const PENDING_POLL_USER_SCOPE = "__user__"

function readSharedPendingPollCooldown(scopeKey: string): number {
  if (typeof window === "undefined") return 0
  const key = String(scopeKey || "").trim()
  if (!key) return 0
  try {
    const raw = localStorage.getItem(PENDING_POLL_COOLDOWN_STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { scopeKey?: string; retryAtMs?: number }
    if (String(parsed.scopeKey || "").trim() !== key) return 0
    const retryAtMs = Number(parsed.retryAtMs || 0)
    return Number.isFinite(retryAtMs) ? Math.max(0, retryAtMs) : 0
  } catch {
    return 0
  }
}

function writeSharedPendingPollCooldown(scopeKey: string, retryAtMs: number): void {
  if (typeof window === "undefined") return
  const key = String(scopeKey || "").trim()
  if (!key) return
  try {
    localStorage.setItem(
      PENDING_POLL_COOLDOWN_STORAGE_KEY,
      JSON.stringify({
        scopeKey: key,
        retryAtMs: Math.max(0, Number(retryAtMs || 0)),
      }),
    )
  } catch {
  }
}

function clearSharedPendingPollCooldown(scopeKey: string): void {
  if (typeof window === "undefined") return
  const key = String(scopeKey || "").trim()
  if (!key) return
  try {
    const raw = localStorage.getItem(PENDING_POLL_COOLDOWN_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { scopeKey?: string; retryAtMs?: number }
    if (String(parsed.scopeKey || "").trim() !== key) return
    localStorage.removeItem(PENDING_POLL_COOLDOWN_STORAGE_KEY)
  } catch {
  }
}

export type PendingQueueStatus = {
  mode: "idle" | "processing" | "retrying"
  message: string
  retryAtMs: number
}

export function usePendingNovaChatPolling(params: {
  isLoaded: boolean
  shouldOpenPendingNovaChat: boolean
  activeUserScopeVersion: number
  activeUserIdRef: MutableRefObject<string>
  latestConversationsRef: MutableRefObject<Conversation[]>
  createServerConversation: (title?: string) => Promise<Conversation>
  syncServerMessages: (convo: Conversation) => Promise<boolean>
  persist: (convos: Conversation[], active: Conversation | null) => void
}) {
  const {
    isLoaded,
    shouldOpenPendingNovaChat,
    activeUserScopeVersion,
    activeUserIdRef,
    latestConversationsRef,
    createServerConversation,
    syncServerMessages,
    persist,
  } = params

  const pendingMessagesInFlightRef = useRef(false)
  const pendingPollPromiseRef = useRef<Promise<number> | null>(null)
  const pendingPollAbortRef = useRef<AbortController | null>(null)
  const pendingPollBackoffTimerRef = useRef<number | null>(null)
  const pendingRedirectTimerRef = useRef<number | null>(null)
  const pendingPollBackoffAttemptsRef = useRef(0)
  const pendingPollRetryUntilRef = useRef(0)
  const pendingPollLastStartedAtRef = useRef(0)
  const pendingPollScopeKeyRef = useRef("")
  const pendingMissionConversationByGroupRef = useRef<Map<string, string>>(new Map())
  const pendingPollTabIdRef = useRef(`tab-${Math.random().toString(36).slice(2, 10)}`)
  const [pendingQueueStatus, setPendingQueueStatus] = useState<PendingQueueStatus>({
    mode: "idle",
    message: "",
    retryAtMs: 0,
  })

  const setPendingQueueStatusSafe = useCallback((next: PendingQueueStatus) => {
    setPendingQueueStatus((prev) => {
      if (prev.mode === next.mode && prev.message === next.message && prev.retryAtMs === next.retryAtMs) return prev
      return next
    })
  }, [])

  useEffect(() => {
    if (pendingQueueStatus.mode !== "retrying") return
    const tick = window.setInterval(() => {
      setPendingQueueStatus((prev) => {
        if (prev.mode !== "retrying") return prev
        if (prev.retryAtMs <= Date.now()) return { mode: "processing", message: "Retrying pending queue...", retryAtMs: 0 }
        return { ...prev }
      })
    }, 250)
    return () => window.clearInterval(tick)
  }, [pendingQueueStatus.mode])

  const tryAcquirePendingPollLease = useCallback((scopeKey: string): boolean => {
    if (typeof window === "undefined") return true
    const nowMs = Date.now()
    const holder = String(pendingPollTabIdRef.current || "").trim()
    if (!holder || !scopeKey) return true
    try {
      const raw = localStorage.getItem(PENDING_POLL_LEASE_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { scopeKey?: string; holder?: string; expiresAt?: number }
        const existingScope = String(parsed.scopeKey || "").trim()
        const existingHolder = String(parsed.holder || "").trim()
        const expiresAt = Number(parsed.expiresAt || 0)
        if (existingScope === scopeKey && existingHolder && existingHolder !== holder && expiresAt > nowMs) {
          return false
        }
      }
      const next = {
        scopeKey,
        holder,
        expiresAt: nowMs + PENDING_POLL_LEASE_TTL_MS,
      }
      localStorage.setItem(PENDING_POLL_LEASE_STORAGE_KEY, JSON.stringify(next))
      const confirmRaw = localStorage.getItem(PENDING_POLL_LEASE_STORAGE_KEY)
      if (!confirmRaw) return false
      const confirm = JSON.parse(confirmRaw) as { scopeKey?: string; holder?: string; expiresAt?: number }
      return (
        String(confirm.scopeKey || "").trim() === scopeKey
        && String(confirm.holder || "").trim() === holder
        && Number(confirm.expiresAt || 0) > nowMs
      )
    } catch {
      return true
    }
  }, [])

  const releasePendingPollLease = useCallback((scopeKey: string): void => {
    if (typeof window === "undefined") return
    const holder = String(pendingPollTabIdRef.current || "").trim()
    if (!holder || !scopeKey) return
    try {
      const raw = localStorage.getItem(PENDING_POLL_LEASE_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { scopeKey?: string; holder?: string; expiresAt?: number }
      if (String(parsed.scopeKey || "").trim() !== scopeKey) return
      if (String(parsed.holder || "").trim() !== holder) return
      localStorage.removeItem(PENDING_POLL_LEASE_STORAGE_KEY)
    } catch {
    }
  }, [])

  useEffect(() => {
    return () => {
      releasePendingPollLease(String(pendingPollScopeKeyRef.current || ""))
      pendingPollRetryUntilRef.current = 0
      if (pendingPollBackoffTimerRef.current !== null) {
        window.clearTimeout(pendingPollBackoffTimerRef.current)
        pendingPollBackoffTimerRef.current = null
      }
      if (pendingRedirectTimerRef.current !== null) {
        window.clearTimeout(pendingRedirectTimerRef.current)
        pendingRedirectTimerRef.current = null
      }
      pendingPollAbortRef.current?.abort()
      pendingPollAbortRef.current = null
      pendingPollPromiseRef.current = null
      pendingPollLastStartedAtRef.current = 0
    }
  }, [releasePendingPollLease])

  useEffect(() => {
    const nextScopeKey = buildPendingPollScopeKey(
      activeUserIdRef.current,
      PENDING_POLL_USER_SCOPE,
    )
    if (pendingPollScopeKeyRef.current && pendingPollScopeKeyRef.current !== nextScopeKey) {
      releasePendingPollLease(String(pendingPollScopeKeyRef.current || ""))
      if (pendingPollBackoffTimerRef.current !== null) {
        window.clearTimeout(pendingPollBackoffTimerRef.current)
        pendingPollBackoffTimerRef.current = null
      }
      pendingPollAbortRef.current?.abort()
      pendingPollAbortRef.current = null
      pendingPollPromiseRef.current = null
      pendingMessagesInFlightRef.current = false
      pendingPollRetryUntilRef.current = 0
      pendingPollLastStartedAtRef.current = 0
      setPendingQueueStatus((prev) => (prev.mode === "idle" ? prev : { mode: "idle", message: "", retryAtMs: 0 }))
    }
    pendingPollScopeKeyRef.current = nextScopeKey
  }, [activeUserScopeVersion, activeUserIdRef, releasePendingPollLease])

  const processPendingNovaChatMessages = useCallback(async (): Promise<number> => {
    if (!isLoaded) return 0
    const nowMs = Date.now()
    if (pendingPollPromiseRef.current) return pendingPollPromiseRef.current
    if (pendingMessagesInFlightRef.current) return 0
    if (pendingPollRetryUntilRef.current > nowMs) return 0
    if (
      pendingPollLastStartedAtRef.current > 0
      && nowMs - pendingPollLastStartedAtRef.current < PENDING_POLL_MIN_INTERVAL_MS
    ) {
      return 0
    }

    const pollScopeKey = buildPendingPollScopeKey(
      activeUserIdRef.current,
      PENDING_POLL_USER_SCOPE,
    )
    pendingPollScopeKeyRef.current = pollScopeKey
    const sharedRetryAtMs = readSharedPendingPollCooldown(pollScopeKey)
    if (sharedRetryAtMs > Date.now()) {
      pendingPollRetryUntilRef.current = Math.max(pendingPollRetryUntilRef.current, sharedRetryAtMs)
      return 0
    }
    pendingMessagesInFlightRef.current = true
    if (!tryAcquirePendingPollLease(pollScopeKey)) {
      pendingMessagesInFlightRef.current = false
      return 0
    }
    pendingPollLastStartedAtRef.current = nowMs
    const controller = new AbortController()
    pendingPollAbortRef.current = controller
    const schedulePendingRetry = (paramsInput: { retryAfterMs?: number; message: string }): number => {
      pendingPollBackoffAttemptsRef.current += 1
      const delay = computeBackoffDelayMs({
        attempt: pendingPollBackoffAttemptsRef.current,
        retryAfterMs: Number(paramsInput.retryAfterMs || 0),
      })
      const retryAtMs = Date.now() + delay
      pendingPollRetryUntilRef.current = retryAtMs
      writeSharedPendingPollCooldown(pollScopeKey, retryAtMs)
      setPendingQueueStatusSafe({
        mode: "retrying",
        message: String(paramsInput.message || "Pending queue error. Retrying."),
        retryAtMs,
      })
      if (pendingPollBackoffTimerRef.current !== null) window.clearTimeout(pendingPollBackoffTimerRef.current)
      pendingPollBackoffTimerRef.current = window.setTimeout(() => {
        pendingPollBackoffTimerRef.current = null
        void processPendingNovaChatMessages()
      }, delay)
      return 0
    }

    const run = (async () => {
      try {
        const res = await fetch("/api/novachat/pending", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (res.status === 429) {
          const body = await res.json().catch(() => ({})) as { retryAfterMs?: number }
          const retryAfterMs = Math.max(
            parseRetryAfterMs(res.headers.get("Retry-After"), Number(body?.retryAfterMs || 0)),
            defaultPollIntervalMs(),
          )
          return schedulePendingRetry({
            retryAfterMs,
            message: "Pending queue rate-limited. Retrying shortly.",
          })
        }
        if (!res.ok) {
          return schedulePendingRetry({
            message: "Pending queue temporarily unavailable. Retrying.",
          })
        }
        const data = await res.json().catch(() => ({})) as {
          ok: boolean
          messages?: PendingMissionMessage[]
          rateLimited?: boolean
          retryAfterMs?: number
        }
        if (data.rateLimited) {
          const retryAfterMs = Math.max(
            parseRetryAfterMs(res.headers.get("Retry-After"), Number(data?.retryAfterMs || 0)),
            defaultPollIntervalMs(),
          )
          return schedulePendingRetry({
            retryAfterMs,
            message: "Pending queue rate-limited. Retrying shortly.",
          })
        }
        pendingPollBackoffAttemptsRef.current = 0
        pendingPollRetryUntilRef.current = 0
        clearSharedPendingPollCooldown(pollScopeKey)
        setPendingQueueStatus((prev) => (prev.mode === "idle" ? prev : { mode: "idle", message: "", retryAtMs: 0 }))
        if (!data.ok || !Array.isArray(data.messages) || data.messages.length === 0) return 0

        setPendingQueueStatus((prev) => (prev.mode === "idle" ? { mode: "processing", message: "Checking pending queue...", retryAtMs: 0 } : prev))

        const consumedIds: string[] = []
        let latestConvo: Conversation | null = null
        let updatedConvos = [...latestConversationsRef.current]
        const seenDeliveryKeys = new Set<string>()
        const runConversationByGroup = pendingMissionConversationByGroupRef.current
        const sortedMessages = [...data.messages].sort((a, b) => parseIsoTimestamp(a.createdAt) - parseIsoTimestamp(b.createdAt))

        for (const msg of sortedMessages) {
          const deliveryKey = resolvePendingMissionDeliveryKey(msg)
          if (seenDeliveryKeys.has(deliveryKey)) {
            consumedIds.push(msg.id)
            continue
          }
          seenDeliveryKeys.add(deliveryKey)
          const groupKey = resolvePendingMissionGroupKey(msg)
          const existingByGroupId = runConversationByGroup.get(groupKey)
          const missionRunId = String(msg.metadata?.missionRunId || "").trim()
          const missionRunKey = String(msg.metadata?.runKey || "").trim()
          let targetConvo =
            (existingByGroupId ? updatedConvos.find((c) => c.id === existingByGroupId) : null)
            || (missionRunId
              ? updatedConvos.find((c) => c.messages.some((m) => String(m.missionRunId || "").trim() === missionRunId))
              : null)
            || (missionRunKey
              ? updatedConvos.find((c) => c.messages.some((m) => String(m.missionRunKey || "").trim() === missionRunKey))
              : null)
            || null
          if (!targetConvo) {
            targetConvo = await createServerConversation(msg.title || msg.missionLabel || "Mission Report").catch(() => null)
            if (!targetConvo) continue
            const targetConvoId = targetConvo.id
            runConversationByGroup.set(groupKey, targetConvoId)
            updatedConvos = [targetConvo, ...updatedConvos.filter((c) => c.id !== targetConvoId)]
          }
          runConversationByGroup.set(groupKey, targetConvo.id)

          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: msg.content,
            createdAt: msg.createdAt || new Date().toISOString(),
            source: "agent",
            sender: msg.missionLabel || "Nova Mission",
            missionId: msg.missionId,
            missionLabel: msg.missionLabel,
            missionRunId: msg.metadata?.missionRunId,
            missionRunKey: msg.metadata?.runKey,
            missionAttempt:
              Number.isFinite(Number(msg.metadata?.attempt || 0)) && Number(msg.metadata?.attempt || 0) > 0
                ? Number(msg.metadata?.attempt || 0)
                : undefined,
            missionSource: msg.metadata?.source,
            missionOutputChannel: msg.metadata?.outputChannel,
          }

          const alreadyPresent = targetConvo.messages.some((existing) => {
            if (existing.role !== "assistant") return false
            if (String(existing.missionRunId || "").trim() !== missionRunId) return false
            return normalizeMessageComparableCompact(String(existing.content || "")) === normalizeMessageComparableCompact(String(msg.content || ""))
          })
          if (alreadyPresent) {
            consumedIds.push(msg.id)
            runConversationByGroup.set(groupKey, targetConvo.id)
            continue
          }

          const convoWithMessage: Conversation = {
            ...targetConvo,
            title: targetConvo.title || msg.title || msg.missionLabel || "Mission Report",
            messages: [...targetConvo.messages, assistantMsg],
            updatedAt: new Date().toISOString(),
          }

          const synced = await syncServerMessages(convoWithMessage).catch(() => false)
          if (!synced) continue

          consumedIds.push(msg.id)
          updatedConvos = [convoWithMessage, ...updatedConvos.filter((c) => c.id !== convoWithMessage.id)]
          latestConvo = convoWithMessage
          runConversationByGroup.set(groupKey, convoWithMessage.id)
        }

        if (latestConvo) {
          persist(updatedConvos, latestConvo)
        }

        if (consumedIds.length > 0) {
          await fetch("/api/novachat/pending", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds: consumedIds }),
          }).catch(() => {})
        }
        return consumedIds.length
      } catch (error) {
        const errorName = error instanceof Error ? error.name : ""
        if (controller.signal.aborted || errorName === "AbortError") return 0
        return schedulePendingRetry({
          message: "Pending queue error. Retrying.",
        })
      } finally {
        pendingMessagesInFlightRef.current = false
        pendingPollAbortRef.current = null
        pendingPollPromiseRef.current = null
      }
    })()
    pendingPollPromiseRef.current = run
    return run
  }, [
    activeUserIdRef,
    createServerConversation,
    isLoaded,
    latestConversationsRef,
    persist,
    setPendingQueueStatusSafe,
    syncServerMessages,
    tryAcquirePendingPollLease,
  ])

  useEffect(() => {
    if (!isLoaded) return
    if (shouldOpenPendingNovaChat) return
    void processPendingNovaChatMessages()
    const intervalId = window.setInterval(() => {
      void processPendingNovaChatMessages()
    }, Math.max(5000, defaultPollIntervalMs() * 4))
    return () => {
      window.clearInterval(intervalId)
    }
  }, [isLoaded, processPendingNovaChatMessages, shouldOpenPendingNovaChat])

  return {
    pendingQueueStatus,
    processPendingNovaChatMessages,
    pendingRedirectTimerRef,
    pendingPollBackoffAttemptsRef,
  }
}
