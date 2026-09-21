import path from "path";
import {
  createEmptyIdentitySnapshot,
  normalizeIdentitySnapshot,
  resolveDefaultIdentityRoot,
} from "../constants/index.js";
import { kvDelete, kvGet, kvSet, tx } from "../../../../../db/index.js";

const NAMESPACE = "identity-profile";
const SNAPSHOT_KEY = "snapshot";
const AUDIT_KEY = "audit";
const MAX_AUDIT_EVENTS = 300;

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function resolveIdentityPaths({ userContextId = "", workspaceDir = "" } = {}) {
  const uid = normalizeUserContextId(userContextId);
  if (!uid) {
    return {
      userContextId: "",
      userContextDir: "",
      profileDir: "",
      logsDir: "",
      snapshotPath: "",
      seedPath: "",
      auditPath: "",
    };
  }
  const userContextDir = workspaceDir
    ? path.resolve(workspaceDir)
    : path.resolve(resolveDefaultIdentityRoot(), uid);
  const profileDir = path.join(userContextDir, "profile");
  return {
    userContextId: uid,
    userContextDir,
    profileDir,
    logsDir: path.join(userContextDir, "logs"),
    snapshotPath: `sqlite:kv_state/${uid}/${NAMESPACE}/${SNAPSHOT_KEY}`,
    seedPath: `sqlite:kv_state/${uid}/${NAMESPACE}/seed`,
    auditPath: `sqlite:kv_state/${uid}/${NAMESPACE}/${AUDIT_KEY}`,
  };
}

export function loadIdentitySeed(paths) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid) return null;
  const raw = kvGet(uid, NAMESPACE, "seed");
  const schemaVersion = Number(raw?.schemaVersion || 0);
  return raw && typeof raw === "object" && schemaVersion > 0 ? raw : null;
}

export function loadIdentitySnapshot(paths, nowMs = Date.now()) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid) {
    return {
      snapshot: createEmptyIdentitySnapshot({ userContextId: "", nowMs }),
      snapshotPath: "",
      createdFresh: true,
      recoveredCorruptPath: "",
    };
  }
  let raw = null;
  let recoveredCorruptPath = "";
  try {
    raw = kvGet(uid, NAMESPACE, SNAPSHOT_KEY);
  } catch {
    kvDelete(uid, NAMESPACE, SNAPSHOT_KEY);
    recoveredCorruptPath = `${paths.snapshotPath}.corrupt.${nowMs}`;
  }
  return {
    snapshot: raw
      ? normalizeIdentitySnapshot(raw, { userContextId: uid, nowMs })
      : createEmptyIdentitySnapshot({ userContextId: uid, nowMs }),
    snapshotPath: paths.snapshotPath,
    createdFresh: !raw,
    recoveredCorruptPath,
  };
}

export function recoverOrCreateIdentitySnapshot(paths, nowMs = Date.now()) {
  return loadIdentitySnapshot(paths, nowMs);
}

export function persistIdentitySnapshot(paths, snapshot) {
  const uid = normalizeUserContextId(paths?.userContextId);
  if (!uid || !snapshot || typeof snapshot !== "object") return;
  kvSet(uid, NAMESPACE, SNAPSHOT_KEY, snapshot);
}

export function appendIdentityAuditEvent(paths, event) {
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
