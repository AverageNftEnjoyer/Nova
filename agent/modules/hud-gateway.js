// ===== HUD WebSocket Gateway =====
// WebSocket server on port 8765, all broadcast helpers, and incoming message routing.
// Uses handleInput injection to break the circular dep with chat-handler.

import { WebSocketServer } from "ws";
import { getSystemMetrics } from "./metrics.js";
import { describeUnknownError, toErrorDetails } from "./providers.js";
import { sessionRuntime } from "./config.js";
import { VOICE_AFTER_TTS_SUPPRESS_MS } from "../constants.js";
import {
  VOICE_MAP,
  getBusy,
  setBusy,
  getCurrentVoice,
  setCurrentVoice,
  getVoiceEnabled,
  setVoiceEnabled,
  getMuted,
  setMuted,
  setSuppressVoiceWakeUntilMs,
  speak,
  stopSpeaking,
} from "./voice.js";

// Injected handleInput — set by agent.js after both modules load
let _handleInput = null;
export function registerHandleInput(fn) { _handleInput = fn; }

let wss = null;

// ===== Broadcast helpers =====
export function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

export function broadcastState(state) {
  broadcast({ type: "state", state, ts: Date.now() });
}

export function broadcastMessage(role, content, source = "hud") {
  broadcast({ type: "message", role, content, source, ts: Date.now() });
}

export function createAssistantStreamId() {
  return `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function broadcastAssistantStreamStart(id, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_start", id, source, sender, ts: Date.now() });
}

export function broadcastAssistantStreamDelta(id, content, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_delta", id, content, source, sender, ts: Date.now() });
}

export function broadcastAssistantStreamDone(id, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_done", id, source, sender, ts: Date.now() });
}

// ===== Gateway startup =====
export function startGateway() {
  try {
    wss = new WebSocketServer({ port: 8765 });
  } catch (err) {
    const details = describeUnknownError(err);
    console.error(`[Gateway] Failed to start HUD WebSocket server on port 8765: ${details}`);
    console.error("[Gateway] Another process may be using port 8765. Stop existing Nova/agent processes and retry.");
    process.exit(1);
  }

  wss.on("connection", (ws) => {
    // Push one metrics snapshot to new clients immediately
    void getSystemMetrics()
      .then((metrics) => {
        if (!metrics || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: "system_metrics", metrics, ts: Date.now() }));
      })
      .catch(() => {});

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === "interrupt") {
          console.log("[HUD] Interrupt received.");
          stopSpeaking();
          return;
        }

        if (data.type === "request_system_metrics") {
          const metrics = await getSystemMetrics();
          if (metrics && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "system_metrics", metrics, ts: Date.now() }));
          }
          return;
        }

        if (data.type === "greeting") {
          console.log("[HUD] Greeting requested. voiceEnabled:", data.voiceEnabled);
          if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
            setCurrentVoice(data.ttsVoice);
            console.log("[Voice] Preference updated to:", getCurrentVoice());
          }
          if (data.voiceEnabled === false || getVoiceEnabled() === false) return;
          if (!getBusy()) {
            setBusy(true);
            try {
              const greetingText = data.text || "Hello! What are we working on today?";
              broadcastState("speaking");
              await speak(greetingText, getCurrentVoice());
              broadcastState("idle");
            } finally {
              setBusy(false);
            }
          }
          return;
        }

        if (data.type === "hud_message" && data.content) {
          if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
            setCurrentVoice(data.ttsVoice);
            console.log("[Voice] Preference updated to:", getCurrentVoice());
          }
          console.log("[HUD →]", data.content, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
          stopSpeaking();
          setBusy(true);
          try {
            const incomingUserId = sessionRuntime.normalizeUserContextId(
              typeof data.userId === "string" ? data.userId : "",
            );
            if (!incomingUserId) {
              const streamId = createAssistantStreamId();
              broadcastAssistantStreamStart(streamId, "hud");
              broadcastAssistantStreamDelta(
                streamId,
                "Request blocked: missing user identity. Please sign in again and retry.",
                "hud",
              );
              broadcastAssistantStreamDone(streamId, "hud");
              broadcastState("idle");
              return;
            }
            await _handleInput(data.content, {
              voice: data.voice !== false,
              ttsVoice: data.ttsVoice || getCurrentVoice(),
              source: "hud",
              sender: typeof data.sender === "string" ? data.sender : "hud-user",
              userContextId: incomingUserId || undefined,
              assistantName: typeof data.assistantName === "string" ? data.assistantName : "",
              communicationStyle: typeof data.communicationStyle === "string" ? data.communicationStyle : "",
              tone: typeof data.tone === "string" ? data.tone : "",
              customInstructions: typeof data.customInstructions === "string" ? data.customInstructions : "",
              sessionKeyHint:
                typeof data.sessionKey === "string"
                  ? data.sessionKey
                  : typeof data.conversationId === "string"
                    ? incomingUserId
                      ? `agent:nova:hud:user:${incomingUserId}:dm:${data.conversationId}`
                      : `agent:nova:hud:dm:${data.conversationId}`
                    : undefined,
            });
          } catch (err) {
            const details = toErrorDetails(err);
            const msg = details.message || "Unexpected runtime failure.";
            console.error(
              `[HUD] handleInput failed status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} type=${details.type ?? "n/a"} message=${msg}`,
            );
            const streamId = createAssistantStreamId();
            broadcastAssistantStreamStart(streamId, "hud");
            broadcastAssistantStreamDelta(
              streamId,
              `Request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
              "hud",
            );
            broadcastAssistantStreamDone(streamId, "hud");
            broadcastState("idle");
          } finally {
            setBusy(false);
          }
        }

        if (data.type === "set_voice") {
          if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
            setCurrentVoice(data.ttsVoice);
            console.log("[Voice] TTS voice set to:", getCurrentVoice());
          }
          if (typeof data.voiceEnabled === "boolean") {
            setVoiceEnabled(data.voiceEnabled);
            console.log("[Voice] Voice responses enabled:", getVoiceEnabled());
          }
        }

        if (data.type === "set_mute") {
          setMuted(data.muted === true);
          console.log("[Nova] Muted:", getMuted());
          if (!getMuted()) {
            setSuppressVoiceWakeUntilMs(Date.now() + Math.max(0, VOICE_AFTER_TTS_SUPPRESS_MS));
            broadcast({ type: "transcript", text: "", ts: Date.now() });
          }
          broadcastState(getMuted() ? "muted" : "idle");
        }
      } catch (e) {
        console.error("[WS] Bad message from HUD:", describeUnknownError(e));
      }
    });
  });
}
