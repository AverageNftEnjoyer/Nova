/**
 * Calendar reschedule overrides (SQLite table `calendar_overrides`).
 *
 * Single implementation shared by the HUD (`hud/lib/calendar/reschedule-store`) and the agent runtime, so both
 * processes read and write the same rows. Overrides live outside the Mission graph so Builder edits and
 * calendar drag-drop edits never conflict. Every statement is scoped by (user_id, mission_id): there is no
 * cross-user access path.
 */

import { nowIso, tx } from "../../../../../db/index.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeUserId(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function isValidIso(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0;
}

function rowToRecord(row, userId) {
  return {
    missionId: row.mission_id,
    userId,
    originalTime: row.original_time,
    overriddenTime: row.overridden_time,
    overriddenBy: row.overridden_by === "builder" ? "builder" : "calendar",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectOverride(db, userId, missionId) {
  const row = db
    .prepare("SELECT * FROM calendar_overrides WHERE user_id = ? AND mission_id = ?")
    .get(userId, missionId);
  return row ? rowToRecord(row, userId) : null;
}

export async function loadRescheduleOverrides(userId = "") {
  const uid = normalizeUserId(userId);
  if (!uid) return [];
  const rows = tx(
    (db) => db.prepare("SELECT * FROM calendar_overrides WHERE user_id = ? ORDER BY created_at, mission_id").all(uid),
    "deferred",
  );
  return rows.map((row) => rowToRecord(row, uid));
}

export async function getRescheduleOverride(userId = "", missionId = "") {
  const uid = normalizeUserId(userId);
  const id = normalizeText(missionId).slice(0, 128);
  if (!uid || !id) return null;
  return tx((db) => selectOverride(db, uid, id), "deferred");
}

export async function setRescheduleOverride(userId = "", missionId = "", newStartAt = "", originalTime = "") {
  const uid = normalizeUserId(userId);
  const id = normalizeText(missionId).slice(0, 128);
  const overriddenTime = normalizeText(newStartAt);
  const original = normalizeText(originalTime);
  if (!uid || !id || !isValidIso(overriddenTime) || !isValidIso(original)) {
    throw new Error("Invalid calendar override input.");
  }
  return tx((db) => {
    const now = nowIso();
    // An existing override keeps its original time and author; only the new time and updated_at change.
    const info = db
      .prepare("UPDATE calendar_overrides SET overridden_time = ?, updated_at = ? WHERE user_id = ? AND mission_id = ?")
      .run(overriddenTime, now, uid, id);
    if (info.changes === 0) {
      db.prepare(
        `INSERT INTO calendar_overrides
           (user_id, mission_id, original_time, overridden_time, overridden_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'calendar', ?, ?)`,
      ).run(uid, id, original, overriddenTime, now, now);
    }
    return selectOverride(db, uid, id);
  });
}

export async function deleteRescheduleOverride(userId = "", missionId = "") {
  const uid = normalizeUserId(userId);
  const id = normalizeText(missionId).slice(0, 128);
  if (!uid || !id) return false;
  return tx(
    (db) => db.prepare("DELETE FROM calendar_overrides WHERE user_id = ? AND mission_id = ?").run(uid, id).changes > 0,
  );
}
