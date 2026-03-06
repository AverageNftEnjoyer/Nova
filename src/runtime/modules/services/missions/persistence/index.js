import path from "node:path";
import { mkdir, readFile, rename, writeFile, copyFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const MISSIONS_FILE_NAME = "missions.json";
const STATE_DIR_NAME = "state";
const MISSIONS_SCHEMA_VERSION = 1;

const writesByPath = new Map();
const upsertLocksByUserId = new Map();

function resolveWorkspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd;
}

function resolveUserContextRoot() {
  return path.join(resolveWorkspaceRoot(), ".user", "user-context");
}

function sanitizeUserId(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.slice(0, 96);
}

function resolveMissionsFile(userId) {
  return path.join(resolveUserContextRoot(), userId, STATE_DIR_NAME, MISSIONS_FILE_NAME);
}

function defaultStorePayload() {
  return {
    version: MISSIONS_SCHEMA_VERSION,
    missions: [],
    updatedAt: new Date().toISOString(),
  };
}

async function atomicWriteJson(filePath, payload) {
  const resolved = path.resolve(filePath);
  const previous = writesByPath.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true });
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      const body = `${JSON.stringify(payload, null, 2)}\n`;
      await writeFile(tmpPath, body, "utf8");
      try {
        await copyFile(resolved, `${resolved}.bak`);
      } catch {
      }
      await rename(tmpPath, resolved);
    });
  writesByPath.set(resolved, next);
  try {
    await next;
  } finally {
    if (writesByPath.get(resolved) === next) writesByPath.delete(resolved);
  }
}

async function ensureMissionsFile(userId) {
  const file = resolveMissionsFile(userId);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await readFile(file, "utf8");
  } catch {
    await atomicWriteJson(file, defaultStorePayload());
  }
}

async function readRawStoreFile(userId) {
  const sanitized = sanitizeUserId(userId);
  if (!sanitized) return null;
  const file = resolveMissionsFile(sanitized);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
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
  await ensureMissionsFile(sanitized);
  const file = resolveMissionsFile(sanitized);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return (Array.isArray(parsed?.missions) ? parsed.missions : [])
      .map((mission) => normalizeMission(mission))
      .filter(Boolean)
      .map((mission) => ({ ...mission, userId: sanitized }));
  } catch {
    try {
      const parsedBackup = JSON.parse(await readFile(`${file}.bak`, "utf8"));
      return (Array.isArray(parsedBackup?.missions) ? parsedBackup.missions : [])
        .map((mission) => normalizeMission(mission))
        .filter(Boolean)
        .map((mission) => ({ ...mission, userId: sanitized }));
    } catch {
      await atomicWriteJson(file, defaultStorePayload());
      return [];
    }
  }
}

async function saveScopedMissions(userId, missions, deletedIds) {
  const sanitized = sanitizeUserId(userId);
  if (!sanitized) return;
  const file = resolveMissionsFile(sanitized);
  const normalized = sortMissions(
    (Array.isArray(missions) ? missions : [])
      .map((mission) => normalizeMission(mission))
      .filter(Boolean)
      .map((mission) => ({ ...mission, userId: sanitized })),
  );

  let finalDeletedIds = deletedIds;
  if (finalDeletedIds === undefined) {
    const raw = await readRawStoreFile(sanitized);
    finalDeletedIds = Array.isArray(raw?.deletedIds) ? raw.deletedIds : [];
  }
  if (finalDeletedIds.length > 500) {
    finalDeletedIds = finalDeletedIds.slice(finalDeletedIds.length - 500);
  }

  const payload = {
    version: MISSIONS_SCHEMA_VERSION,
    missions: normalized,
    updatedAt: new Date().toISOString(),
  };
  if (finalDeletedIds.length > 0) {
    payload.deletedIds = finalDeletedIds;
  }
  await atomicWriteJson(file, payload);
}

export async function loadMissions(options = {}) {
  if (options.allUsers) {
    const userContextRoot = resolveUserContextRoot();
    let userIds = [];
    try {
      const entries = await readdir(userContextRoot, { withFileTypes: true });
      userIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => /^[a-z0-9_-]+$/.test(name));
    } catch {
      return [];
    }
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

  const previous = upsertLocksByUserId.get(uid) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = await loadScopedMissions(uid);
      const index = existing.findIndex((entry) => entry.id === mission.id);
      if (index >= 0) {
        existing[index] = { ...existing[index], ...mission, userId: uid, updatedAt: new Date().toISOString() };
      } else {
        existing.push({ ...mission, userId: uid });
      }
      await saveScopedMissions(uid, existing);
    });
  upsertLocksByUserId.set(uid, next);
  try {
    await next;
  } finally {
    if (upsertLocksByUserId.get(uid) === next) upsertLocksByUserId.delete(uid);
  }
}

export async function deleteMission(missionId, userId) {
  const uid = sanitizeUserId(userId);
  if (!uid) return { ok: false, deleted: false, reason: "invalid_user" };
  const targetMissionId = String(missionId || "").trim();
  if (!targetMissionId) return { ok: true, deleted: false, reason: "not_found" };

  let result = { ok: true, deleted: false, reason: "not_found" };
  const previous = upsertLocksByUserId.get(uid) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = await loadScopedMissions(uid);
      const filtered = existing.filter((mission) => mission.id !== targetMissionId);
      if (filtered.length === existing.length) return;
      const rawStore = await readRawStoreFile(uid);
      const existingDeletedIds = Array.isArray(rawStore?.deletedIds) ? rawStore.deletedIds : [];
      const updatedDeletedIds = [...new Set([...existingDeletedIds, targetMissionId])];
      await saveScopedMissions(uid, filtered, updatedDeletedIds);
      result = { ok: true, deleted: true, reason: "deleted" };
    });
  upsertLocksByUserId.set(uid, next);
  try {
    await next;
  } finally {
    if (upsertLocksByUserId.get(uid) === next) upsertLocksByUserId.delete(uid);
  }
  return result;
}
