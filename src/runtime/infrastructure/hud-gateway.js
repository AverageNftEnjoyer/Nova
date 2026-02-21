// ===== HUD WebSocket Gateway =====
// WebSocket server on port 8765, all broadcast helpers, and incoming message routing.
// Uses handleInput injection to break the circular dep with chat-handler.

import { getSystemMetrics } from "../../compat/metrics.js";
import { describeUnknownError, toErrorDetails } from "../../providers/runtime-compat.js";
import { sessionRuntime, wakeWordRuntime } from "../core/config.js";
import { VOICE_AFTER_TTS_SUPPRESS_MS } from "../core/constants.js";
import { WebSocketServer } from "ws";
import { createRequestScheduler } from "./request-scheduler.js";
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
} from "../../compat/voice.js";

let _handleInput = null;
export function registerHandleInput(fn) { _handleInput = fn; }

let wss = null;
const wsUserRateWindow = new Map();
const wsByUserContext = new Map();
const wsContextBySocket = new WeakMap();
const conversationOwnerById = new Map();
const hudOpTokenStateByKey = new Map();
const hudRequestScheduler = createRequestScheduler();
let hudWorkInFlight = 0;

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
const CONVERSATION_OWNER_TTL_MS = Math.max(
  60_000,
  Math.min(
    24 * 60 * 60 * 1000,
    Number.parseInt(process.env.NOVA_CONVERSATION_OWNER_TTL_MS || String(6 * 60 * 60 * 1000), 10) || 6 * 60 * 60 * 1000,
  ),
);
const HUD_OP_TOKEN_TTL_MS = Math.max(
  60_000,
  Math.min(
    60 * 60 * 1000,
    Number.parseInt(process.env.NOVA_HUD_OP_TOKEN_TTL_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000,
  ),
);

let lastHudOpTokenGcAt = 0;

let lastWsUserRateGcAt = 0;
let lastConversationOwnerGcAt = 0;

function normalizeUserContextId(value) {
  return sessionRuntime.normalizeUserContextId(String(value || ""));
}

function bindSocketToUserContext(ws, userContextId) {
  const nextContextId = normalizeUserContextId(userContextId);
  if (!nextContextId || !ws) return "";
  const currentContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
  if (currentContextId && currentContextId !== nextContextId) {
    const prevSet = wsByUserContext.get(currentContextId);
    if (prevSet) {
      prevSet.delete(ws);
      if (prevSet.size === 0) wsByUserContext.delete(currentContextId);
    }
  }
  let targetSet = wsByUserContext.get(nextContextId);
  if (!targetSet) {
    targetSet = new Set();
    wsByUserContext.set(nextContextId, targetSet);
  }
  targetSet.add(ws);
  wsContextBySocket.set(ws, nextContextId);
  return nextContextId;
}

function unbindSocketFromUserContext(ws) {
  const currentContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
  if (!currentContextId) return;
  const targetSet = wsByUserContext.get(currentContextId);
  if (targetSet) {
    targetSet.delete(ws);
    if (targetSet.size === 0) wsByUserContext.delete(currentContextId);
  }
  wsContextBySocket.delete(ws);
}

function gcConversationOwners(nowMs = Date.now()) {
  if (nowMs - lastConversationOwnerGcAt < 60_000) return;
  lastConversationOwnerGcAt = nowMs;
  for (const [conversationId, meta] of conversationOwnerById.entries()) {
    if (!meta || nowMs - Number(meta.updatedAt || 0) > CONVERSATION_OWNER_TTL_MS) {
      conversationOwnerById.delete(conversationId);
    }
  }
}

function trackConversationOwner(conversationId, userContextId) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  if (!normalizedConversationId || !normalizedUserContextId) return;
  conversationOwnerById.set(normalizedConversationId, {
    userContextId: normalizedUserContextId,
    updatedAt: Date.now(),
  });
}

function resolveConversationOwner(conversationId) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId) return "";
  gcConversationOwners();
  const meta = conversationOwnerById.get(normalizedConversationId);
  if (!meta) return "";
  if (Date.now() - Number(meta.updatedAt || 0) > CONVERSATION_OWNER_TTL_MS) {
    conversationOwnerById.delete(normalizedConversationId);
    return "";
  }
  return normalizeUserContextId(meta.userContextId);
}

function resolveEventUserContextId(userContextId, conversationId = "") {
  const explicit = normalizeUserContextId(userContextId);
  if (explicit) return explicit;
  return resolveConversationOwner(conversationId);
}

function markHudWorkStart() {
  hudWorkInFlight += 1;
  if (!getBusy()) setBusy(true);
}

function markHudWorkEnd() {
  hudWorkInFlight = Math.max(0, hudWorkInFlight - 1);
  if (hudWorkInFlight === 0) setBusy(false);
}

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

function normalizeHudOpToken(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length > 160) return "";
  return normalized;
}

function buildHudOpTokenKey(userContextId, opToken) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  const normalizedOpToken = normalizeHudOpToken(opToken);
  if (!normalizedUserContextId || !normalizedOpToken) return "";
  return `${normalizedUserContextId}:${normalizedOpToken}`;
}

function gcHudOpTokenStore(nowMs = Date.now()) {
  if (nowMs - lastHudOpTokenGcAt < 30_000) return;
  lastHudOpTokenGcAt = nowMs;
  for (const [key, entry] of hudOpTokenStateByKey.entries()) {
    if (!entry || nowMs - Number(entry.updatedAt || 0) > HUD_OP_TOKEN_TTL_MS) {
      hudOpTokenStateByKey.delete(key);
    }
  }
}

function reserveHudOpToken(userContextId, opToken, conversationId = "") {
  const key = buildHudOpTokenKey(userContextId, opToken);
  if (!key) return { status: "disabled", key: "", conversationId: "" };

  const normalizedConversationId = normalizeConversationId(conversationId);
  const nowMs = Date.now();
  gcHudOpTokenStore(nowMs);

  const existing = hudOpTokenStateByKey.get(key);
  if (existing && nowMs - Number(existing.updatedAt || 0) <= HUD_OP_TOKEN_TTL_MS) {
    return {
      status: existing.status === "accepted" ? "duplicate_accepted" : "duplicate_pending",
      key,
      conversationId: String(existing.conversationId || normalizedConversationId || ""),
    };
  }

  hudOpTokenStateByKey.set(key, {
    status: "pending",
    updatedAt: nowMs,
    conversationId: normalizedConversationId,
  });
  return { status: "reserved", key, conversationId: normalizedConversationId };
}

function markHudOpTokenAccepted(key, conversationId = "") {
  if (!key) return;
  const existing = hudOpTokenStateByKey.get(key);
  if (!existing) return;
  existing.status = "accepted";
  existing.updatedAt = Date.now();
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (normalizedConversationId) existing.conversationId = normalizedConversationId;
  hudOpTokenStateByKey.set(key, existing);
}

function releaseHudOpTokenReservation(key) {
  if (!key) return;
  hudOpTokenStateByKey.delete(key);
}

function sendHudMessageAck(ws, {
  opToken = "",
  conversationId = "",
  userContextId = "",
  duplicate = false,
} = {}) {
  const normalizedOpToken = normalizeHudOpToken(opToken);
  if (!normalizedOpToken || !ws || ws.readyState !== 1) return;
  const normalizedConversationId = normalizeConversationId(conversationId);
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  ws.send(JSON.stringify({
    type: "hud_message_ack",
    opToken: normalizedOpToken,
    ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
    ...(normalizedUserContextId ? { userContextId: normalizedUserContextId } : {}),
    duplicate: duplicate === true,
    ts: Date.now(),
  }));
}

export function broadcast(payload, opts = {}) {
  if (!wss || !wss.clients) return;
  const targetUserContextId = resolveEventUserContextId(
    opts.userContextId ?? payload?.userContextId,
    opts.conversationId ?? payload?.conversationId,
  );
  const nextPayload = targetUserContextId && !payload?.userContextId
    ? { ...payload, userContextId: targetUserContextId }
    : payload;
  const msg = JSON.stringify(nextPayload);
  if (targetUserContextId) {
    const scopedSockets = wsByUserContext.get(targetUserContextId);
    if (!scopedSockets || scopedSockets.size === 0) return;
    for (const socket of scopedSockets) {
      if (socket?.readyState === 1) socket.send(msg);
    }
    return;
  }
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

export function broadcastState(state, userContextId = "") {
  const resolvedUserContextId = resolveEventUserContextId(userContextId);
  broadcast(
    {
      type: "state",
      state,
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId },
  );
}

export function broadcastThinkingStatus(status = "", userContextId = "") {
  const resolvedUserContextId = resolveEventUserContextId(userContextId);
  broadcast(
    {
      type: "thinking_status",
      status: String(status || ""),
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId },
  );
}

function normalizeConversationId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "";
}

function classifyHudRequestLane(text) {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return "default";
  if (/^(hey|hi|hello|yo|sup|ping|ok|okay|thanks|thank you|good morning|good afternoon|good evening|you there)\b/.test(normalized)) {
    return "fast";
  }
  if (/\b(mission|workflow|automation|schedule|scheduler|build mission|create mission|daily brief|weekly report)\b/.test(normalized)) {
    return "background";
  }
  if (/\b(weather|forecast|web|search|browse|latest|news|price|scores?|http|https|tool|command|terminal|shell|run |execute )\b/.test(normalized)) {
    return "tool";
  }
  return "default";
}

export function broadcastMessage(
  role,
  content,
  source = "hud",
  conversationId = undefined,
  userContextId = "",
  meta = undefined,
) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const resolvedUserContextId = resolveEventUserContextId(userContextId, normalizedConversationId);
  const safeMeta = meta && typeof meta === "object" ? meta : undefined;
  broadcast(
    {
      type: "message",
      role,
      content,
      source,
      ...(safeMeta ? { meta: safeMeta } : {}),
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId, conversationId: normalizedConversationId },
  );
}

export function createAssistantStreamId() {
  return `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function broadcastAssistantStreamStart(id, source = "hud", sender = undefined, conversationId = undefined, userContextId = "") {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const resolvedUserContextId = resolveEventUserContextId(userContextId, normalizedConversationId);
  broadcast(
    {
      type: "assistant_stream_start",
      id,
      source,
      sender,
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId, conversationId: normalizedConversationId },
  );
}

export function broadcastAssistantStreamDelta(id, content, source = "hud", sender = undefined, conversationId = undefined, userContextId = "") {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const resolvedUserContextId = resolveEventUserContextId(userContextId, normalizedConversationId);
  broadcast(
    {
      type: "assistant_stream_delta",
      id,
      content,
      source,
      sender,
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId, conversationId: normalizedConversationId },
  );
}

export function broadcastAssistantStreamDone(id, source = "hud", sender = undefined, conversationId = undefined, userContextId = "") {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const resolvedUserContextId = resolveEventUserContextId(userContextId, normalizedConversationId);
  broadcast(
    {
      type: "assistant_stream_done",
      id,
      source,
      sender,
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
      ...(resolvedUserContextId ? { userContextId: resolvedUserContextId } : {}),
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId, conversationId: normalizedConversationId },
  );
}

function sendHudStreamError(conversationId, text, ws = null, retryAfterMs = 0, userContextId = "") {
  const resolvedUserContextId = resolveEventUserContextId(userContextId, conversationId);
  if (!resolvedUserContextId && ws && ws.readyState === 1) {
    const streamId = createAssistantStreamId();
    const ts = Date.now();
    ws.send(JSON.stringify({ type: "assistant_stream_start", id: streamId, source: "hud", ...(conversationId ? { conversationId } : {}), ts }));
    ws.send(JSON.stringify({ type: "assistant_stream_delta", id: streamId, content: String(text || "Request failed."), source: "hud", ...(conversationId ? { conversationId } : {}), ts: Date.now() }));
    ws.send(JSON.stringify({ type: "assistant_stream_done", id: streamId, source: "hud", ...(conversationId ? { conversationId } : {}), ts: Date.now() }));
    if (retryAfterMs > 0) {
      ws.send(JSON.stringify({
        type: "busy",
        retryAfterMs: Math.max(0, Number(retryAfterMs || 0)),
        ts: Date.now(),
      }));
    }
    return;
  }
  const streamId = createAssistantStreamId();
  broadcastAssistantStreamStart(streamId, "hud", undefined, conversationId, resolvedUserContextId);
  broadcastAssistantStreamDelta(streamId, String(text || "Request failed."), "hud", undefined, conversationId, resolvedUserContextId);
  broadcastAssistantStreamDone(streamId, "hud", undefined, conversationId, resolvedUserContextId);
  if (ws && ws.readyState === 1 && retryAfterMs > 0) {
    ws.send(JSON.stringify({
      type: "busy",
      retryAfterMs: Math.max(0, Number(retryAfterMs || 0)),
      ts: Date.now(),
    }));
  }
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
        ws.send(JSON.stringify({
          type: "system_metrics",
          metrics,
          scheduler: hudRequestScheduler.getSnapshot(),
          ts: Date.now(),
        }));
      })
      .catch(() => {});

    ws.on("close", () => {
      unbindSocketFromUserContext(ws);
    });

    ws.on("error", () => {
      unbindSocketFromUserContext(ws);
    });

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
        const envelopeUserContextId = normalizeUserContextId(
          typeof data.userId === "string" ? data.userId : "",
        );
        if (envelopeUserContextId) bindSocketToUserContext(ws, envelopeUserContextId);

        if (data.type === "interrupt") {
          console.log("[HUD] Interrupt received.");
          stopSpeaking();
          return;
        }

        if (data.type === "request_system_metrics") {
          const metrics = await getSystemMetrics();
          if (metrics && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "system_metrics",
              metrics,
              scheduler: hudRequestScheduler.getSnapshot(),
              ts: Date.now(),
            }));
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
              const scopedUserContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
              broadcastState("speaking", scopedUserContextId);
              await speak(greetingText, getCurrentVoice());
              broadcastState("idle", scopedUserContextId);
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
          const conversationId = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
          const incomingUserId = sessionRuntime.normalizeUserContextId(
            typeof data.userId === "string" ? data.userId : "",
          );
          bindSocketToUserContext(ws, incomingUserId);
          if (conversationId && incomingUserId) trackConversationOwner(conversationId, incomingUserId);
          console.log("[HUD ->]", data.content, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
          if (data.voice !== false) stopSpeaking();

          if (!incomingUserId) {
            sendHudStreamError(
              conversationId,
              "Request blocked: missing user identity. Please sign in again and retry.",
              ws,
              0,
              incomingUserId,
            );
            broadcastState("idle", incomingUserId);
            return;
          }

          const opToken = normalizeHudOpToken(typeof data.opToken === "string" ? data.opToken : "");
          let reservedOpTokenKey = "";
          let opTokenAccepted = false;
          if (opToken) {
            const reservation = reserveHudOpToken(incomingUserId, opToken, conversationId);
            if (reservation.status === "duplicate_accepted") {
              sendHudMessageAck(ws, {
                opToken,
                conversationId: reservation.conversationId || conversationId,
                userContextId: incomingUserId,
                duplicate: true,
              });
              return;
            }
            if (reservation.status === "duplicate_pending") {
              return;
            }
            if (reservation.status === "reserved") {
              reservedOpTokenKey = reservation.key;
            }
          }

          try {
            const lane = classifyHudRequestLane(data.content);
            await hudRequestScheduler.enqueue({
              lane,
              userId: incomingUserId,
              conversationId: conversationId || "",
              supersedeKey: conversationId || "",
              run: async () => {
                if (opToken && reservedOpTokenKey && !opTokenAccepted) {
                  markHudOpTokenAccepted(reservedOpTokenKey, conversationId);
                  opTokenAccepted = true;
                  sendHudMessageAck(ws, {
                    opToken,
                    conversationId,
                    userContextId: incomingUserId,
                    duplicate: false,
                  });
                }
                markHudWorkStart();
                try {
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
                    nlpBypass: data.nlpBypass === true,
                    conversationId: conversationId || undefined,
                    sessionKeyHint:
                      typeof data.sessionKey === "string"
                        ? data.sessionKey
                        : conversationId
                          ? incomingUserId
                            ? `agent:nova:hud:user:${incomingUserId}:dm:${conversationId}`
                            : `agent:nova:hud:dm:${conversationId}`
                          : undefined,
                  });
                } finally {
                  markHudWorkEnd();
                }
              },
            });
          } catch (err) {
            if (reservedOpTokenKey && !opTokenAccepted) {
              releaseHudOpTokenReservation(reservedOpTokenKey);
            }
            const details = toErrorDetails(err);
            const code = String(err?.code || details.code || "").trim().toLowerCase();
            const retryAfterMs = Number(err?.retryAfterMs || 0);
            const msg = details.message || "Unexpected runtime failure.";
            if (code === "superseded") {
              sendHudStreamError(
                conversationId,
                "Cancelled previous queued request because a newer message arrived in this chat.",
                ws,
                0,
                incomingUserId,
              );
              broadcastState("idle", incomingUserId);
              return;
            }
            if (code === "queue_full" || code === "queue_stale") {
              sendHudStreamError(
                conversationId,
                code === "queue_stale"
                  ? "Queued request expired before execution. Please retry."
                  : `Nova is busy right now. Please retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`,
                ws,
                retryAfterMs,
                incomingUserId,
              );
              broadcastState("idle", incomingUserId);
              return;
            }
            console.error(
              `[HUD] handleInput failed status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} type=${details.type ?? "n/a"} message=${msg}`,
            );
            sendHudStreamError(
              conversationId,
              `Request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
              ws,
              0,
              incomingUserId,
            );
            broadcastState("idle", incomingUserId);
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
          const scopedUserContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
          if (!getMuted()) {
            setSuppressVoiceWakeUntilMs(Date.now() + Math.max(0, VOICE_AFTER_TTS_SUPPRESS_MS));
            broadcast(
              {
                type: "transcript",
                text: "",
                ...(scopedUserContextId ? { userContextId: scopedUserContextId } : {}),
                ts: Date.now(),
              },
              { userContextId: scopedUserContextId },
            );
          }
          broadcastState(getMuted() ? "muted" : "idle", scopedUserContextId);
        }
      } catch (e) {
        console.error("[WS] Bad message from HUD:", describeUnknownError(e));
      }
    });
  });
}
