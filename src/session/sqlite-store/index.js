// W6: SQLite-backed persistence for the agent session index, session transcripts, HUD conversations
// (threads/messages), thread summaries and tool runs. Shared by the JS session runtime, the TS SessionStore and the
// HUD API routes so every process reads/writes the same nova.db.
//
// Rules (contract §10):
//  - every function is scoped by userId and refuses an empty one;
//  - message/transcript bodies are user content: never log them, never put them in thrown errors;
//  - tool run input/output pass through redactSecrets() before they are persisted;
//  - all writes go through tx() (synchronous callbacks only).

import { randomUUID } from "node:crypto";

import { getDb, nowIso, tx } from "../../db/index.js";
import { redactSecrets } from "../../security/secrets/index.js";

const MAX_TOOL_RUN_JSON_CHARS = 64 * 1024;
const MESSAGE_ROLES = new Set(["user", "assistant", "tool", "system"]);

function requireUserId(userId) {
  const normalized = String(userId ?? "").trim();
  if (!normalized) throw new Error("sqlite-store: userId is required.");
  return normalized;
}

function requireText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`sqlite-store: ${label} is required.`);
  return normalized;
}

function parseJson(text, fallback) {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Sessions (was <user-context>/<user>/state/sessions.json)
// ---------------------------------------------------------------------------

/** @returns {object|null} the stored session entry. */
export function getSessionEntry(userId, sessionKey) {
  const uid = requireUserId(userId);
  const key = String(sessionKey ?? "").trim();
  if (!key) return null;
  const row = getDb().prepare("SELECT data_json FROM sessions WHERE user_id = ? AND session_key = ?").get(uid, key);
  return row ? parseJson(row.data_json, null) : null;
}

/** Cross-user lookup, only for the explicit allowCrossContextLookup escape hatch. @returns {{userId:string, entry:object}|null} */
export function findSessionEntryAcrossUsers(sessionKey) {
  const key = String(sessionKey ?? "").trim();
  if (!key) return null;
  const row = getDb().prepare("SELECT user_id, data_json FROM sessions WHERE session_key = ? LIMIT 1").get(key);
  if (!row) return null;
  const entry = parseJson(row.data_json, null);
  return entry ? { userId: row.user_id, entry } : null;
}

export function putSessionEntry(userId, sessionKey, entry) {
  const uid = requireUserId(userId);
  const key = requireText(sessionKey, "sessionKey");
  if (!entry || typeof entry !== "object") throw new Error("sqlite-store: session entry must be an object.");
  const sessionId = String(entry.sessionId ?? "").trim();
  const updatedAt = Number.isFinite(Number(entry.updatedAt)) ? Math.trunc(Number(entry.updatedAt)) : Date.now();
  tx((db) => {
    db.prepare(
      `INSERT INTO sessions (user_id, session_key, session_id, data_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, session_key) DO UPDATE SET
         session_id = excluded.session_id, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ).run(uid, key, sessionId, JSON.stringify(entry), updatedAt);
  });
}

/**
 * Atomic read-modify-write of one session entry. `updater(current|null)` must be synchronous and return the next
 * entry (or null to leave the store untouched).
 */
export function updateSessionEntry(userId, sessionKey, updater) {
  const uid = requireUserId(userId);
  const key = requireText(sessionKey, "sessionKey");
  return tx((db) => {
    const row = db.prepare("SELECT data_json FROM sessions WHERE user_id = ? AND session_key = ?").get(uid, key);
    const next = updater(row ? parseJson(row.data_json, null) : null);
    if (next == null) return null;
    const sessionId = String(next.sessionId ?? "").trim();
    const updatedAt = Number.isFinite(Number(next.updatedAt)) ? Math.trunc(Number(next.updatedAt)) : Date.now();
    db.prepare(
      `INSERT INTO sessions (user_id, session_key, session_id, data_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, session_key) DO UPDATE SET
         session_id = excluded.session_id, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ).run(uid, key, sessionId, JSON.stringify(next), updatedAt);
    return next;
  });
}

export function deleteSessionEntry(userId, sessionKey) {
  const uid = requireUserId(userId);
  const key = String(sessionKey ?? "").trim();
  if (!key) return false;
  return tx((db) => db.prepare("DELETE FROM sessions WHERE user_id = ? AND session_key = ?").run(uid, key).changes > 0);
}

/** @returns {Record<string, object>} all session entries for one user, keyed by session key. */
export function listSessionEntries(userId) {
  const uid = requireUserId(userId);
  const out = {};
  for (const row of getDb().prepare("SELECT session_key, data_json FROM sessions WHERE user_id = ?").all(uid)) {
    const entry = parseJson(row.data_json, null);
    if (entry) out[row.session_key] = entry;
  }
  return out;
}

/** @returns {string} the user id that owns `sessionId`, or "". */
export function findUserIdForSessionId(sessionId) {
  const id = String(sessionId ?? "").trim();
  if (!id) return "";
  const row = getDb().prepare("SELECT user_id FROM sessions WHERE session_id = ? LIMIT 1").get(id);
  return row ? String(row.user_id) : "";
}

// ---------------------------------------------------------------------------
// Session transcripts (was <user-context>/<user>/transcripts/<sessionId>.jsonl)
// ---------------------------------------------------------------------------

/**
 * Append one turn. The seq allocation, insert and bounded trim happen in one IMMEDIATE transaction so concurrent
 * appenders (HUD + agent) never collide and never lose a turn.
 * @param {{role:string, content:unknown, timestamp?:number, tokens?:object, meta?:object}} turn
 * @param {{maxTurns?:number}} [opts] keep at most this many newest turns (0/absent = unbounded)
 */
export function appendSessionTurn(userId, sessionId, turn, opts = {}) {
  const uid = requireUserId(userId);
  const sid = requireText(sessionId, "sessionId");
  const role = String(turn?.role ?? "").trim();
  if (!role) throw new Error("sqlite-store: turn.role is required.");
  const ts = Number.isFinite(Number(turn?.timestamp)) ? Math.trunc(Number(turn.timestamp)) : Date.now();
  const maxTurns = Number.isFinite(opts.maxTurns) && opts.maxTurns > 0 ? Math.trunc(opts.maxTurns) : 0;
  tx((db) => {
    const row = db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM session_turns WHERE user_id = ? AND session_id = ?")
      .get(uid, sid);
    const seq = Number(row.seq) + 1;
    db.prepare(
      `INSERT INTO session_turns (user_id, session_id, seq, role, content_json, ts, tokens_json, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid,
      sid,
      seq,
      role,
      JSON.stringify(turn.content ?? null),
      ts,
      turn.tokens && typeof turn.tokens === "object" ? JSON.stringify(turn.tokens) : null,
      turn.meta && typeof turn.meta === "object" ? JSON.stringify(turn.meta) : null,
    );
    if (maxTurns > 0 && seq > maxTurns) {
      db.prepare("DELETE FROM session_turns WHERE user_id = ? AND session_id = ? AND seq <= ?").run(uid, sid, seq - maxTurns);
    }
  });
}

/** @returns {Array<{role:string, content:unknown, timestamp:number, tokens?:object, meta?:object}>} oldest first. */
export function loadSessionTurns(userId, sessionId) {
  const uid = requireUserId(userId);
  const sid = String(sessionId ?? "").trim();
  if (!sid) return [];
  const rows = getDb()
    .prepare(
      "SELECT role, content_json, ts, tokens_json, meta_json FROM session_turns WHERE user_id = ? AND session_id = ? ORDER BY seq ASC",
    )
    .all(uid, sid);
  return rows.map((row) => {
    const turn = { role: row.role, content: parseJson(row.content_json, null), timestamp: Number(row.ts) };
    const tokens = parseJson(row.tokens_json, null);
    const meta = parseJson(row.meta_json, null);
    if (tokens) turn.tokens = tokens;
    if (meta) turn.meta = meta;
    return turn;
  });
}

/** Delete every transcript whose newest turn is older than `cutoffMs` (epoch ms). @returns {number} deleted turns */
export function pruneSessionTurnsOlderThan(cutoffMs) {
  const cutoff = Math.trunc(Number(cutoffMs));
  if (!Number.isFinite(cutoff)) return 0;
  return tx(
    (db) =>
      db
        .prepare(
          `DELETE FROM session_turns WHERE EXISTS (
             SELECT 1 FROM (
               SELECT user_id AS u, session_id AS s FROM session_turns GROUP BY user_id, session_id HAVING MAX(ts) < ?
             ) stale WHERE stale.u = session_turns.user_id AND stale.s = session_turns.session_id)`,
        )
        .run(cutoff).changes,
  );
}

/**
 * Remove session index entries and transcripts for one user (thread deletion).
 * @param {{sessionKeys?:string[], sessionIds?:string[]}} targets
 * @returns {{removedSessionEntries:number, removedTranscriptTurns:number}}
 */
export function deleteSessionData(userId, targets = {}) {
  const uid = requireUserId(userId);
  const keys = [...new Set((targets.sessionKeys ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  const ids = new Set((targets.sessionIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean));
  return tx((db) => {
    let removedSessionEntries = 0;
    for (const key of keys) {
      const row = db.prepare("SELECT session_id FROM sessions WHERE user_id = ? AND session_key = ?").get(uid, key);
      if (!row) continue;
      if (row.session_id) ids.add(String(row.session_id));
      removedSessionEntries += db.prepare("DELETE FROM sessions WHERE user_id = ? AND session_key = ?").run(uid, key).changes;
    }
    let removedTranscriptTurns = 0;
    for (const id of ids) {
      removedTranscriptTurns += db.prepare("DELETE FROM session_turns WHERE user_id = ? AND session_id = ?").run(uid, id).changes;
    }
    return { removedSessionEntries, removedTranscriptTurns };
  });
}

/** Session entries for a user whose key or id matches a conversation (used by thread cleanup). */
export function findSessionKeysForConversation(userId, conversationIds) {
  const uid = requireUserId(userId);
  const wanted = [...new Set((conversationIds ?? []).map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const matches = [];
  for (const row of getDb().prepare("SELECT session_key FROM sessions WHERE user_id = ?").all(uid)) {
    const lower = String(row.session_key).toLowerCase();
    const at = lower.lastIndexOf(":dm:");
    const tail = at >= 0 ? lower.slice(at + 4) : "";
    if (wanted.includes(tail)) matches.push(String(row.session_key));
  }
  return matches;
}

// ---------------------------------------------------------------------------
// HUD conversations (Supabase `threads` / `messages` replacement)
// ---------------------------------------------------------------------------

function threadFromRow(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listThreads(userId) {
  const uid = requireUserId(userId);
  return getDb()
    .prepare("SELECT id, title, pinned, archived, created_at, updated_at FROM threads WHERE user_id = ? ORDER BY updated_at DESC")
    .all(uid)
    .map(threadFromRow);
}

/** All messages for the user's threads, oldest first. `metadata` is the parsed metadata object. */
export function listThreadMessages(userId) {
  const uid = requireUserId(userId);
  return getDb()
    .prepare("SELECT id, thread_id, role, content, metadata_json, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC, id ASC")
    .all(uid)
    .map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      role: String(row.role),
      content: String(row.content),
      createdAt: String(row.created_at),
      metadata: parseJson(row.metadata_json, {}),
    }));
}

export function createThread(userId, title = "New chat") {
  const uid = requireUserId(userId);
  const id = randomUUID();
  const now = nowIso();
  const cleanTitle = String(title ?? "").trim() || "New chat";
  tx((db) => {
    db.prepare("INSERT INTO threads (user_id, id, title, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)").run(
      uid,
      id,
      cleanTitle,
      now,
      now,
    );
  });
  return threadFromRow({ id, title: cleanTitle, pinned: 0, archived: 0, created_at: now, updated_at: now });
}

export function threadExists(userId, threadId) {
  const uid = requireUserId(userId);
  const id = String(threadId ?? "").trim();
  if (!id) return false;
  return getDb().prepare("SELECT 1 FROM threads WHERE user_id = ? AND id = ?").get(uid, id) !== undefined;
}

/** @param {{title?:string, pinned?:boolean, archived?:boolean}} patch @returns {boolean} whether the thread exists */
export function patchThread(userId, threadId, patch = {}) {
  const uid = requireUserId(userId);
  const id = requireText(threadId, "threadId");
  return tx((db) => {
    const exists = db.prepare("SELECT 1 FROM threads WHERE user_id = ? AND id = ?").get(uid, id) !== undefined;
    if (!exists) return false;
    const sets = ["updated_at = ?"];
    const args = [nowIso()];
    if (typeof patch.title === "string" && patch.title.trim()) {
      sets.push("title = ?");
      args.push(patch.title.trim());
    }
    if (typeof patch.pinned === "boolean") {
      sets.push("pinned = ?");
      args.push(patch.pinned ? 1 : 0);
    }
    if (typeof patch.archived === "boolean") {
      sets.push("archived = ?");
      args.push(patch.archived ? 1 : 0);
    }
    db.prepare(`UPDATE threads SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`).run(...args, uid, id);
    return true;
  });
}

/** Message metadata objects for a thread (used to find transcript/session cleanup hints before deleting). */
export function listThreadMessageMetadata(userId, threadId, limit = 10_000) {
  const uid = requireUserId(userId);
  const id = String(threadId ?? "").trim();
  if (!id) return [];
  return getDb()
    .prepare("SELECT metadata_json FROM messages WHERE user_id = ? AND thread_id = ? LIMIT ?")
    .all(uid, id, Math.max(1, Math.trunc(limit)))
    .map((row) => ({ metadata: parseJson(row.metadata_json, {}) }));
}

/** Deletes the thread and everything hanging off it (messages, summary, tool runs). @returns {boolean} existed */
export function deleteThread(userId, threadId) {
  const uid = requireUserId(userId);
  const id = requireText(threadId, "threadId");
  return tx((db) => {
    db.prepare("DELETE FROM messages WHERE user_id = ? AND thread_id = ?").run(uid, id);
    db.prepare("DELETE FROM thread_summaries WHERE user_id = ? AND thread_id = ?").run(uid, id);
    db.prepare("DELETE FROM tool_runs WHERE user_id = ? AND thread_id = ?").run(uid, id);
    return db.prepare("DELETE FROM threads WHERE user_id = ? AND id = ?").run(uid, id).changes > 0;
  });
}

/**
 * Upsert messages into an existing thread and bump its updated_at.
 * @param {Array<{id:string, role:string, content:string, createdAt:string, metadata?:object, toolName?:string}>} messages
 * @returns {number|null} number of rows written, or null when the thread does not exist
 */
export function upsertThreadMessages(userId, threadId, messages) {
  const uid = requireUserId(userId);
  const tid = requireText(threadId, "threadId");
  const list = Array.isArray(messages) ? messages : [];
  return tx((db) => {
    if (db.prepare("SELECT 1 FROM threads WHERE user_id = ? AND id = ?").get(uid, tid) === undefined) return null;
    const stmt = db.prepare(
      `INSERT INTO messages (user_id, thread_id, id, role, content, tool_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, thread_id, id) DO UPDATE SET
         role = excluded.role, content = excluded.content, tool_name = excluded.tool_name,
         metadata_json = excluded.metadata_json, created_at = excluded.created_at`,
    );
    let written = 0;
    for (const message of list) {
      const id = String(message?.id ?? "").trim();
      if (!id) continue;
      const role = MESSAGE_ROLES.has(message.role) ? message.role : "user";
      stmt.run(
        uid,
        tid,
        id,
        role,
        String(message.content ?? ""),
        message.toolName ? String(message.toolName) : null,
        JSON.stringify(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
        String(message.createdAt || nowIso()),
      );
      written += 1;
    }
    db.prepare("UPDATE threads SET updated_at = ? WHERE user_id = ? AND id = ?").run(nowIso(), uid, tid);
    return written;
  });
}

// ---------------------------------------------------------------------------
// Thread summaries + tool runs
// ---------------------------------------------------------------------------

export function getThreadSummary(userId, threadId) {
  const uid = requireUserId(userId);
  const id = String(threadId ?? "").trim();
  if (!id) return null;
  const row = getDb().prepare("SELECT summary, updated_at FROM thread_summaries WHERE user_id = ? AND thread_id = ?").get(uid, id);
  return row ? { summary: String(row.summary), updatedAt: String(row.updated_at) } : null;
}

export function setThreadSummary(userId, threadId, summary) {
  const uid = requireUserId(userId);
  const id = requireText(threadId, "threadId");
  tx((db) => {
    db.prepare(
      `INSERT INTO thread_summaries (user_id, thread_id, summary, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, thread_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
    ).run(uid, id, String(summary ?? ""), nowIso());
  });
}

function boundedRedactedJson(value) {
  let text;
  try {
    text = JSON.stringify(redactSecrets(value ?? {}));
  } catch {
    text = JSON.stringify({ unserializable: true });
  }
  if (text.length > MAX_TOOL_RUN_JSON_CHARS) return JSON.stringify({ truncated: true, chars: text.length });
  return text;
}

/**
 * Persist a tool invocation. Input and output are redacted with redactSecrets() first (contract §10.5).
 * @param {{id?:string, threadId?:string, toolName:string, input?:unknown, output?:unknown, status?:string, latencyMs?:number}} run
 * @returns {string} the run id
 */
export function recordToolRun(userId, run) {
  const uid = requireUserId(userId);
  const toolName = requireText(run?.toolName, "toolName");
  const id = String(run.id ?? "").trim() || randomUUID();
  const inputJson = boundedRedactedJson(run.input);
  const outputJson = boundedRedactedJson(run.output);
  const latency = Number.isFinite(Number(run.latencyMs)) ? Math.trunc(Number(run.latencyMs)) : null;
  tx((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO tool_runs (user_id, id, thread_id, tool_name, input_json, output_json, status, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uid, id, run.threadId ? String(run.threadId) : null, toolName, inputJson, outputJson, String(run.status || "success"), latency, nowIso());
  });
  return id;
}

export function listToolRuns(userId, threadId, limit = 100) {
  const uid = requireUserId(userId);
  const rows = getDb()
    .prepare(
      "SELECT id, tool_name, input_json, output_json, status, latency_ms, created_at FROM tool_runs WHERE user_id = ? AND thread_id IS ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(uid, threadId ? String(threadId) : null, Math.max(1, Math.trunc(limit)));
  return rows.map((row) => ({
    id: String(row.id),
    toolName: String(row.tool_name),
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, {}),
    status: String(row.status),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    createdAt: String(row.created_at),
  }));
}
