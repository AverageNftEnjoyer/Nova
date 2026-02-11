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
  source?: "voice" | "hud" | "telegram" | "telegram_history";
  sender?: string;
}

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [telegramMessages, setTelegramMessages] = useState<AgentMessage[]>([]);
  const [transcript, setTranscript] = useState("");
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

          // Separate Telegram messages from regular messages
          if (data.source === "telegram") {
            setTelegramMessages((prev) => [...prev, msg]);
          } else {
            setAgentMessages((prev) => [...prev, msg]);
          }
        }

        // Handle history sync from Telegram
        if (data.type === "history_sync" && Array.isArray(data.messages)) {
          const historyMsgs: AgentMessage[] = data.messages
            .filter((m: any) => m?.source === "telegram")
            .map((m: any) => ({
              id: `history-${m.ts}-${Math.random().toString(36).slice(2, 7)}`,
              role: m.role,
              content: m.content,
              ts: m.ts,
              source: "telegram_history",
              sender: m.sender,
            }));
          setTelegramMessages((prev) => {
            // Merge history, avoiding duplicates by timestamp
            const existingTs = new Set(prev.map(p => p.ts));
            const newMsgs = historyMsgs.filter(m => !existingTs.has(m.ts));
            return [...newMsgs, ...prev].sort((a, b) => a.ts - b.ts);
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

  const clearTelegramMessages = useCallback(() => {
    setTelegramMessages([]);
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

  return { state, connected, agentMessages, telegramMessages, sendToAgent, interrupt, clearAgentMessages, clearTelegramMessages, transcript, sendGreeting, setVoicePreference, setMuted };
}
