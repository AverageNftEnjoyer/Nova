import {
  deleteSessionData,
  findSessionKeysForConversation,
  getSessionEntry,
} from "../../../../src/session/sqlite-store/index.js";

export function normalizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeConversationId(value) {
  return String(value ?? "").trim();
}

export function buildHudSessionKey(userContextId, threadId) {
  return `agent:nova:hud:user:${normalizeUserContextId(userContextId)}:dm:${normalizeConversationId(threadId)}`;
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectThreadCleanupHints(threadId, messageRows = []) {
  const sessionConversationIds = new Set();
  const sessionKeys = new Set();
  const normalizedThreadId = normalizeConversationId(threadId);
  if (normalizedThreadId) sessionConversationIds.add(normalizedThreadId);
  for (const row of Array.isArray(messageRows) ? messageRows : []) {
    const metadata = row && typeof row === "object" ? row.metadata : null;
    if (!metadata || typeof metadata !== "object") continue;
    for (const candidate of [metadata.sessionConversationId, metadata.conversationId]) {
      const id = normalizeConversationId(candidate);
      if (id) sessionConversationIds.add(id);
    }
    const key = String(metadata.sessionKey ?? "").trim();
    if (key) {
      sessionKeys.add(key);
      const marker = key.toLowerCase().lastIndexOf(":dm:");
      if (marker >= 0) sessionConversationIds.add(key.slice(marker + 4).trim());
    }
  }
  return { sessionConversationIds: [...sessionConversationIds], sessionKeys: [...sessionKeys] };
}

/**
 * Delete session index entries and transcript turns associated with a HUD thread.
 * `workspaceRoot` is retained in the signature for API compatibility; SQLite owns the location.
 */
export async function pruneThreadTranscripts(_workspaceRoot, userId, threadId, opts = {}) {
  const uid = normalizeUserContextId(userId);
  const normalizedThreadId = normalizeConversationId(threadId);
  if (!uid || !normalizedThreadId) return { removedSessionEntries: 0, removedTranscriptFiles: 0 };

  const conversationIds = new Set([normalizedThreadId]);
  for (const alias of Array.isArray(opts.sessionConversationIds) ? opts.sessionConversationIds : []) {
    const id = normalizeConversationId(alias);
    if (id) conversationIds.add(id);
  }
  const keys = new Set(Array.isArray(opts.sessionKeys) ? opts.sessionKeys.map(String).filter(Boolean) : []);
  for (const id of conversationIds) keys.add(buildHudSessionKey(uid, id));
  for (const key of findSessionKeysForConversation(uid, [...conversationIds])) keys.add(key);

  const sessionIds = [];
  for (const key of keys) {
    const entry = getSessionEntry(uid, key);
    if (entry?.sessionId) sessionIds.push(String(entry.sessionId));
  }
  const result = deleteSessionData(uid, { sessionKeys: [...keys], sessionIds });
  return {
    removedSessionEntries: result.removedSessionEntries,
    // Historical response field retained; it now counts deleted transcript records, not files.
    removedTranscriptFiles: result.removedTranscriptTurns,
  };
}
