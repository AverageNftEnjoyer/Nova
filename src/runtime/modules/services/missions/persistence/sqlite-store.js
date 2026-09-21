/**
 * Mission-domain SQLite persistence (shared by the agent runtime and the HUD server).
 *
 * Replaces the per-user JSON/JSONL files (missions.json, mission-telemetry.jsonl, mission-versions.jsonl,
 * notification run logs, dead-letter JSONL, mission operation journal, coinbase step artifacts).
 * Everything lives in <dataDir>/nova.db (see src/db). Every function is synchronous (better-sqlite3) and
 * every multi-statement change runs in one BEGIN IMMEDIATE transaction, so concurrent processes never lose writes.
 *
 * Secrets (contract §10):
 *  - Mission rows can carry credentials (http node authToken, Discord/Slack webhook URLs, keys pasted into prompts).
 *    Those string fields are stored as `nv1:` ciphertext (sealMissionSecrets) and transparently opened on read.
 *    If a secret must be stored and DPAPI is unavailable, the write THROWS (fail closed) - it never falls back to plaintext.
 *  - Append-only logs (telemetry, run logs, dead letters, journal, artifacts) redact free-text/metadata fields
 *    before persisting. Structural fields (run keys, ids) are never passed through the redactor because it would
 *    treat any field ending in "key" as a secret.
 *  - Encryption is never first-called inside a transaction: the master key is warmed BEFORE the write lock is taken.
 */

import { getDb, tx, nowIso } from "../../../../../db/index.js";
import {
  decryptSecret,
  encryptSecret,
  redactSecrets,
} from "../../../../../security/secrets/index.js";

export const GLOBAL_SCOPE = "__global__";
export const RUN_LOG_KEEP_ROWS = 2_000;
export const MISSION_SECRET_CONTEXT = "missions";

export function sanitizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function scopeOrGlobal(userId) {
  return sanitizeUserContextId(userId) || GLOBAL_SCOPE;
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toIso(value, fallbackIso = nowIso()) {
  const ms = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallbackIso;
}

function redactText(value) {
  return typeof value === "string" ? redactSecrets(value) : value;
}

// ---------------------------------------------------------------------------
// Mission secret sealing (field-level nv1 encryption inside mission JSON)
// ---------------------------------------------------------------------------

const SEALED_PREFIX = "nv1:";
const MISSION_SECRET_NAME_RE = /(api[_-]?key|secret|token|password|passwd|passphrase|authorization|credentials?|cookie)$/i;
const WEBHOOK_NAME_RE = /^webhook[_-]?urls?$/i;
const MAX_SEAL_DEPTH = 32;

function isSealed(value) {
  return typeof value === "string" && value.startsWith(SEALED_PREFIX);
}

function walk(value, name, depth, visit) {
  if (depth > MAX_SEAL_DEPTH) return value;
  if (typeof value === "string") return visit(value, name);
  if (Array.isArray(value)) return value.map((item) => walk(item, name, depth + 1, visit));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = walk(child, key, depth + 1, visit);
    return out;
  }
  return value;
}

function stringNeedsSeal(text, name) {
  if (!text || isSealed(text)) return false;
  if (name && (MISSION_SECRET_NAME_RE.test(name) || WEBHOOK_NAME_RE.test(name))) return true;
  return redactSecrets(text) !== text;
}

/** True when the mission object holds at least one plaintext secret that must be sealed before persisting. */
export function missionHasPlaintextSecrets(mission) {
  let found = false;
  walk(mission, "", 0, (text, name) => {
    if (!found && stringNeedsSeal(text, name)) found = true;
    return text;
  });
  return found;
}

/** Returns a deep copy with every secret string replaced by nv1 ciphertext. Throws SecretsUnavailableError if DPAPI is down. */
export function sealMissionSecrets(mission) {
  return walk(mission, "", 0, (text, name) =>
    stringNeedsSeal(text, name) ? encryptSecret(text, MISSION_SECRET_CONTEXT) : text,
  );
}

/** Returns a deep copy with every nv1 ciphertext opened. A value that cannot be opened is left untouched. */
export function openMissionSecrets(mission) {
  return walk(mission, "", 0, (text) => {
    if (!isSealed(text)) return text;
    const opened = decryptSecret(text, MISSION_SECRET_CONTEXT);
    return opened === "" ? text : opened;
  });
}

/** Warm the master key outside any transaction when this write/read will need encryption. */
function warmSecretsFor(...jsonOrObjects) {
  for (const item of jsonOrObjects) {
    if (!item) continue;
    const needs =
      typeof item === "string" ? item.includes(`"${SEALED_PREFIX}`) : missionHasPlaintextSecrets(item);
    if (needs) {
      // One cheap sealed round-trip loads + caches the DPAPI-unwrapped key (no-op after the first call).
      try {
        decryptSecret(encryptSecret("warm", MISSION_SECRET_CONTEXT), MISSION_SECRET_CONTEXT);
      } catch {
        // If DPAPI is unavailable the real seal below throws SecretsUnavailableError with the proper message.
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

function missionRowValues(userId, mission) {
  const id = String(mission.id);
  return {
    user_id: userId,
    id,
    label: typeof mission.label === "string" ? mission.label : null,
    enabled: mission.status === "active" ? 1 : 0,
    created_at: typeof mission.createdAt === "string" ? mission.createdAt : null,
    updated_at: typeof mission.updatedAt === "string" && mission.updatedAt ? mission.updatedAt : nowIso(),
  };
}

const UPSERT_MISSION_SQL = `
INSERT INTO missions (user_id, id, data_json, label, enabled, created_at, updated_at)
VALUES (@user_id, @id, @data_json, @label, @enabled, @created_at, @updated_at)
ON CONFLICT (user_id, id) DO UPDATE SET
  data_json = excluded.data_json, label = excluded.label, enabled = excluded.enabled,
  created_at = excluded.created_at, updated_at = excluded.updated_at`;

function writeMissionRow(db, userId, mission) {
  db.prepare(UPSERT_MISSION_SQL).run({
    ...missionRowValues(userId, mission),
    data_json: JSON.stringify(mission),
  });
}

/** Distinct user ids that own at least one mission (replaces scanning .user/user-context). */
export function listMissionUserIds() {
  return getDb()
    .prepare("SELECT DISTINCT user_id FROM missions ORDER BY user_id")
    .all()
    .map((row) => row.user_id);
}

/** Raw (opened) mission objects for one user. Callers normalize. Order: createdAt then id. */
export function readMissionRecords(userId) {
  const uid = sanitizeUserContextId(userId);
  if (!uid) return [];
  const rows = getDb().prepare("SELECT data_json FROM missions WHERE user_id = ?").all(uid);
  const sealedRow = rows.find((row) => row.data_json.includes(`"${SEALED_PREFIX}`));
  if (sealedRow) warmSecretsFor(sealedRow.data_json);
  const missions = [];
  for (const row of rows) {
    const parsed = parseJson(row.data_json);
    if (parsed && typeof parsed === "object") missions.push(openMissionSecrets(parsed));
  }
  return missions.sort((a, b) => {
    const byCreated = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    return byCreated !== 0 ? byCreated : String(a.id || "").localeCompare(String(b.id || ""));
  });
}

/**
 * Atomic read-modify-write of ONE mission. `mutate(existingOpenedOrNull)` must be synchronous and return the full
 * next mission object (already normalized by the caller) or null to leave the row untouched.
 * `incoming` is the mission the caller is about to merge in; it is only used to warm the DPAPI key BEFORE the write
 * lock is taken when it carries new plaintext secrets (encryption is then pure CPU inside the transaction).
 * Returns the stored (opened) mission, or null when nothing was written.
 */
export function upsertMissionRecord(userId, missionId, mutate, incoming) {
  const uid = sanitizeUserContextId(userId);
  const id = String(missionId || "").trim();
  if (!uid || !id) return null;
  const existingRow = getDb().prepare("SELECT data_json FROM missions WHERE user_id = ? AND id = ?").get(uid, id);
  warmSecretsFor(existingRow?.data_json, incoming);
  return tx((db) => {
    const row = db.prepare("SELECT data_json FROM missions WHERE user_id = ? AND id = ?").get(uid, id);
    const existing = row ? openMissionSecrets(parseJson(row.data_json, {})) : null;
    const next = mutate(existing);
    if (!next) return null;
    writeMissionRow(db, uid, sealMissionSecrets(next));
    return next;
  });
}

/** Replace the user's whole mission set atomically (used by saveMissions; rows not in `missions` are deleted). */
export function replaceMissionRecords(userId, missions) {
  const uid = sanitizeUserContextId(userId);
  if (!uid) return;
  const list = (Array.isArray(missions) ? missions : []).filter((m) => m && typeof m === "object" && m.id);
  warmSecretsFor(...list);
  tx((db) => {
    const keep = new Set(list.map((m) => String(m.id)));
    const existing = db.prepare("SELECT id FROM missions WHERE user_id = ?").all(uid);
    const del = db.prepare("DELETE FROM missions WHERE user_id = ? AND id = ?");
    for (const row of existing) if (!keep.has(row.id)) del.run(uid, row.id);
    for (const mission of list) writeMissionRow(db, uid, sealMissionSecrets(mission));
  });
}

/** Deletes one mission. Returns true when a row was removed. */
export function deleteMissionRecord(userId, missionId) {
  const uid = sanitizeUserContextId(userId);
  const id = String(missionId || "").trim();
  if (!uid || !id) return false;
  return tx((db) => db.prepare("DELETE FROM missions WHERE user_id = ? AND id = ?").run(uid, id).changes > 0);
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * Insert one lifecycle event and enforce retention (age + per-user cap) in the same transaction.
 * `event` must already be normalized by the caller (eventId/ts/userContextId). metadata is redacted here.
 */
export function insertTelemetryEvent(event, policy) {
  const uid = sanitizeUserContextId(event.userContextId);
  const eventId = String(event.eventId || "").trim();
  if (!uid || !eventId) return;
  const tsMs = Date.parse(String(event.ts || ""));
  const stored = { ...event, metadata: event.metadata ? redactSecrets(event.metadata) : undefined };
  tx((db) => {
    db.prepare(
      `INSERT INTO mission_telemetry (event_id, user_id, ts, type, mission_id, schedule_id, run_id, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      eventId,
      uid,
      toIso(tsMs),
      String(event.eventType || ""),
      event.missionId || null,
      event.scheduleId || null,
      event.missionRunId || null,
      JSON.stringify(stored),
    );
    if (policy) pruneTelemetry(db, uid, policy);
  });
}

function pruneTelemetry(db, uid, { retentionDays, maxEventsPerUser }) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  db.prepare("DELETE FROM mission_telemetry WHERE user_id = ? AND ts < ?").run(uid, cutoff);
  const count = db.prepare("SELECT COUNT(*) AS n FROM mission_telemetry WHERE user_id = ?").get(uid).n;
  if (count > maxEventsPerUser) {
    db.prepare(
      `DELETE FROM mission_telemetry WHERE user_id = ? AND id NOT IN (
         SELECT id FROM mission_telemetry WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?)`,
    ).run(uid, uid, maxEventsPerUser);
  }
}

export function purgeTelemetryForMissionRecords(userId, missionId) {
  const uid = sanitizeUserContextId(userId);
  const mid = String(missionId || "").trim();
  if (!uid || !mid) return 0;
  return tx(
    (db) =>
      db
        .prepare("DELETE FROM mission_telemetry WHERE user_id = ? AND (mission_id = ? OR schedule_id = ?)")
        .run(uid, mid, mid).changes,
  );
}

/** Newest first, like the JSONL reader. `sinceTs` is compared after normalizing to ISO. */
export function listTelemetryRecords({ userId, sinceTs, limit }) {
  const uid = sanitizeUserContextId(userId);
  if (!uid) return [];
  const sinceMs = sinceTs ? Date.parse(sinceTs) : NaN;
  const rows = Number.isFinite(sinceMs)
    ? getDb()
        .prepare("SELECT data_json FROM mission_telemetry WHERE user_id = ? AND ts >= ? ORDER BY ts DESC, id DESC LIMIT ?")
        .all(uid, new Date(sinceMs).toISOString(), limit)
    : getDb()
        .prepare("SELECT data_json FROM mission_telemetry WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?")
        .all(uid, limit);
  return rows.map((row) => parseJson(row.data_json)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Mission versions
// ---------------------------------------------------------------------------

/**
 * Insert a version snapshot and enforce retention in the same transaction.
 * The snapshot embeds a full mission, so its secrets are sealed exactly like mission rows.
 */
export function insertVersionRecord(entry, policy) {
  const uid = sanitizeUserContextId(entry.userContextId);
  if (!uid || !entry.versionId || !entry.missionId) return;
  warmSecretsFor(entry.mission);
  const sealed = { ...entry, mission: sealMissionSecrets(entry.mission) };
  tx((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO mission_versions (id, user_id, mission_id, ts, data_json) VALUES (?, ?, ?, ?, ?)`,
    ).run(entry.versionId, uid, entry.missionId, toIso(entry.ts), JSON.stringify(sealed));
    if (policy) {
      const cutoff = new Date(Date.now() - policy.maxAgeDays * 86_400_000).toISOString();
      db.prepare("DELETE FROM mission_versions WHERE user_id = ? AND ts < ?").run(uid, cutoff);
      db.prepare(
        `DELETE FROM mission_versions WHERE user_id = ? AND mission_id = ? AND id NOT IN (
           SELECT id FROM mission_versions WHERE user_id = ? AND mission_id = ?
           ORDER BY ts DESC, rowid DESC LIMIT ?)`,
      ).run(uid, entry.missionId, uid, entry.missionId, policy.maxVersionsPerMission);
    }
  });
}

export function listVersionRecords({ userId, missionId, limit }) {
  const uid = sanitizeUserContextId(userId);
  const mid = String(missionId || "").trim();
  if (!uid || !mid) return [];
  const rows = getDb()
    .prepare("SELECT data_json FROM mission_versions WHERE user_id = ? AND mission_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?")
    .all(uid, mid, limit);
  const out = [];
  for (const row of rows) {
    const parsed = parseJson(row.data_json);
    if (!parsed) continue;
    if (parsed.mission) warmSecretsFor(row.data_json);
    out.push({ ...parsed, mission: parsed.mission ? openMissionSecrets(parsed.mission) : parsed.mission });
  }
  return out;
}

export function purgeVersionRecords(userId, missionId) {
  const uid = sanitizeUserContextId(userId);
  const mid = String(missionId || "").trim();
  if (!uid || !mid) return 0;
  return tx((db) => db.prepare("DELETE FROM mission_versions WHERE user_id = ? AND mission_id = ?").run(uid, mid).changes);
}

// ---------------------------------------------------------------------------
// Notification run logs
// ---------------------------------------------------------------------------

export function appendRunLogRecord(scheduleId, userId, entry) {
  const uid = scopeOrGlobal(userId);
  const mid = String(scheduleId || "").trim() || "unknown";
  const stored = { ...entry, error: redactText(entry.error) };
  tx((db) => {
    db.prepare("INSERT INTO mission_run_logs (user_id, mission_id, ts, run_key, data_json) VALUES (?, ?, ?, ?, ?)").run(
      uid,
      mid,
      toIso(entry.ts),
      typeof entry.runKey === "string" && entry.runKey ? entry.runKey : null,
      JSON.stringify(stored),
    );
    db.prepare(
      `DELETE FROM mission_run_logs WHERE user_id = ? AND mission_id = ? AND id NOT IN (
         SELECT id FROM mission_run_logs WHERE user_id = ? AND mission_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(uid, mid, uid, mid, RUN_LOG_KEEP_ROWS);
  });
}

/** Oldest-to-newest, last `maxLines` rows (same view as tailing the JSONL file). */
export function readRunLogRecords(scheduleId, userId, maxLines) {
  const uid = scopeOrGlobal(userId);
  const mid = String(scheduleId || "").trim() || "unknown";
  const rows = getDb()
    .prepare("SELECT data_json FROM mission_run_logs WHERE user_id = ? AND mission_id = ? ORDER BY id DESC LIMIT ?")
    .all(uid, mid, maxLines);
  return rows
    .reverse()
    .map((row) => parseJson(row.data_json))
    .filter(Boolean);
}

export function purgeRunLogRecords(scheduleId, userId) {
  const uid = scopeOrGlobal(userId);
  const mid = String(scheduleId || "").trim() || "unknown";
  return tx((db) => db.prepare("DELETE FROM mission_run_logs WHERE user_id = ? AND mission_id = ?").run(uid, mid).changes);
}

// ---------------------------------------------------------------------------
// Dead letters (kind: 'notification' | 'mission_run')
// ---------------------------------------------------------------------------

/** Usable inside an existing transaction (the job ledger appends a dead letter in the failRun transaction). */
export function insertDeadLetterRow(db, kind, userId, entry) {
  const uid = scopeOrGlobal(userId);
  const stored = {
    ...entry,
    reason: redactText(entry.reason),
    errorDetail: redactText(entry.errorDetail),
    metadata: entry.metadata ? redactSecrets(entry.metadata) : entry.metadata,
  };
  db.prepare(
    "INSERT INTO dead_letters (user_id, kind, entry_id, mission_id, ts, data_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    uid,
    kind,
    String(entry.id),
    String(entry.scheduleId || entry.missionId || "") || null,
    toIso(entry.ts),
    JSON.stringify(stored),
  );
}

export function appendDeadLetterRecord(kind, userId, entry) {
  tx((db) => insertDeadLetterRow(db, kind, userId, entry));
  return entry.id;
}

export function purgeDeadLetterRecords(kind, userId, missionId) {
  const uid = scopeOrGlobal(userId);
  const mid = String(missionId || "").trim();
  if (!mid) return 0;
  return tx(
    (db) => db.prepare("DELETE FROM dead_letters WHERE user_id = ? AND kind = ? AND mission_id = ?").run(uid, kind, mid).changes,
  );
}

/** Newest first. */
export function listDeadLetterRecords(kind, userId, limit = 200) {
  const uid = scopeOrGlobal(userId);
  return getDb()
    .prepare("SELECT data_json FROM dead_letters WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?")
    .all(uid, kind, limit)
    .map((row) => parseJson(row.data_json))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Operation journal
// ---------------------------------------------------------------------------

export function appendJournalRecord(entry) {
  const uid = sanitizeUserContextId(entry.userContextId);
  if (!uid) return;
  // Only the free-form parts are redacted; ids/timestamps stay intact.
  const { userContextId, actorId, missionId, ts, ...rest } = entry;
  const stored = { userContextId, actorId, missionId, ts, ...redactSecrets(rest) };
  tx((db) => {
    db.prepare("INSERT INTO mission_journal (user_id, mission_id, ts, data_json) VALUES (?, ?, ?, ?)").run(
      uid,
      String(missionId || ""),
      toIso(ts),
      JSON.stringify(stored),
    );
  });
}

// ---------------------------------------------------------------------------
// Step artifacts (coinbase workflow)
// ---------------------------------------------------------------------------

export function insertArtifactRecord(record) {
  const uid = sanitizeUserContextId(record.userContextId);
  if (!uid || !record.artifactRef) return;
  const stored = { ...record, summary: redactText(record.summary), output: redactSecrets(record.output) };
  tx((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO mission_artifacts
         (user_id, artifact_ref, conversation_id, mission_id, run_id, step_id, created_at_ms, ttl_ms, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid,
      record.artifactRef,
      record.conversationId || null,
      record.missionId || null,
      record.missionRunId || null,
      record.stepId || null,
      Number(record.createdAtMs || Date.now()),
      Number(record.ttlMs || 0),
      JSON.stringify(stored),
    );
  });
}

export function pruneExpiredArtifactRecords(userId, nowMs) {
  const uid = sanitizeUserContextId(userId);
  if (!uid) return 0;
  return tx(
    (db) => db.prepare("DELETE FROM mission_artifacts WHERE user_id = ? AND created_at_ms + ttl_ms < ?").run(uid, nowMs).changes,
  );
}

/** Newest first; callers apply conversation/mission/ttl filters and their own limit. */
export function listArtifactRecords(userId, scanLimit) {
  const uid = sanitizeUserContextId(userId);
  if (!uid) return [];
  return getDb()
    .prepare("SELECT data_json FROM mission_artifacts WHERE user_id = ? ORDER BY created_at_ms DESC, artifact_ref DESC LIMIT ?")
    .all(uid, scanLimit)
    .map((row) => parseJson(row.data_json))
    .filter(Boolean);
}
