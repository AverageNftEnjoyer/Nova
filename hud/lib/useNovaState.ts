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
}

export function useNovaState() {
  const [state, setState] = useState<NovaState>("idle");
  const [connected, setConnected] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [partyMode, setPartyMode] = useState(false);
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

        if (data.type === "message" && data.role && data.content) {
          const msg: AgentMessage = {
            id: `agent-${data.ts}-${Math.random().toString(36).slice(2, 7)}`,
            role: data.role,
            content: data.content,
            ts: data.ts,
          };
          setAgentMessages((prev) => [...prev, msg]);
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  const sendToAgent = useCallback((text: string, voice: boolean = true) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "hud_message", content: text, voice }));
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

  const stopParty = useCallback(() => setPartyMode(false), []);

  return { state, connected, agentMessages, sendToAgent, interrupt, clearAgentMessages, partyMode, stopParty };
}
