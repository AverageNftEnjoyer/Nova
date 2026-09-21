/**
 * Personality profile storage on SQLite kv_state.
 * Path-like return values are retained as opaque compatibility identifiers.
 */
import { kvGet, kvSet, tx } from "../../../../../db/index.js";

const NAMESPACE = "personality-profile";
const PROFILE_KEY = "profile";
const AUDIT_KEY = "audit";
const MAX_AUDIT_EVENTS = 200;

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function resolvePersonalityPaths({ userContextId = "" } = {}) {
  const uid = normalizeUserContextId(userContextId);
  if (!uid) return { userContextId: "", profilePath: "", auditPath: "" };
  return {
    userContextId: uid,
    profilePath: `sqlite:kv_state/${uid}/${NAMESPACE}/${PROFILE_KEY}`,
    auditPath: `sqlite:kv_state/${uid}/${NAMESPACE}/${AUDIT_KEY}`,
  };
}

export function loadPersonalityProfile(paths) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid) return null;
  const raw = kvGet(uid, NAMESPACE, PROFILE_KEY);
  return raw && typeof raw === "object" ? raw : null;
}

export function persistPersonalityProfile(paths, profile) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid || !profile || typeof profile !== "object") return;
  kvSet(uid, NAMESPACE, PROFILE_KEY, profile);
}

export function appendPersonalityAuditEvent(paths, event) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid || !event || typeof event !== "object") return;
  try {
    tx((db) => {
      const row = db
        .prepare("SELECT value_json FROM kv_state WHERE user_id = ? AND namespace = ? AND key = ?")
        .get(uid, NAMESPACE, AUDIT_KEY);
      let events = [];
      try {
        const parsed = row ? JSON.parse(row.value_json) : [];
        if (Array.isArray(parsed)) events = parsed;
      } catch {}
      events.push(event);
      events = events.slice(-MAX_AUDIT_EVENTS);
      db.prepare(
        `INSERT INTO kv_state (user_id, namespace, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, namespace, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).run(uid, NAMESPACE, AUDIT_KEY, JSON.stringify(events), new Date().toISOString());
    });
  } catch {
    // Best-effort audit trail.
  }
}
