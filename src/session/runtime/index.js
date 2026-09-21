import { randomUUID } from "crypto";

import {
  appendSessionTurn,
  findUserIdForSessionId,
  getSessionEntry,
  loadSessionTurns,
  pruneSessionTurnsOlderThan,
  putSessionEntry,
  updateSessionEntry,
} from "../sqlite-store/index.js";
import { getDb } from "../../db/index.js";

function normalizeToken(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-z0-9:_-]/g, "-");
}

function normalizeUserContextId(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

// Session index + transcripts live in nova.db (see src/session/sqlite-store). The legacy path options
// (sessionStorePath/transcriptDir/userContextRoot) are still accepted by callers but no longer used.
export function createSessionRuntime({
  sessionIdleMinutes,
  sessionMainKey,
  transcriptsEnabled = true,
  maxTranscriptLines = 400,
  transcriptRetentionDays = 30,
}) {
  let lastTranscriptPruneAt = 0;
  const sessionUserContextCache = new Map();
  const transcriptCacheByKey = new Map();
  const TRANSCRIPT_CACHE_TTL_MS = Math.max(
    250,
    Number.parseInt(process.env.NOVA_TRANSCRIPT_CACHE_TTL_MS || "1200", 10) || 1200,
  );

  function ensureSessionStorePaths() {
    try {
      // Opening the singleton creates the data dir and applies migrations once.
      getDb();
    } catch {
      // Let call sites surface the real failure on first use.
    }
  }

  function buildSessionKeyFromInput(opts = {}) {
    const explicit = String(opts.sessionKeyHint || "").trim();
    if (explicit) return normalizeToken(explicit);

    const source = normalizeToken(opts.source || "hud");
    const sender = normalizeToken(opts.sender || "");
    const agent = "agent:nova";
    if (source === "hud") {
      const hudUserContextId = normalizeUserContextId(resolveUserContextId(opts) || "");
      if (!hudUserContextId) throw new Error("HUD session key requires userContextId.");
      return `${agent}:hud:user:${hudUserContextId}:${normalizeToken(sessionMainKey)}`;
    }
    if (source === "voice") {
      const voiceUserContextId = normalizeUserContextId(resolveUserContextId(opts) || "");
      const dmContext = voiceUserContextId || sender;
      if (!dmContext) throw new Error("Voice session key requires userContextId or sender.");
      return `${agent}:voice:dm:${normalizeToken(dmContext)}`;
    }
    if (!sender) throw new Error(`Session key requires sender for source "${source}".`);
    return `${agent}:${source}:dm:${sender}`;
  }

  function resolveUserContextId(opts = {}) {
    const explicit = normalizeUserContextId(opts.userContextId || "");
    if (explicit) return explicit;

    const sender = String(opts.sender || "").trim();
    if (sender.startsWith("hud-user:")) {
      const fromSender = normalizeUserContextId(sender.slice("hud-user:".length));
      if (fromSender) return fromSender;
    }

    const source = normalizeToken(opts.source || "hud");
    if (source === "voice") {
      const voiceSender = normalizeUserContextId(sender);
      if (voiceSender) return voiceSender;
      const hinted = parseSessionKeyUserContext(String(opts.sessionKeyHint || ""));
      if (hinted) return hinted;
      return "";
    }
    if (source !== "hud") {
      const senderFallback = normalizeUserContextId(sender);
      if (senderFallback) return senderFallback;
      const hinted = parseSessionKeyUserContext(String(opts.sessionKeyHint || ""));
      if (hinted) return hinted;
      return "";
    }

    const senderFallback = normalizeUserContextId(sender);
    if (senderFallback && senderFallback !== "hud-user") return senderFallback;
    return "";
  }

  function parseSessionKeyUserContext(sessionKey) {
    const normalizedKey = String(sessionKey || "").trim().toLowerCase();
    if (!normalizedKey) return "";
    const hudMarker = ":hud:user:";
    const hudIndex = normalizedKey.indexOf(hudMarker);
    if (hudIndex >= 0) {
      const tail = normalizedKey.slice(hudIndex + hudMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate) return candidate;
    }
    const voiceMarker = ":voice:dm:";
    const voiceIndex = normalizedKey.indexOf(voiceMarker);
    if (voiceIndex >= 0) {
      const tail = normalizedKey.slice(voiceIndex + voiceMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate) return candidate;
    }
    const dmMarker = ":dm:";
    const dmIndex = normalizedKey.lastIndexOf(dmMarker);
    if (dmIndex >= 0) {
      const tail = normalizedKey.slice(dmIndex + dmMarker.length);
      const candidate = normalizeUserContextId(tail.split(":")[0] || "");
      if (candidate && candidate !== "anonymous" && candidate !== "unknown") return candidate;
    }
    return "";
  }

  function resolveUserContextIdForSessionId(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const cached = sessionUserContextCache.get(normalizedSessionId);
    if (cached) return cached;
    let resolved = "";
    try {
      resolved = normalizeUserContextId(findUserIdForSessionId(normalizedSessionId));
    } catch {
      // Ignore lookup errors.
    }
    if (resolved) sessionUserContextCache.set(normalizedSessionId, resolved);
    return resolved;
  }

  function buildTranscriptCacheKey(sessionId, userContextId = "") {
    return `${String(sessionId || "").trim()}|${normalizeUserContextId(userContextId)}`;
  }

  function getCachedTranscript(sessionId, userContextId = "") {
    const key = buildTranscriptCacheKey(sessionId, userContextId);
    if (!key.startsWith("|") && transcriptCacheByKey.has(key)) {
      const entry = transcriptCacheByKey.get(key);
      if (entry && Date.now() - Number(entry.at || 0) < TRANSCRIPT_CACHE_TTL_MS && Array.isArray(entry.turns)) {
        return entry.turns;
      }
      transcriptCacheByKey.delete(key);
    }
    return null;
  }

  function setCachedTranscript(sessionId, userContextId = "", turns = []) {
    const key = buildTranscriptCacheKey(sessionId, userContextId);
    if (!key.startsWith("|")) {
      transcriptCacheByKey.set(key, { at: Date.now(), turns: Array.isArray(turns) ? turns : [] });
    }
  }

  function loadTranscript(sessionId, userContextId = "") {
    if (!transcriptsEnabled) return [];
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return [];

    const requestedContextId = normalizeUserContextId(userContextId);
    const cachedTurns = getCachedTranscript(normalizedSessionId, requestedContextId);
    if (cachedTurns) return cachedTurns;

    const scopedUserContextId = requestedContextId || resolveUserContextIdForSessionId(normalizedSessionId);
    if (!scopedUserContextId) return [];
    let scopedTurns = [];
    try {
      scopedTurns = loadSessionTurns(scopedUserContextId, normalizedSessionId);
    } catch {
      return [];
    }
    if (scopedTurns.length > 0) {
      setCachedTranscript(normalizedSessionId, scopedUserContextId, scopedTurns);
    }
    return scopedTurns;
  }

  function appendTranscriptTurn(sessionId, role, content, meta = null) {
    if (!transcriptsEnabled) return;
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    const scopedUserContextId = resolveUserContextIdForSessionId(normalizedSessionId);
    const effectiveContextId = normalizeUserContextId(scopedUserContextId);
    if (!effectiveContextId) {
      throw new Error(`appendTranscriptTurn requires mapped userContextId for session ${normalizedSessionId}`);
    }
    const payload = {
      role,
      content,
      timestamp: Date.now(),
      ...(meta && typeof meta === "object" ? { meta } : {}),
    };
    appendSessionTurn(effectiveContextId, normalizedSessionId, payload, { maxTurns: maxTranscriptLines });
    const cachedTurns = getCachedTranscript(normalizedSessionId, scopedUserContextId || "");
    if (Array.isArray(cachedTurns)) {
      const nextTurns = [...cachedTurns, payload];
      const maxLines = Number.isFinite(maxTranscriptLines) && maxTranscriptLines > 0 ? maxTranscriptLines : 0;
      const bounded = maxLines > 0 && nextTurns.length > maxLines
        ? nextTurns.slice(-maxLines)
        : nextTurns;
      setCachedTranscript(normalizedSessionId, scopedUserContextId || "", bounded);
    } else {
      // Cache miss at append-time should not collapse history to a single payload.
      // Rehydrate from the database so the next turn still sees full conversation context.
      setCachedTranscript(normalizedSessionId, scopedUserContextId || "", loadSessionTurns(effectiveContextId, normalizedSessionId));
    }
  }

  function pruneOldTranscriptsIfNeeded() {
    if (!transcriptsEnabled) return;
    const now = Date.now();
    if (now - lastTranscriptPruneAt < 10 * 60 * 1000) return;
    lastTranscriptPruneAt = now;

    const retentionDays =
      Number.isFinite(transcriptRetentionDays) && transcriptRetentionDays > 0
        ? transcriptRetentionDays
        : 0;
    if (retentionDays <= 0) return;
    transcriptCacheByKey.clear();
    try {
      pruneSessionTurnsOlderThan(now - retentionDays * 24 * 60 * 60 * 1000);
    } catch {
      // Pruning is best-effort.
    }
  }

  function limitTranscriptTurns(turns, maxTurns) {
    if (!Array.isArray(turns) || turns.length === 0) return [];
    const limit = Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 20;
    let userCount = 0;
    let start = turns.length;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const role = turns[i]?.role;
      if (role === "user") {
        userCount += 1;
        if (userCount > limit) {
          break;
        }
        start = i;
      }
    }
    return turns.slice(start);
  }

  function transcriptToChatMessages(turns) {
    const out = [];
    for (const turn of turns) {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
      if (typeof turn.content !== "string" || !turn.content.trim()) continue;
      out.push({ role: turn.role, content: turn.content });
    }
    return out;
  }

  function resolveSessionContext(opts = {}) {
    pruneOldTranscriptsIfNeeded();
    const sessionKey = buildSessionKeyFromInput(opts);
    const resolvedUserContextId =
      resolveUserContextId(opts) ||
      parseSessionKeyUserContext(sessionKey);
    if (!resolvedUserContextId) {
      throw new Error("Session resolution requires userContextId.");
    }
    const effectiveUserContextId = normalizeUserContextId(resolvedUserContextId);
    const now = Date.now();
    const idleMs = Math.max(1, sessionIdleMinutes) * 60 * 1000;
    const existing = getSessionEntry(effectiveUserContextId, sessionKey);
    const expired = existing?.updatedAt ? now - existing.updatedAt > idleMs : false;
    const sessionEntry =
      !existing || expired
        ? {
            sessionId: randomUUID(),
            sessionKey,
            createdAt: now,
            updatedAt: now,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            contextTokens: 0,
            model: "",
            userContextId: effectiveUserContextId,
          }
        : {
            ...existing,
            updatedAt: now,
            userContextId: effectiveUserContextId,
          };

    if (sessionEntry.userContextId) {
      sessionUserContextCache.set(sessionEntry.sessionId, normalizeUserContextId(sessionEntry.userContextId));
    }
    putSessionEntry(effectiveUserContextId, sessionKey, sessionEntry);
    const transcript = transcriptsEnabled ? loadTranscript(sessionEntry.sessionId, sessionEntry.userContextId || "") : [];

    return {
      sessionKey,
      sessionEntry,
      transcript,
      persistUsage: ({ model, promptTokens, completionTokens }) => {
        updateSessionEntry(effectiveUserContextId, sessionKey, (current) => {
          const latestEntry = current || sessionEntry;
          return {
            ...latestEntry,
            ...(sessionEntry.userContextId ? { userContextId: sessionEntry.userContextId } : {}),
            updatedAt: Date.now(),
            model: model || latestEntry.model || "",
            inputTokens: Number(latestEntry.inputTokens || 0) + Number(promptTokens || 0),
            outputTokens: Number(latestEntry.outputTokens || 0) + Number(completionTokens || 0),
            totalTokens:
              Number(latestEntry.totalTokens || 0) +
              Number(promptTokens || 0) +
              Number(completionTokens || 0),
            contextTokens: Number(latestEntry.contextTokens || 0) + Number(promptTokens || 0),
          };
        });
      },
    };
  }

  return {
    ensureSessionStorePaths,
    normalizeUserContextId,
    resolveUserContextId,
    resolveSessionContext,
    appendTranscriptTurn,
    limitTranscriptTurns,
    transcriptToChatMessages,
  };
}
