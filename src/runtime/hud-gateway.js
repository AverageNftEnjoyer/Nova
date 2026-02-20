// ===== HUD WebSocket Gateway =====
// WebSocket server on port 8765, all broadcast helpers, and incoming message routing.
// Uses handleInput injection to break the circular dep with chat-handler.

import { getSystemMetrics } from "../compat/metrics.js";
import { describeUnknownError, toErrorDetails } from "../providers/runtime-compat.js";
import { sessionRuntime, wakeWordRuntime } from "./config.js";
import { VOICE_AFTER_TTS_SUPPRESS_MS } from "./constants.js";
import { WebSocketServer } from "ws";
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
} from "../compat/voice.js";

let _handleInput = null;
export function registerHandleInput(fn) { _handleInput = fn; }

let wss = null;
const wsUserRateWindow = new Map();

const WS_MAX_PAYLOAD_BYTES = Math.max(
  8 * 1024,
  Math.min(
    1024 * 1024,
    Number.parseInt(process.env.NOVA_WS_MAX_PAYLOAD_BYTES || String(256 * 1024), 10) || 256 * 1024,
  ),
);
const WS_CONN_RATE_WINDOW_MS = Math.max(
  1_000,
  Math.min(
    120_000,
    Number.parseInt(process.env.NOVA_WS_MESSAGE_RATE_LIMIT_WINDOW_MS || "10000", 10) || 10_000,
  ),
);
const WS_CONN_RATE_MAX = Math.max(
  1,
  Math.min(
    500,
    Number.parseInt(process.env.NOVA_WS_MESSAGE_RATE_LIMIT_MAX || "35", 10) || 35,
  ),
);
const WS_USER_RATE_WINDOW_MS = Math.max(
  1_000,
  Math.min(
    120_000,
    Number.parseInt(process.env.NOVA_WS_USER_MESSAGE_RATE_LIMIT_WINDOW_MS || "10000", 10) || 10_000,
  ),
);
const WS_USER_RATE_MAX = Math.max(
  1,
  Math.min(
    500,
    Number.parseInt(process.env.NOVA_WS_USER_MESSAGE_RATE_LIMIT_MAX || "20", 10) || 20,
  ),
);
const WS_USER_RATE_GC_MS = Math.max(
  10_000,
  Math.min(
    600_000,
    Number.parseInt(process.env.NOVA_WS_USER_RATE_LIMIT_GC_MS || "60000", 10) || 60_000,
  ),
);

let lastWsUserRateGcAt = 0;

function checkWindowRateLimit(state, nowMs, max, windowMs) {
  if (nowMs >= state.resetAt) {
    state.count = 0;
    state.resetAt = nowMs + windowMs;
  }
  const nextCount = state.count + 1;
  if (nextCount > max) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, state.resetAt - nowMs),
    };
  }
  state.count = nextCount;
  return {
    allowed: true,
    retryAfterMs: 0,
  };
}

function maybeGcWsUserRateStore(nowMs) {
  if (nowMs - lastWsUserRateGcAt < WS_USER_RATE_GC_MS) return;
  lastWsUserRateGcAt = nowMs;
  for (const [key, state] of wsUserRateWindow.entries()) {
    if (!state || state.resetAt <= nowMs) wsUserRateWindow.delete(key);
  }
}

function checkWsUserRateLimit(userId) {
  const scope = sessionRuntime.normalizeUserContextId(userId || "");
  if (!scope) return { allowed: true, retryAfterMs: 0 };
  const nowMs = Date.now();
  maybeGcWsUserRateStore(nowMs);
  const key = `hud:${scope}`;
  const existing = wsUserRateWindow.get(key) || { count: 0, resetAt: nowMs + WS_USER_RATE_WINDOW_MS };
  const result = checkWindowRateLimit(existing, nowMs, WS_USER_RATE_MAX, WS_USER_RATE_WINDOW_MS);
  wsUserRateWindow.set(key, existing);
  return result;
}

export function broadcast(payload) {
  if (!wss || !wss.clients) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

export function broadcastState(state) {
  broadcast({ type: "state", state, ts: Date.now() });
}

export function broadcastThinkingStatus(status = "") {
  broadcast({ type: "thinking_status", status: String(status || ""), ts: Date.now() });
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

export function startGateway() {
  try {
    wss = new WebSocketServer({ port: 8765, maxPayload: WS_MAX_PAYLOAD_BYTES });
  } catch (err) {
    const details = describeUnknownError(err);
    console.error(`[Gateway] Failed to start HUD WebSocket server on port 8765: ${details}`);
    console.error("[Gateway] Another process may be using port 8765. Stop existing Nova/agent processes and retry.");
    process.exit(1);
  }

  wss.on("connection", (ws) => {
    const connectionRateState = {
      count: 0,
      resetAt: Date.now() + WS_CONN_RATE_WINDOW_MS,
    };

    void getSystemMetrics()
      .then((metrics) => {
        if (!metrics || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: "system_metrics", metrics, ts: Date.now() }));
      })
      .catch(() => {});

    ws.on("message", async (raw) => {
      try {
        const connRate = checkWindowRateLimit(
          connectionRateState,
          Date.now(),
          WS_CONN_RATE_MAX,
          WS_CONN_RATE_WINDOW_MS,
        );
        if (!connRate.allowed) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "rate_limited",
              scope: "connection",
              retryAfterMs: connRate.retryAfterMs,
              message: "Too many websocket messages. Please slow down.",
              ts: Date.now(),
            }));
          }
          return;
        }

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
          if (typeof data.assistantName === "string" && data.assistantName.trim()) {
            wakeWordRuntime.setAssistantName(data.assistantName);
          }
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
          const userRate = checkWsUserRateLimit(typeof data.userId === "string" ? data.userId : "");
          if (!userRate.allowed) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: "rate_limited",
                scope: "user",
                retryAfterMs: userRate.retryAfterMs,
                message: "Too many messages from this user. Please slow down.",
                ts: Date.now(),
              }));
            }
            return;
          }

          if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
            setCurrentVoice(data.ttsVoice);
            console.log("[Voice] Preference updated to:", getCurrentVoice());
          }
          console.log("[HUD ->]", data.content, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
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
              inboundMessageId:
                typeof data.messageId === "string"
                  ? data.messageId
                  : typeof data.clientMessageId === "string"
                    ? data.clientMessageId
                    : "",
              userContextId: incomingUserId || undefined,
              supabaseAccessToken:
                typeof data.supabaseAccessToken === "string"
                  ? data.supabaseAccessToken
                  : "",
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
          if (typeof data.assistantName === "string" && data.assistantName.trim()) {
            wakeWordRuntime.setAssistantName(data.assistantName);
          }
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
