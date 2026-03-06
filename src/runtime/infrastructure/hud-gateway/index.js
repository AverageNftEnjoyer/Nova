// ===== HUD WebSocket Gateway =====
// WebSocket server on port 8765, all broadcast helpers, and incoming message routing.
// Uses handleInput injection to break the circular dep with chat-handler.

import { getSystemMetrics } from "../../../compat/metrics/index.js";
import { describeUnknownError, toErrorDetails } from "../../../providers/runtime-compat/index.js";
import { sessionRuntime, wakeWordRuntime } from "../../core/config/index.js";
import { WebSocketServer } from "ws";
import { createRequestScheduler } from "../request-scheduler/index.js";
import { handleHudGatewayMessage } from "./message-handler/index.js";
import { grantPolicyApproval } from "../../modules/chat/routing/policy-approval-store/index.js";
import { createVoiceProviderAdapter } from "../../modules/services/voice/provider-adapter/index.js";
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
} from "../../../compat/voice/index.js";

let _handleInput = null;
export function registerHandleInput(fn) { _handleInput = fn; }

let wss = null;
const wsUserRateWindow = new Map();
const wsByUserContext = new Map();
const wsContextBySocket = new WeakMap();
let voiceRoutingUserContextId = "";
const wsAuthByToken = new Map();
const conversationOwnerById = new Map();
const hudOpTokenStateByKey = new Map();
const HUD_SENSITIVE_ACTIONS = new Set([
  "gmail_forward_message",
  "gmail_reply_draft",
]);
const hudRequestScheduler = createRequestScheduler();
const voiceProviderAdapter = createVoiceProviderAdapter({
  broadcastState,
  getActiveUserContextId: () => getVoiceRoutingUserContextId(),
});
const hudWorkInFlightByUser = new Map();

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
const WS_AUTH_CACHE_TTL_MS = Math.max(
  30_000,
  Math.min(
    30 * 60 * 1000,
    Number.parseInt(process.env.NOVA_WS_AUTH_CACHE_TTL_MS || String(5 * 60 * 1000), 10) || 5 * 60 * 1000,
  ),
);
const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
const WS_REQUIRE_AUTH = String(
  process.env.NOVA_WS_REQUIRE_AUTH || (SUPABASE_URL && SUPABASE_ANON_KEY ? "1" : "0"),
).trim() !== "0";
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
const HUD_MIN_THINKING_PRESENCE_MS = Math.max(
  0,
  Math.min(
    5_000,
    Number.parseInt(process.env.NOVA_HUD_MIN_THINKING_PRESENCE_MS || "320", 10) || 320,
  ),
);
const SCOPED_ONLY_EVENT_TYPES = new Set([
  "state",
  "thinking_status",
  "message",
  "assistant_stream_start",
  "assistant_stream_delta",
  "assistant_stream_done",
  "usage",
  "calendar:event:updated",
  "calendar:rescheduled",
  "calendar:conflict",
  "youtube:home:updated",
]);
const CALENDAR_EMIT_EVENT_TYPES = new Set([
  "calendar:event:updated",
  "calendar:rescheduled",
  "calendar:conflict",
]);

let lastHudOpTokenGcAt = 0;

let lastWsUserRateGcAt = 0;
let lastConversationOwnerGcAt = 0;
let lastWsAuthGcAt = 0;

function normalizeUserContextId(value) {
  return sessionRuntime.normalizeUserContextId(String(value || ""));
}

function normalizeSupabaseAccessToken(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length > 8192) return "";
  return normalized;
}

function resolveSupabaseUserEndpoint() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";
  return `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`;
}

function gcWsAuthCache(nowMs = Date.now()) {
  if (nowMs - lastWsAuthGcAt < 30_000) return;
  lastWsAuthGcAt = nowMs;
  for (const [token, entry] of wsAuthByToken.entries()) {
    if (!entry || nowMs - Number(entry.updatedAt || 0) > WS_AUTH_CACHE_TTL_MS) {
      wsAuthByToken.delete(token);
    }
  }
}

async function resolveUserContextIdFromSupabaseToken(supabaseAccessToken) {
  const token = normalizeSupabaseAccessToken(supabaseAccessToken);
  if (!token) return "";
  const endpoint = resolveSupabaseUserEndpoint();
  if (!endpoint) return "";

  const nowMs = Date.now();
  gcWsAuthCache(nowMs);
  const cached = wsAuthByToken.get(token);
  if (cached && nowMs - Number(cached.updatedAt || 0) <= WS_AUTH_CACHE_TTL_MS) {
    return normalizeUserContextId(cached.userContextId || "");
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return "";
    const data = await response.json().catch(() => null);
    const resolved = normalizeUserContextId(data?.id || data?.user?.id || "");
    if (!resolved) return "";
    wsAuthByToken.set(token, { userContextId: resolved, updatedAt: nowMs });
    return resolved;
  } catch {
    return "";
  }
}

async function ensureSocketUserContextBinding(
  ws,
  {
    requestedUserContextId = "",
    supabaseAccessToken = "",
  } = {},
) {
  const requested = normalizeUserContextId(requestedUserContextId);
  const existing = normalizeUserContextId(wsContextBySocket.get(ws) || "");
  if (existing) {
    if (requested && requested !== existing) {
      return { ok: false, code: "user_mismatch", message: "Socket already bound to a different user." };
    }
    return { ok: true, userContextId: existing };
  }

  if (!requested) {
    return { ok: false, code: "missing_user", message: "Missing user context identity." };
  }

  if (WS_REQUIRE_AUTH) {
    const resolvedFromToken = await resolveUserContextIdFromSupabaseToken(supabaseAccessToken);
    if (!resolvedFromToken) {
      return {
        ok: false,
        code: "missing_or_invalid_token",
        message: "Missing or invalid Supabase access token for websocket binding.",
      };
    }
    if (resolvedFromToken !== requested) {
      return {
        ok: false,
        code: "token_user_mismatch",
        message: "Token user does not match requested user context.",
      };
    }
  }

  const bound = bindSocketToUserContext(ws, requested);
  if (!bound) {
    return { ok: false, code: "bind_failed", message: "Failed to bind websocket to user context." };
  }
  return { ok: true, userContextId: bound };
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
  voiceRoutingUserContextId = nextContextId;
  voiceProviderAdapter.syncRuntimeForUser(nextContextId, { broadcastRuntimeState: true });
  return nextContextId;
}

function unbindSocketFromUserContext(ws) {
  const currentContextId = normalizeUserContextId(wsContextBySocket.get(ws) || "");
  if (!currentContextId) return;
  const targetSet = wsByUserContext.get(currentContextId);
  if (targetSet) {
    targetSet.delete(ws);
    if (targetSet.size === 0) {
      wsByUserContext.delete(currentContextId);
      // If the disconnecting user was the active voice-routing target and no sockets
      // remain for them, hand off to any other still-connected user or clear entirely.
      if (normalizeUserContextId(voiceRoutingUserContextId) === currentContextId) {
        const next = wsByUserContext.keys().next();
        voiceRoutingUserContextId = next.done ? "" : next.value;
        if (voiceRoutingUserContextId) {
          voiceProviderAdapter.syncRuntimeForUser(voiceRoutingUserContextId, { broadcastRuntimeState: true });
        }
      }
    }
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
  const nowMs = Date.now();
  const existing = conversationOwnerById.get(normalizedConversationId);
  if (existing && nowMs - Number(existing.updatedAt || 0) <= CONVERSATION_OWNER_TTL_MS) {
    const existingUserContextId = normalizeUserContextId(existing.userContextId || "");
    const alreadyConflicted = existing.conflicted === true;
    if (alreadyConflicted || (existingUserContextId && existingUserContextId !== normalizedUserContextId)) {
      conversationOwnerById.set(normalizedConversationId, {
        userContextId: "",
        updatedAt: nowMs,
        conflicted: true,
      });
      return;
    }
  }
  conversationOwnerById.set(normalizedConversationId, {
    userContextId: normalizedUserContextId,
    updatedAt: nowMs,
    conflicted: false,
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
  if (meta.conflicted === true) return "";
  return normalizeUserContextId(meta.userContextId);
}

function resolveEventUserContextId(userContextId, conversationId = "") {
  const explicit = normalizeUserContextId(userContextId);
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (explicit) {
    if (normalizedConversationId) trackConversationOwner(normalizedConversationId, explicit);
    return explicit;
  }
  return resolveConversationOwner(normalizedConversationId);
}

function resolveHudWorkUserContextId(userContextId = "") {
  return normalizeUserContextId(userContextId || getVoiceRoutingUserContextId());
}

function markHudWorkStart(userContextId = "") {
  const scopedUserContextId = resolveHudWorkUserContextId(userContextId);
  const nextCount = Number(hudWorkInFlightByUser.get(scopedUserContextId) || 0) + 1;
  hudWorkInFlightByUser.set(scopedUserContextId, nextCount);
  if (!getBusy({ userContextId: scopedUserContextId })) {
    setBusy(true, { userContextId: scopedUserContextId });
  }
}

function markHudWorkEnd(userContextId = "") {
  const scopedUserContextId = resolveHudWorkUserContextId(userContextId);
  const nextCount = Math.max(0, Number(hudWorkInFlightByUser.get(scopedUserContextId) || 0) - 1);
  if (nextCount === 0) {
    hudWorkInFlightByUser.delete(scopedUserContextId);
    setBusy(false, { userContextId: scopedUserContextId });
    return;
  }
  hudWorkInFlightByUser.set(scopedUserContextId, nextCount);
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
    const existingConversationId = normalizeConversationId(existing.conversationId || "");
    if (existingConversationId && normalizedConversationId && existingConversationId !== normalizedConversationId) {
      hudOpTokenStateByKey.delete(key);
      return {
        status: "conflict",
        key: "",
        conversationId: existingConversationId,
      };
    }
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
    sensitiveConsumed: false,
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

export function consumeHudOpTokenForSensitiveAction({
  userContextId = "",
  opToken = "",
  conversationId = "",
  action = "",
} = {}) {
  const key = buildHudOpTokenKey(userContextId, opToken);
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!key || !normalizedAction) {
    return { ok: false, reason: "missing_token" };
  }
  if (!HUD_SENSITIVE_ACTIONS.has(normalizedAction)) {
    return { ok: false, reason: "unsupported_action" };
  }
  const nowMs = Date.now();
  gcHudOpTokenStore(nowMs);
  const entry = hudOpTokenStateByKey.get(key);
  if (!entry) return { ok: false, reason: "token_not_found" };
  if (nowMs - Number(entry.updatedAt || 0) > HUD_OP_TOKEN_TTL_MS) {
    hudOpTokenStateByKey.delete(key);
    return { ok: false, reason: "token_expired" };
  }
  if (entry.status !== "accepted") return { ok: false, reason: "token_not_accepted" };
  const expectedConversationId = normalizeConversationId(entry.conversationId || "");
  const receivedConversationId = normalizeConversationId(conversationId);
  if (expectedConversationId && receivedConversationId && expectedConversationId !== receivedConversationId) {
    return { ok: false, reason: "conversation_mismatch" };
  }
  if (entry.sensitiveConsumed === true) {
    return { ok: false, reason: "already_consumed" };
  }
  entry.sensitiveConsumed = true;
  entry.sensitiveAction = normalizedAction;
  entry.updatedAt = nowMs;
  hudOpTokenStateByKey.set(key, entry);
  return { ok: true, reason: "authorized" };
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
  const eventType = typeof payload?.type === "string" ? payload.type.trim().toLowerCase() : "";
  const targetUserContextId = resolveEventUserContextId(
    opts.userContextId ?? payload?.userContextId,
    opts.conversationId ?? payload?.conversationId,
  );
  if (!targetUserContextId && SCOPED_ONLY_EVENT_TYPES.has(eventType)) return;
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

export function getVoiceRoutingUserContextId() {
  return normalizeUserContextId(voiceRoutingUserContextId || "");
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

function hasScopedConversationContext(userContextId = "", conversationId = "") {
  return Boolean(normalizeUserContextId(userContextId) && normalizeConversationId(conversationId));
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
  if (!hasScopedConversationContext(resolvedUserContextId, normalizedConversationId)) return;
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
  if (!hasScopedConversationContext(resolvedUserContextId, normalizedConversationId)) return;
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
  if (!hasScopedConversationContext(resolvedUserContextId, normalizedConversationId)) return;
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
  if (!hasScopedConversationContext(resolvedUserContextId, normalizedConversationId)) return;
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

function sanitizeCalendarEventId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.slice(0, 256);
}

function sanitizeCalendarPatch(value) {
  if (!value || typeof value !== "object") return {};
  const source = value;
  const patch = {};
  if (typeof source.status === "string") patch.status = String(source.status).trim().slice(0, 48);
  if (typeof source.startAt === "string") patch.startAt = String(source.startAt).trim().slice(0, 64);
  if (typeof source.endAt === "string") patch.endAt = String(source.endAt).trim().slice(0, 64);
  if (typeof source.title === "string") patch.title = String(source.title).trim().slice(0, 200);
  if (typeof source.subtitle === "string") patch.subtitle = String(source.subtitle).trim().slice(0, 200);
  if (typeof source.conflict === "boolean") patch.conflict = source.conflict;
  return patch;
}

function sanitizeCalendarConflicts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const id = sanitizeCalendarEventId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

export function broadcastCalendarEventUpdated({
  userContextId = "",
  eventId = "",
  patch = {},
} = {}) {
  const resolvedUserContextId = resolveEventUserContextId(userContextId);
  const normalizedEventId = sanitizeCalendarEventId(eventId);
  if (!resolvedUserContextId || !normalizedEventId) return;
  const safePatch = sanitizeCalendarPatch(patch);
  broadcast(
    {
      type: "calendar:event:updated",
      eventId: normalizedEventId,
      patch: safePatch,
      userContextId: resolvedUserContextId,
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId },
  );
}

export function broadcastCalendarRescheduled({
  userContextId = "",
  missionId = "",
  newStartAt = "",
  conflict = false,
} = {}) {
  const resolvedUserContextId = resolveEventUserContextId(userContextId);
  const normalizedMissionId = sanitizeCalendarEventId(missionId);
  const normalizedNewStartAt = typeof newStartAt === "string" ? String(newStartAt).trim().slice(0, 64) : "";
  if (!resolvedUserContextId || !normalizedMissionId || !normalizedNewStartAt) return;
  broadcast(
    {
      type: "calendar:rescheduled",
      missionId: normalizedMissionId,
      newStartAt: normalizedNewStartAt,
      conflict: conflict === true,
      userContextId: resolvedUserContextId,
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId },
  );
}

export function broadcastCalendarConflict({
  userContextId = "",
  conflicts = [],
} = {}) {
  const resolvedUserContextId = resolveEventUserContextId(userContextId);
  if (!resolvedUserContextId) return;
  const normalizedConflicts = sanitizeCalendarConflicts(conflicts);
  broadcast(
    {
      type: "calendar:conflict",
      conflicts: normalizedConflicts,
      userContextId: resolvedUserContextId,
      ts: Date.now(),
    },
    { userContextId: resolvedUserContextId },
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
      await handleHudGatewayMessage({
        ws,
        raw,
        connectionRateState,
        deps: {
          checkWindowRateLimit,
          WS_CONN_RATE_MAX,
          WS_CONN_RATE_WINDOW_MS,
          ensureSocketUserContextBinding,
          stopSpeaking,
          getSystemMetrics,
          hudRequestScheduler,
          CALENDAR_EMIT_EVENT_TYPES,
          sanitizeCalendarEventId,
          sanitizeCalendarPatch,
          sanitizeCalendarConflicts,
          broadcastCalendarEventUpdated,
          broadcastCalendarRescheduled,
          broadcastCalendarConflict,
          wakeWordRuntime,
          VOICE_MAP,
          setCurrentVoice,
          getCurrentVoice,
          getVoiceEnabled,
          getBusy,
          setBusy,
          speak,
          broadcastState,
          normalizeUserContextId,
          wsContextBySocket,
          checkWsUserRateLimit,
          sessionRuntime,
          sendHudStreamError,
          trackConversationOwner,
          normalizeHudOpToken,
          reserveHudOpToken,
          sendHudMessageAck,
          classifyHudRequestLane,
          broadcastThinkingStatus,
          HUD_MIN_THINKING_PRESENCE_MS,
          markHudOpTokenAccepted,
          grantPolicyApproval,
          markHudWorkStart,
          markHudWorkEnd,
          handleInput: _handleInput,
          releaseHudOpTokenReservation,
          toErrorDetails,
          setVoiceEnabled,
          setMuted,
          getMuted,
          setSuppressVoiceWakeUntilMs,
          broadcast,
          describeUnknownError,
          voiceProviderAdapter,
        },
      });
    });
  });
}
