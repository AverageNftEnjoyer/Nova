import { useEffect, useState, useRef, useCallback } from "react";

export type NovaState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  source?: "voice" | "hud" | "telegram";
  sender?: string;
}

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [telegramMessages, setTelegramMessages] = useState<AgentMessage[]>([]);
  const [partyMode, setPartyMode] = useState(false);
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

        if (data.type === "party") {
          setPartyMode(true);
        }

        if (data.type === "transcript") {
          setTranscript(data.text || "");
        }

        if (data.type === "message" && data.role && data.content) {
          const msg: AgentMessage = {
            id: `agent-${data.ts}-${Math.random().toString(36).slice(2, 7)}`,
            role: data.role,
            content: data.content,
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
          const historyMsgs: AgentMessage[] = data.messages.map((m: any) => ({
            id: `history-${m.ts}-${Math.random().toString(36).slice(2, 7)}`,
            role: m.role,
            content: m.content,
            ts: m.ts,
            source: m.source || "telegram",
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

  const stopParty = useCallback(() => setPartyMode(false), []);

  const sendGreeting = useCallback((text: string, ttsVoice: string = "default") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "greeting", text, ttsVoice }));
    }
  }, []);

  const setVoicePreference = useCallback((ttsVoice: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set_voice", ttsVoice }));
    }
  }, []);

  return { state, connected, agentMessages, telegramMessages, sendToAgent, interrupt, clearAgentMessages, clearTelegramMessages, partyMode, stopParty, transcript, sendGreeting, setVoicePreference };
}
