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

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [transcript, setTranscript] = useState("");
  const [latestUsage, setLatestUsage] = useState<AgentUsage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8765");
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === "state" && data.state) {
          setState(data.state);
        }

        if (data.type === "transcript") {
          setTranscript(data.text || "");
        }

        if (
          data.type === "message" &&
          (data.role === "user" || data.role === "assistant") &&
          typeof data.content === "string"
        ) {
          const normalizedContent = data.content.replace(/\r\n/g, "\n");
          // Ignore empty assistant payloads from transport-level placeholders.
          if (data.role === "assistant" && normalizedContent.trim().length === 0) {
            return;
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

  const sendToAgent = useCallback((text: string, voice: boolean = true, ttsVoice: string = "default") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "hud_message", content: text, voice, ttsVoice }));
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
  }, []);

  const sendGreeting = useCallback((text: string, ttsVoice: string = "default", voiceEnabled: boolean = true) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "greeting", text, ttsVoice, voiceEnabled }));
    }
  }, []);

  const setVoicePreference = useCallback((ttsVoice: string, voiceEnabled?: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: { type: string; ttsVoice: string; voiceEnabled?: boolean } = { type: "set_voice", ttsVoice };
      if (typeof voiceEnabled === "boolean") {
        payload.voiceEnabled = voiceEnabled;
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
    connected,
    agentMessages,
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
