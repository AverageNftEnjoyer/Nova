import { useEffect, useState, useRef, useCallback } from "react";
import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user";
import { normalizeHandoffOperationToken } from "@/lib/chat/handoff";
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser";

export type NovaState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  source?: "voice" | "hud";
  sender?: string;
  conversationId?: string;
  nlpCleanText?: string;
  nlpConfidence?: number;
  nlpCorrectionCount?: number;
  nlpBypass?: boolean;
}

export interface AgentUsage {
  provider: "openai" | "claude" | "grok" | "gemini";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  ts: number;
}

function hasAssistantPayload(content: string): boolean {
  return content.replace(/[\u200B-\u200D\uFEFF]/g, "").length > 0;
}

/**
 * Mirrors the backend's repairBrokenReadability + normalizeWhitespace so that
 * streamed assistant text has the same quality as non-streamed replies.
 */
// Units that commonly follow a digit with no space (e.g. "47°F", "100%", "3x").
const DIGIT_LETTER_SKIP_RE = /^(?:°[A-Za-z]|[%x×]|(?:st|nd|rd|th|px|em|rem|ms|fps|GB|MB|KB|TB|GHz|MHz|mph|kph|kmh|mpg|rpm|mm|ml|cm|km|mi|mg|lb|lbs|oz|kg|ft|hr|hrs|min|sec|am|pm|AM|PM|dB|kW|in|k|m|g|L)(?![a-zA-Z]))/

// Protect URLs, markdown links, and inline code spans from boundary insertion.
const PROTECTED_SPAN_RE = /`[^`]+`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g

const SOURCE_META_LINE_RE = /^[ \t]*(?:Confidence|Source|Freshness)\s*:.*$/gm
const SOURCE_META_INLINE_RE = /\s*(?:Confidence|Source|Freshness)\s*:[^.\n]*\.?/g

function repairAssistantReadability(value: string): string {
  let text = String(value || "")
  if (!text || /```/.test(text)) return text

  text = text.replace(SOURCE_META_LINE_RE, "").replace(SOURCE_META_INLINE_RE, "")

  // Stash protected spans so the boundary regexes cannot touch them.
  const stash: string[] = []
  text = text.replace(PROTECTED_SPAN_RE, (m) => {
    stash.push(m)
    return `\x00#${stash.length - 1}#\x00`
  })

  // Insert missing space at camelCase boundary (lowercase→uppercase).
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2")

  // Insert space between letter→digit when not already spaced.
  text = text.replace(/([A-Za-z])(\d)/g, "$1 $2")

  // Insert space between digit→letter, but skip common unit suffixes.
  text = text.replace(/(\d)([A-Za-z°%×])/g, (match, d: string, l: string, offset: number) => {
    if (DIGIT_LETTER_SKIP_RE.test(text.slice(offset + 1))) return match
    return `${d} ${l}`
  })

  // Restore stashed spans.
  text = text.replace(/\x00#(\d+)#\x00/g, (_, idx) => stash[Number(idx)])

  // Ensure bullet items that lost their line break get one restored.
  text = text.replace(/([^\n])(\n?)(- )/g, (m, before, nl, dash) => {
    if (nl) return m
    return `${before}\n${dash}`
  })

  // Long single-line list-like text → break into lines.
  const longSingleLine = text.length > 220 && !/\n/.test(text)
  const listShape = /\b\d+\s+[A-Z]/.test(text) || /(?:\s- )/.test(text)
  if (longSingleLine && listShape) {
    text = text
      .replace(/\s- /g, "\n- ")
      .replace(/(^|[.!?]\s+)(\d+)\s+/g, (_, p1, p2) => `${p1}\n${p2} `)
      .replace(/\s{2,}/g, " ")
  }

  // Collapse excessive blank lines and trailing whitespace on lines.
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return text
}

const HUD_USER_ECHO_DEDUPE_MS = 15_000
const EVENT_DEDUPE_MS = 2_500
const ASSISTANT_MESSAGE_DEDUPE_MS = 12_000
const ASSISTANT_MESSAGE_MERGE_WINDOW_MS = 10_000
const HUD_MESSAGE_ACK_TTL_MS = 10 * 60 * 1000

function normalizeInboundMessageText(content: string): string {
  return String(content || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function shouldPreferIncomingAssistantVersion(base: string, incoming: string): boolean {
  const left = normalizeInboundMessageText(base).toLowerCase()
  const right = normalizeInboundMessageText(incoming).toLowerCase()
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

function normalizeConversationId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeUserContextId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [thinkingStatus, setThinkingStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [latestUsage, setLatestUsage] = useState<AgentUsage | null>(null);
  const [hudMessageAckVersion, setHudMessageAckVersion] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const recentEventRef = useRef<Map<string, number>>(new Map())
  const hudMessageAckRef = useRef<Map<string, number>>(new Map())
  const lastAssistantDeltaRef = useRef<Map<string, { content: string; ts: number }>>(new Map())
  const pendingAssistantDeltasRef = useRef<Map<string, AgentMessage>>(new Map())
  const deltaFlushRafRef = useRef<number | null>(null)
  const streamFloodRef = useRef<{ windowStart: number; count: number }>({ windowStart: 0, count: 0 })
  const activeUserIdRef = useRef<string>("")
  const supabaseAccessTokenRef = useRef<string>("")

  const pruneHudMessageAckMap = useCallback((nowMs = Date.now()) => {
    const ackMap = hudMessageAckRef.current
    for (const [token, ts] of ackMap.entries()) {
      if (nowMs - Number(ts || 0) > HUD_MESSAGE_ACK_TTL_MS) {
        ackMap.delete(token)
      }
    }
  }, [])

  const hasHudMessageAck = useCallback((opToken: string): boolean => {
    const normalizedToken = normalizeHandoffOperationToken(opToken)
    if (!normalizedToken) return false
    pruneHudMessageAckMap(Date.now())
    return hudMessageAckRef.current.has(normalizedToken)
  }, [pruneHudMessageAckMap])

  useEffect(() => {
    if (!hasSupabaseClientConfig || !supabaseBrowser) return
    let mounted = true
    const client = supabaseBrowser

    void client.auth.getSession().then(({ data }) => {
      if (!mounted) return
      supabaseAccessTokenRef.current = String(data.session?.access_token || "").trim()
    }).catch(() => {})

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      supabaseAccessTokenRef.current = String(session?.access_token || "").trim()
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const syncActiveUserId = () => {
      activeUserIdRef.current = normalizeUserContextId(getActiveUserId())
    }
    syncActiveUserId()
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, syncActiveUserId as EventListener)
    const scopedEventTypes = new Set([
      "state",
      "thinking_status",
      "message",
      "assistant_stream_start",
      "assistant_stream_delta",
      "assistant_stream_done",
      "hud_message_ack",
      "usage",
    ])

    const isScopedEventForOtherUser = (payload: Record<string, unknown>): boolean => {
      const eventType = typeof payload.type === "string" ? payload.type : ""
      if (!scopedEventTypes.has(eventType)) return false
      const eventUserId = normalizeUserContextId(payload.userContextId)
      if (!eventUserId) return false
      const activeUserId = activeUserIdRef.current
      if (!activeUserId) return eventUserId.length > 0
      return eventUserId !== activeUserId
    }

    const flushPendingAssistantDeltas = () => {
      deltaFlushRafRef.current = null
      const pending = [...pendingAssistantDeltasRef.current.values()]
      if (pending.length === 0) return
      pendingAssistantDeltasRef.current.clear()
      setAgentMessages((prev) => {
        const next = [...prev]
        for (const deltaMsg of pending) {
          const idx = next.findIndex((entry) => entry.role === "assistant" && entry.id === deltaMsg.id)
          if (idx === -1) {
            next.push(deltaMsg)
            continue
          }
          const existing = next[idx]
          next[idx] = {
            ...existing,
            content: mergeAssistantStreamContent(existing.content, deltaMsg.content),
            ts: Math.max(Number(existing.ts || 0), Number(deltaMsg.ts || 0)),
            source: deltaMsg.source || existing.source,
            sender: deltaMsg.sender || existing.sender,
            ...(deltaMsg.conversationId ? { conversationId: deltaMsg.conversationId } : {}),
          }
        }
        return next
      })
    }

    const scheduleDeltaFlush = () => {
      if (deltaFlushRafRef.current !== null) return
      deltaFlushRafRef.current = window.requestAnimationFrame(flushPendingAssistantDeltas)
    }

    function markRecentEvent(key: string, ttlMs: number): boolean {
      const now = Date.now()
      for (const [existingKey, ts] of recentEventRef.current.entries()) {
        if (now - ts > Math.max(EVENT_DEDUPE_MS, ttlMs)) {
          recentEventRef.current.delete(existingKey)
        }
      }
      const previous = recentEventRef.current.get(key)
      if (typeof previous === "number" && now - previous <= ttlMs) {
        return true
      }
      recentEventRef.current.set(key, now)
      return false
    }

    let isMounted = true
    const reconnectDelay = { ms: 1_000 }
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (!isMounted) return
      const ws = new WebSocket("ws://localhost:8765")
      wsRef.current = ws

      ws.onopen = () => {
        reconnectDelay.ms = 1_000
        setConnected(true)
      }

      ws.onclose = () => {
        setConnected(false)
        setState("idle")
        setThinkingStatus("")
        setStreamingAssistantId(null)
        if (!isMounted) return
        reconnectTimer = setTimeout(() => {
          reconnectDelay.ms = Math.min(reconnectDelay.ms * 2, 30_000)
          connect()
        }, reconnectDelay.ms)
      }

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
        if (isScopedEventForOtherUser(data)) return

        if (data.type === "hud_message_ack") {
          const opToken = normalizeHandoffOperationToken(data.opToken)
          if (!opToken) return
          pruneHudMessageAckMap(Date.now())
          hudMessageAckRef.current.set(opToken, Date.now())
          setHudMessageAckVersion((prev) => prev + 1)
          return
        }

        if (data.type === "state" && data.state) {
          setState(data.state);
          if (data.state !== "thinking") {
            setThinkingStatus("");
          }
        }

        if (data.type === "thinking_status") {
          setThinkingStatus(typeof data.status === "string" ? data.status : "");
        }

        if (data.type === "transcript") {
          setTranscript(data.text || "");
        }

        if (data.type === "assistant_stream_start" && typeof data.id === "string") {
          const conversationId = normalizeConversationId(data.conversationId)
          setStreamingAssistantId(data.id);
          lastAssistantDeltaRef.current.delete(data.id)
          const msg: AgentMessage = {
            id: data.id,
            role: "assistant",
            content: "",
            ts: Number(data.ts || Date.now()),
            source: data.source || "voice",
            sender: data.sender,
            ...(conversationId ? { conversationId } : {}),
          };
          setAgentMessages((prev) => [...prev, msg]);
        }

        if (data.type === "assistant_stream_done" && typeof data.id === "string") {
          const pending = pendingAssistantDeltasRef.current.get(data.id)
          if (pending) pendingAssistantDeltasRef.current.delete(data.id)

          const streamId = data.id
          setAgentMessages((prev) => {
            const withPending = pending
              ? prev.map((entry) => {
                  if (entry.role !== "assistant" || entry.id !== streamId) return entry
                  return {
                    ...entry,
                    content: mergeAssistantStreamContent(entry.content, pending.content),
                    ts: Math.max(Number(entry.ts || 0), Number(pending.ts || 0)),
                    ...(pending.conversationId ? { conversationId: pending.conversationId } : {}),
                  }
                })
              : prev
            let fullContent = ""
            let firstIdx = -1
            const removeSet = new Set<number>()
            for (let i = 0; i < withPending.length; i++) {
              if (withPending[i].role === "assistant" && withPending[i].id === streamId) {
                fullContent = mergeAssistantStreamContent(fullContent, withPending[i].content)
                if (firstIdx === -1) firstIdx = i
                else removeSet.add(i)
              }
            }
            if (firstIdx === -1) return withPending
            const repaired = repairAssistantReadability(fullContent)
            const next: AgentMessage[] = []
            for (let i = 0; i < withPending.length; i++) {
              if (removeSet.has(i)) continue
              next.push(i === firstIdx ? { ...withPending[i], content: repaired } : withPending[i])
            }
            return next
          })

          setStreamingAssistantId((prev) => (prev === streamId ? null : prev));
          lastAssistantDeltaRef.current.delete(streamId)
        }

        if (
          data.type === "assistant_stream_delta" &&
          typeof data.id === "string" &&
          typeof data.content === "string"
        ) {
          const normalizedContent = data.content.replace(/\r\n/g, "\n");
          if (!hasAssistantPayload(normalizedContent)) {
            return;
          }

          // Flood guard: cap deltas to 120 per 4-second window to prevent runaway spam
          const flood = streamFloodRef.current
          const now = Date.now()
          if (now - flood.windowStart > 4_000) {
            flood.windowStart = now
            flood.count = 0
          }
          flood.count += 1
          if (flood.count > 120) return

          const dedupeContent = normalizeInboundMessageText(normalizedContent)
          const deltaTs = Number(data.ts || Date.now())
          const previousDelta = lastAssistantDeltaRef.current.get(data.id)
          if (
            previousDelta &&
            previousDelta.content === dedupeContent &&
            previousDelta.ts === deltaTs
          ) {
            return
          }
          lastAssistantDeltaRef.current.set(data.id, { content: dedupeContent, ts: deltaTs })
          if (markRecentEvent(`assistant_delta:${data.id}:${deltaTs}:${dedupeContent}`, EVENT_DEDUPE_MS)) {
            return
          }

          const conversationId = normalizeConversationId(data.conversationId)
          const ts = deltaTs
          const pending = pendingAssistantDeltasRef.current.get(data.id)
          if (pending) {
            pendingAssistantDeltasRef.current.set(data.id, {
              ...pending,
              content: mergeAssistantStreamContent(pending.content, normalizedContent),
              ts,
              ...(conversationId ? { conversationId } : {}),
            })
          } else {
            pendingAssistantDeltasRef.current.set(data.id, {
              id: data.id,
              role: "assistant",
              content: normalizedContent,
              ts,
              source: data.source || "voice",
              sender: data.sender,
              ...(conversationId ? { conversationId } : {}),
            })
          }
          scheduleDeltaFlush()
        }

        if (
          data.type === "message" &&
          (data.role === "user" || data.role === "assistant") &&
          typeof data.content === "string"
        ) {
          const normalizedContent = data.content.replace(/\r\n/g, "\n");
          const normalizedForDedupe = normalizeInboundMessageText(normalizedContent)
          if (!normalizedForDedupe) return
          const conversationId = normalizeConversationId(data.conversationId)
          const messageTs = Number(data.ts || Date.now())
          if (
            data.role === "user" &&
            (data.source === "hud" || data.sender === "hud-user")
          ) {
            if (markRecentEvent(`hud_user_echo:${normalizedForDedupe}`, HUD_USER_ECHO_DEDUPE_MS)) {
              return
            }
          }
          if (data.role === "assistant" && !hasAssistantPayload(normalizedContent)) {
            return;
          }
          if (
            data.role === "assistant" &&
            markRecentEvent(`assistant_msg:${conversationId}:${normalizedForDedupe}`, ASSISTANT_MESSAGE_DEDUPE_MS)
          ) {
            return
          }

          const messageMeta = data.meta && typeof data.meta === "object" ? data.meta : {}
          const nlpCleanText = typeof messageMeta.nlpCleanText === "string" ? messageMeta.nlpCleanText : undefined
          const nlpConfidenceRaw = Number(messageMeta.nlpConfidence)
          const nlpConfidence = Number.isFinite(nlpConfidenceRaw) ? nlpConfidenceRaw : undefined
          const nlpCorrectionCountRaw = Number(messageMeta.nlpCorrectionCount)
          const nlpCorrectionCount = Number.isFinite(nlpCorrectionCountRaw) ? nlpCorrectionCountRaw : undefined
          const nlpBypass = messageMeta.nlpBypass === true
          const finalContent = data.role === "assistant" ? repairAssistantReadability(normalizedContent) : normalizedContent
          const msg: AgentMessage = {
            id: `agent-${data.ts}-${Math.random().toString(36).slice(2, 7)}`,
            role: data.role,
            content: finalContent,
            ts: messageTs,
            source: data.source === "hud" ? "hud" : "voice",
            sender: data.sender,
            ...(conversationId ? { conversationId } : {}),
            ...(nlpCleanText ? { nlpCleanText } : {}),
            ...(typeof nlpConfidence === "number" ? { nlpConfidence } : {}),
            ...(typeof nlpCorrectionCount === "number" ? { nlpCorrectionCount } : {}),
            ...(nlpBypass ? { nlpBypass: true } : {}),
          };
          setAgentMessages((prev) => {
            if (msg.role !== "assistant") return [...prev, msg]
            for (let i = prev.length - 1; i >= 0; i -= 1) {
              const existing = prev[i]
              if (existing.role !== "assistant") continue
              const existingConversationId = normalizeConversationId(existing.conversationId)
              if (conversationId || existingConversationId) {
                if (!conversationId || !existingConversationId || conversationId !== existingConversationId) continue
              }
              const existingTs = Number(existing.ts || 0)
              const closeInTime = Math.abs(messageTs - existingTs) <= ASSISTANT_MESSAGE_MERGE_WINDOW_MS
              if (!closeInTime) continue
              const sameText = normalizeInboundMessageText(existing.content) === normalizedForDedupe
              const semanticallySame =
                shouldPreferIncomingAssistantVersion(existing.content, finalContent)
                || shouldPreferIncomingAssistantVersion(finalContent, existing.content)
              if (!sameText && !semanticallySame) continue
              const mergedContent = repairAssistantReadability(
                mergeAssistantStreamContent(existing.content, finalContent),
              )
              const next = [...prev]
              next[i] = {
                ...existing,
                content: mergedContent,
                ts: Math.max(existingTs, messageTs),
                source: msg.source || existing.source,
                sender: msg.sender || existing.sender,
                ...(conversationId ? { conversationId } : {}),
                ...(nlpCleanText ? { nlpCleanText } : {}),
                ...(typeof nlpConfidence === "number" ? { nlpConfidence } : {}),
                ...(typeof nlpCorrectionCount === "number" ? { nlpCorrectionCount } : {}),
                ...(nlpBypass ? { nlpBypass: true } : {}),
              }
              return next
            }
            return [...prev, msg]
          });
        }

        if (data.type === "usage" && typeof data.model === "string" && (data.provider === "openai" || data.provider === "claude" || data.provider === "grok" || data.provider === "gemini")) {
          setLatestUsage({
            provider: data.provider,
            model: data.model,
            promptTokens: Number(data.promptTokens || 0),
            completionTokens: Number(data.completionTokens || 0),
            totalTokens: Number(data.totalTokens || 0),
            estimatedCostUsd: typeof data.estimatedCostUsd === "number" ? data.estimatedCostUsd : null,
            ts: Number(data.ts || Date.now()),
          });
        }
      } catch {}
    }
    } // end connect()

    const pendingAssistantDeltas = pendingAssistantDeltasRef.current
    const hudMessageAckMap = hudMessageAckRef.current
    connect()
    return () => {
      isMounted = false
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, syncActiveUserId as EventListener)
      if (deltaFlushRafRef.current !== null) {
        window.cancelAnimationFrame(deltaFlushRafRef.current)
        deltaFlushRafRef.current = null
      }
      pendingAssistantDeltas.clear()
      hudMessageAckMap.clear()
      wsRef.current?.close()
    };
  }, [pruneHudMessageAckMap]);

  const sendToAgent = useCallback((
    text: string,
    voice: boolean = true,
    ttsVoice: string = "default",
    options?: {
      conversationId?: string
      sender?: string
      sessionKey?: string
      messageId?: string
      opToken?: string
      nlpBypass?: boolean
      userId?: string
      supabaseAccessToken?: string
      assistantName?: string
      communicationStyle?: string
      tone?: string
      customInstructions?: string
      proactivity?: string
      humor_level?: string
      risk_tolerance?: string
      structure_preference?: string
      challenge_level?: string
    },
  ) => {
    const ws = wsRef.current;
    const token = supabaseAccessTokenRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "hud_message",
          content: text,
          voice,
          ttsVoice,
          ...(options?.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options?.sender ? { sender: options.sender } : {}),
          ...(options?.sessionKey ? { sessionKey: options.sessionKey } : {}),
          ...(options?.messageId ? { messageId: options.messageId } : {}),
          ...(options?.opToken ? { opToken: options.opToken } : {}),
          ...(options?.nlpBypass ? { nlpBypass: true } : {}),
          ...(options?.userId ? { userId: options.userId } : {}),
          ...(options?.supabaseAccessToken ? { supabaseAccessToken: options.supabaseAccessToken } : token ? { supabaseAccessToken: token } : {}),
          ...(options?.assistantName ? { assistantName: options.assistantName } : {}),
          ...(options?.communicationStyle ? { communicationStyle: options.communicationStyle } : {}),
          ...(options?.tone ? { tone: options.tone } : {}),
          ...(options?.customInstructions ? { customInstructions: options.customInstructions } : {}),
          ...(options?.proactivity ? { proactivity: options.proactivity } : {}),
          ...(options?.humor_level ? { humor_level: options.humor_level } : {}),
          ...(options?.risk_tolerance ? { risk_tolerance: options.risk_tolerance } : {}),
          ...(options?.structure_preference ? { structure_preference: options.structure_preference } : {}),
          ...(options?.challenge_level ? { challenge_level: options.challenge_level } : {}),
        }),
      );
    }
  }, []);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    const token = supabaseAccessTokenRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt", userId: getActiveUserId(), ...(token ? { supabaseAccessToken: token } : {}) }));
    }
  }, []);

  const clearAgentMessages = useCallback(() => {
    setAgentMessages([]);
    setStreamingAssistantId(null);
  }, []);

  const sendGreeting = useCallback((
    text: string,
    ttsVoice: string = "default",
    voiceEnabled: boolean = true,
    assistantName?: string,
  ) => {
    const ws = wsRef.current;
    const token = supabaseAccessTokenRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "greeting",
        text,
        ttsVoice,
        voiceEnabled,
        userId: getActiveUserId(),
        ...(token ? { supabaseAccessToken: token } : {}),
        ...(assistantName ? { assistantName } : {}),
      }));
    }
  }, []);

  const setVoicePreference = useCallback((ttsVoice: string, voiceEnabled?: boolean, assistantName?: string) => {
    const ws = wsRef.current;
    const token = supabaseAccessTokenRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: { type: string; ttsVoice: string; voiceEnabled?: boolean; assistantName?: string; supabaseAccessToken?: string } = { type: "set_voice", ttsVoice };
      (payload as { userId?: string }).userId = getActiveUserId();
      if (token) payload.supabaseAccessToken = token
      if (typeof voiceEnabled === "boolean") {
        payload.voiceEnabled = voiceEnabled;
      }
      if (assistantName) {
        payload.assistantName = assistantName;
      }
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const setMuted = useCallback((muted: boolean, assistantName?: string) => {
    const ws = wsRef.current;
    const token = supabaseAccessTokenRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "set_mute",
        muted,
        userId: getActiveUserId(),
        ...(token ? { supabaseAccessToken: token } : {}),
        ...(assistantName ? { assistantName } : {}),
      }));
    }
  }, []);

  return {
    state,
    thinkingStatus,
    connected,
    agentMessages,
    streamingAssistantId,
    hudMessageAckVersion,
    hasHudMessageAck,
    latestUsage,
    sendToAgent,
    interrupt,
    clearAgentMessages,
    transcript,
    sendGreeting,
    setVoicePreference,
    setMuted,
  };
}
