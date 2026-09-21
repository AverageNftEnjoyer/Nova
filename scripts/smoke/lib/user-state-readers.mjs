/**
 * Read-side helpers for smokes that used to inspect per-user files:
 *   <user-context>/<user>/state/sessions.json           -> nova.db `sessions`
 *   <user-context>/<user>/transcripts/<sessionId>.jsonl -> nova.db `session_turns`
 *   <user-context>/<user>/state/*.json (follow-up state, voice settings, ...) -> nova.db `kv_state`
 * Logs (`logs/*.jsonl`) and other genuinely file-based artifacts still live under <dataDir>/user-context/<user>/.
 *
 * Import after (or via) isolated-data-dir.mjs so these all address the throwaway NOVA_DATA_DIR.
 */
import "./isolated-data-dir.mjs";
import path from "node:path";

import { kvGet, resolveDataDir } from "../../../src/db/index.js";
import { listSessionEntries, loadSessionTurns } from "../../../src/session/sqlite-store/index.js";

/** <dataDir>/user-context/<userId> (file-based artifacts such as logs/). */
export function userContextDir(userId) {
  return path.join(resolveDataDir(), "user-context", String(userId));
}

/** Same shape the old sessions.json had: { [sessionKey]: sessionEntry }. */
export function readSessions(userId) {
  return listSessionEntries(String(userId));
}

/** Transcript turns, oldest first: { role, content, timestamp, meta? } (same fields as the old JSONL lines). */
export function readTranscript(userId, sessionId) {
  return loadSessionTurns(String(userId), String(sessionId));
}

/** kv_state value or null. */
export function readKv(userId, namespace, key) {
  return kvGet(String(userId), namespace, key);
}
