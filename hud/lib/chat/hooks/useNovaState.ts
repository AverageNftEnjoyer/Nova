import { useEffect, useState, useRef, useCallback } from "react";

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

const HUD_USER_ECHO_DEDUPE_MS = 15_000
const EVENT_DEDUPE_MS = 2_500

function normalizeInboundMessageText(content: string): string {
  return String(content || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [thinkingStatus, setThinkingStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [latestUsage, setLatestUsage] = useState<AgentUsage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recentEventRef = useRef<Map<string, number>>(new Map())
  const lastAssistantDeltaRef = useRef<Map<string, { content: string; ts: number }>>(new Map())

  useEffect(() => {
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

    const ws = new WebSocket("ws://localhost:8765");
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

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
          setStreamingAssistantId(data.id);
          lastAssistantDeltaRef.current.delete(data.id)
          const msg: AgentMessage = {
            id: data.id,
            role: "assistant",
            content: "",
            ts: Number(data.ts || Date.now()),
            source: data.source || "voice",
            sender: data.sender,
          };
          setAgentMessages((prev) => [...prev, msg]);
        }

        if (data.type === "assistant_stream_done" && typeof data.id === "string") {
          setStreamingAssistantId((prev) => (prev === data.id ? null : prev));
          lastAssistantDeltaRef.current.delete(data.id)
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
          const dedupeContent = normalizeInboundMessageText(normalizedContent)
          const now = Date.now()
          const previousDelta = lastAssistantDeltaRef.current.get(data.id)
          if (
            previousDelta &&
            previousDelta.content === dedupeContent &&
            now - previousDelta.ts <= EVENT_DEDUPE_MS
          ) {
            return
          }
          lastAssistantDeltaRef.current.set(data.id, { content: dedupeContent, ts: now })
          if (markRecentEvent(`assistant_delta:${data.id}:${dedupeContent}`, EVENT_DEDUPE_MS)) {
            return
          }

          const msg: AgentMessage = {
            id: data.id,
            role: "assistant",
            content: normalizedContent,
            ts: Number(data.ts || Date.now()),
            source: data.source || "voice",
            sender: data.sender,
          };

          setAgentMessages((prev) => [...prev, msg]);
        }

        if (
          data.type === "message" &&
          (data.role === "user" || data.role === "assistant") &&
          typeof data.content === "string"
        ) {
          const normalizedContent = data.content.replace(/\r\n/g, "\n");
          const normalizedForDedupe = normalizeInboundMessageText(normalizedContent)
          if (!normalizedForDedupe) return
          if (
            data.role === "user" &&
            (data.source === "hud" || data.sender === "hud-user")
          ) {
            if (markRecentEvent(`hud_user_echo:${normalizedForDedupe}`, HUD_USER_ECHO_DEDUPE_MS)) {
              return
            }
            return
          }
          if (data.role === "assistant" && !hasAssistantPayload(normalizedContent)) {
            return;
          }
          if (
            data.role === "assistant" &&
            markRecentEvent(`assistant_msg:${normalizedForDedupe}`, EVENT_DEDUPE_MS)
          ) {
            return
          }

          const msg: AgentMessage = {
            id: `agent-${data.ts}-${Math.random().toString(36).slice(2, 7)}`,
            role: data.role,
            content: normalizedContent,
            ts: data.ts,
            source: data.source || "voice",
            sender: data.sender,
          };

          setAgentMessages((prev) => [...prev, msg]);
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
    };

    return () => ws.close();
  }, []);

  const sendToAgent = useCallback((
    text: string,
    voice: boolean = true,
    ttsVoice: string = "default",
    options?: {
      conversationId?: string
      sender?: string
      sessionKey?: string
      messageId?: string
      userId?: string
      supabaseAccessToken?: string
      assistantName?: string
      communicationStyle?: string
      tone?: string
      customInstructions?: string
    },
  ) => {
    const ws = wsRef.current;
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
          ...(options?.userId ? { userId: options.userId } : {}),
          ...(options?.supabaseAccessToken ? { supabaseAccessToken: options.supabaseAccessToken } : {}),
          ...(options?.assistantName ? { assistantName: options.assistantName } : {}),
          ...(options?.communicationStyle ? { communicationStyle: options.communicationStyle } : {}),
          ...(options?.tone ? { tone: options.tone } : {}),
          ...(options?.customInstructions ? { customInstructions: options.customInstructions } : {}),
        }),
      );
    }
  }, []);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt" }));
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "greeting",
        text,
        ttsVoice,
        voiceEnabled,
        ...(assistantName ? { assistantName } : {}),
      }));
    }
  }, []);

  const setVoicePreference = useCallback((ttsVoice: string, voiceEnabled?: boolean, assistantName?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: { type: string; ttsVoice: string; voiceEnabled?: boolean; assistantName?: string } = { type: "set_voice", ttsVoice };
      if (typeof voiceEnabled === "boolean") {
        payload.voiceEnabled = voiceEnabled;
      }
      if (assistantName) {
        payload.assistantName = assistantName;
      }
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set_mute", muted }));
    }
  }, []);

  return {
    state,
    thinkingStatus,
    connected,
    agentMessages,
    streamingAssistantId,
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
