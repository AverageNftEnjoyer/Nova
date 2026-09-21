import {
  deleteMissionRecord,
  listMissionUserIds,
  readMissionRecords,
  replaceMissionRecords,
  sanitizeUserContextId,
  upsertMissionRecord,
} from "./sqlite-store.js";

function sanitizeUserId(value) {
  return sanitizeUserContextId(value);
}

function normalizeMission(raw = {}) {
  if (!raw.id || !raw.createdAt || !raw.updatedAt) return null;
  return {
    ...raw,
    userId: String(raw.userId || ""),
    label: String(raw.label || "Untitled Mission"),
    description: String(raw.description || ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map((entry) => String(entry)).filter(Boolean) : [],
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    connections: Array.isArray(raw.connections) ? raw.connections : [],
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    runCount: Number.isFinite(Number(raw.runCount)) ? Math.max(0, Number(raw.runCount)) : 0,
    successCount: Number.isFinite(Number(raw.successCount)) ? Math.max(0, Number(raw.successCount)) : 0,
    failureCount: Number.isFinite(Number(raw.failureCount)) ? Math.max(0, Number(raw.failureCount)) : 0,
    integration: String(raw.integration || "telegram"),
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((entry) => String(entry).trim()).filter(Boolean) : [],
  };
}

function sortMissions(rows = []) {
  return [...rows].sort((a, b) => {
    const byCreated = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byCreated !== 0) return byCreated;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

async function loadScopedMissions(userId) {
  const sanitized = sanitizeUserId(userId);
  if (!sanitized) return [];
  return readMissionRecords(sanitized)
    .map((mission) => normalizeMission(mission))
    .filter(Boolean)
    .map((mission) => ({ ...mission, userId: sanitized }));
}

async function saveScopedMissions(userId, missions) {
  const sanitized = sanitizeUserId(userId);
  if (!sanitized) return;
  const normalized = sortMissions(
    (Array.isArray(missions) ? missions : [])
      .map((mission) => normalizeMission(mission))
      .filter(Boolean)
      .map((mission) => ({ ...mission, userId: sanitized })),
  );
  replaceMissionRecords(sanitized, normalized);
}

export async function loadMissions(options = {}) {
  if (options.allUsers) {
    const userIds = listMissionUserIds();
    const grouped = await Promise.all(userIds.map(async (uid) => loadScopedMissions(uid)));
    return grouped.flat();
  }

  const userId = sanitizeUserId(options.userId || "");
  if (!userId) return [];
  return loadScopedMissions(userId);
}

export async function upsertMission(mission, userId) {
  const uid = sanitizeUserId(userId);
  if (!uid || !mission || typeof mission !== "object") return;
  upsertMissionRecord(
    uid,
    mission.id,
    (existing) => normalizeMission(
      existing
        ? { ...existing, ...mission, userId: uid, updatedAt: new Date().toISOString() }
        : { ...mission, userId: uid },
    ),
    mission,
  );
}

export async function deleteMission(missionId, userId) {
  const uid = sanitizeUserId(userId);
  if (!uid) return { ok: false, deleted: false, reason: "invalid_user" };
  const targetMissionId = String(missionId || "").trim();
  if (!targetMissionId) return { ok: true, deleted: false, reason: "not_found" };

  const deleted = deleteMissionRecord(uid, targetMissionId);
  return { ok: true, deleted, reason: deleted ? "deleted" : "not_found" };
}
