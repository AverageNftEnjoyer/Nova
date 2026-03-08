import path from "node:path";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

import { USER_CONTEXT_ROOT } from "../../../../core/constants/index.js";
import { loadMissions } from "../../missions/persistence/index.js";
import { resolveTimezone } from "../../shared/timezone/index.js";

const CALENDAR_DIR_NAME = "calendar";
const OVERRIDES_FILE_NAME = "calendar-overrides.json";
const DEFAULT_CALENDAR_WINDOW_DAYS = 7;
const MAX_CALENDAR_ITEMS = 8;
const SCHEDULER_MAX_RUNS_PER_TICK = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_TICK || "20", 10) || 20),
);
const SCHEDULER_MAX_RUNS_PER_USER_PER_TICK = Math.max(
  1,
  Math.min(25, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_USER_PER_TICK || "4", 10) || 4),
);

const DAY_MAP = Object.freeze({
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
});

const writesByPath = new Map();
const locksByUserId = new Map();

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

function normalizeMissionQuery(value = "") {
  return normalizeText(value)
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function resolveUserContextRoot() {
  return USER_CONTEXT_ROOT;
}

function resolveOverridesFile(userId = "") {
  return path.join(resolveUserContextRoot(), userId, CALENDAR_DIR_NAME, OVERRIDES_FILE_NAME);
}

function estimateDurationMs(nodeCount = 1) {
  return (30 + Math.max(0, Number(nodeCount || 0)) * 45) * 1000;
}

function expandDates(rangeStart, rangeEnd, mode, days) {
  const results = [];
  let cursorTime = new Date(rangeStart).getTime();
  const rangeEndTime = new Date(rangeEnd).getTime();
  while (cursorTime < rangeEndTime && results.length < 366) {
    const cursor = new Date(cursorTime);
    const dow = cursor.getDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    if (mode === "daily") {
      results.push(dateStr);
    } else if (mode === "weekly" && Array.isArray(days) && days.length > 0) {
      if (days.some((day) => DAY_MAP[String(day || "").toLowerCase()] === dow)) {
        results.push(dateStr);
      }
    } else if (mode === "once") {
      results.push(dateStr);
      break;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursorTime = cursor.getTime();
  }
  return results;
}

function toIsoInTimezone(dateStr, timeStr, timezone) {
  try {
    const [hours, minutes] = String(timeStr || "").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return new Date(`${dateStr}T09:00:00Z`).toISOString();
    }
    const dt = new Date(`${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`);
    const localFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(localFmt.formatToParts(dt).map((part) => [part.type, part.value]));
    const localStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    const offset = dt.getTime() - new Date(localStr).getTime();
    return new Date(
      new Date(`${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`).getTime() + offset,
    ).toISOString();
  } catch {
    return new Date(`${dateStr}T09:00:00Z`).toISOString();
  }
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function describeWindow(windowKey = "week") {
  if (windowKey === "today") return "today";
  if (windowKey === "tomorrow") return "tomorrow";
  if (windowKey === "next_week") return "next week";
  return "this week";
}

function formatWhen(startAt, timezone) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(startAt));
  } catch {
    return new Date(startAt).toISOString();
  }
}

async function atomicWriteJson(filePath, payload) {
  const resolved = path.resolve(filePath);
  const previous = writesByPath.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true });
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function validateOverrideRecord(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const missionId = normalizeText(source.missionId);
  const userId = normalizeUserId(source.userId);
  const originalTime = normalizeText(source.originalTime);
  const overriddenTime = normalizeText(source.overriddenTime);
  if (!missionId || !userId || !Date.parse(originalTime) || !Date.parse(overriddenTime)) return null;
  return {
    missionId,
    userId,
    originalTime,
    overriddenTime,
    overriddenBy: source.overriddenBy === "builder" ? "builder" : "calendar",
    createdAt: normalizeText(source.createdAt) || new Date().toISOString(),
    updatedAt: normalizeText(source.updatedAt) || new Date().toISOString(),
  };
}

async function readOverridesFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) => validateOverrideRecord(entry)).filter(Boolean);
  } catch {
    return null;
  }
}

async function loadRescheduleOverrides(userId = "") {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return [];
  const filePath = resolveOverridesFile(normalizedUserId);
  const primary = await readOverridesFile(filePath);
  if (primary) return primary;
  const backup = await readOverridesFile(`${filePath}.bak`);
  if (backup) {
    await atomicWriteJson(filePath, backup);
    return backup;
  }
  return [];
}

async function setRescheduleOverride(userId = "", missionId = "", newStartAt = "", originalTime = "") {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedMissionId = normalizeText(missionId);
  const normalizedNewStartAt = normalizeText(newStartAt);
  const normalizedOriginalTime = normalizeText(originalTime);
  if (!normalizedUserId || !normalizedMissionId || !Date.parse(normalizedNewStartAt) || !Date.parse(normalizedOriginalTime)) {
    throw new Error("Invalid calendar override input.");
  }

  const previous = locksByUserId.get(normalizedUserId) ?? Promise.resolve();
  let result = null;
  const next = previous.catch(() => undefined).then(async () => {
    const overrides = await loadRescheduleOverrides(normalizedUserId);
    const now = new Date().toISOString();
    const existing = overrides.find((entry) => entry.missionId === normalizedMissionId);
    if (existing) {
      existing.overriddenTime = normalizedNewStartAt;
      existing.updatedAt = now;
      result = existing;
    } else {
      result = {
        missionId: normalizedMissionId,
        userId: normalizedUserId,
        originalTime: normalizedOriginalTime,
        overriddenTime: normalizedNewStartAt,
        overriddenBy: "calendar",
        createdAt: now,
        updatedAt: now,
      };
      overrides.push(result);
    }
    await atomicWriteJson(resolveOverridesFile(normalizedUserId), overrides);
  });
  locksByUserId.set(normalizedUserId, next);
  try {
    await next;
  } finally {
    if (locksByUserId.get(normalizedUserId) === next) locksByUserId.delete(normalizedUserId);
  }
  return result;
}

async function deleteRescheduleOverride(userId = "", missionId = "") {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedMissionId = normalizeText(missionId);
  if (!normalizedUserId || !normalizedMissionId) return false;

  const previous = locksByUserId.get(normalizedUserId) ?? Promise.resolve();
  let deleted = false;
  const next = previous.catch(() => undefined).then(async () => {
    const overrides = await loadRescheduleOverrides(normalizedUserId);
    const filtered = overrides.filter((entry) => entry.missionId !== normalizedMissionId);
    deleted = filtered.length !== overrides.length;
    if (deleted) {
      await atomicWriteJson(resolveOverridesFile(normalizedUserId), filtered);
    }
  });
  locksByUserId.set(normalizedUserId, next);
  try {
    await next;
  } finally {
    if (locksByUserId.get(normalizedUserId) === next) locksByUserId.delete(normalizedUserId);
  }
  return deleted;
}

function buildWindow(windowKey = "week") {
  const now = new Date();
  if (windowKey === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (windowKey === "tomorrow") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (windowKey === "next_week") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  const start = new Date(now);
  const end = new Date(now);
  end.setDate(end.getDate() + DEFAULT_CALENDAR_WINDOW_DAYS);
  return { start, end };
}

function buildMissionOccurrences(mission, overridesByMissionId, range) {
  if (!mission || mission.status !== "active") return [];
  const trigger = Array.isArray(mission.nodes)
    ? mission.nodes.find((node) => node.type === "schedule-trigger")
    : null;
  if (!trigger) return [];

  const timezone = resolveTimezone(trigger.triggerTimezone, mission?.settings?.timezone);
  const nodeCount = Array.isArray(mission.nodes) ? mission.nodes.length : 1;
  const durationMs = estimateDurationMs(nodeCount);
  const override = overridesByMissionId.get(String(mission.id || "").trim());
  if (override?.overriddenTime) {
    const startAt = override.overriddenTime;
    const endAt = new Date(new Date(startAt).getTime() + durationMs).toISOString();
    if (startAt >= range.start.toISOString() && startAt < range.end.toISOString()) {
      return [{
        id: `${mission.id}::override`,
        missionId: String(mission.id || "").trim(),
        title: normalizeText(mission.label || "Untitled Mission"),
        startAt,
        endAt,
        timezone,
        conflict: false,
      }];
    }
    return [];
  }

  const mode = String(trigger.triggerMode || "daily").toLowerCase();
  const dates = expandDates(range.start, range.end, mode, trigger.triggerDays);
  const time = normalizeText(trigger.triggerTime || "09:00") || "09:00";
  return dates.map((dateStr) => {
    const startAt = toIsoInTimezone(dateStr, time, timezone);
    return {
      id: `${mission.id}::${dateStr}`,
      missionId: String(mission.id || "").trim(),
      title: normalizeText(mission.label || "Untitled Mission"),
      startAt,
      endAt: new Date(new Date(startAt).getTime() + durationMs).toISOString(),
      timezone,
      conflict: false,
    };
  }).filter((entry) => entry.startAt >= range.start.toISOString() && entry.startAt < range.end.toISOString());
}

function markConflicts(events = []) {
  const sorted = [...events].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (String(b.startAt) >= String(a.endAt)) break;
      if (overlaps(a.startAt, a.endAt, b.startAt, b.endAt)) {
        a.conflict = true;
        b.conflict = true;
      }
    }
  }
  return sorted;
}

function resolveMission(missions = [], missionQuery = "") {
  const normalizedQuery = normalizeMissionQuery(missionQuery).toLowerCase();
  if (!normalizedQuery) return null;
  const directId = missions.find((mission) => normalizeText(mission?.id).toLowerCase() === normalizedQuery);
  if (directId) return directId;
  const exactLabel = missions.find((mission) => normalizeText(mission?.label).toLowerCase() === normalizedQuery);
  if (exactLabel) return exactLabel;
  return missions.find((mission) => normalizeText(mission?.label).toLowerCase().includes(normalizedQuery)) || null;
}

export function createCalendarProviderAdapter(deps = {}) {
  const broadcastCalendarRescheduled = typeof deps.broadcastCalendarRescheduled === "function"
    ? deps.broadcastCalendarRescheduled
    : () => {};
  const broadcastCalendarEventUpdated = typeof deps.broadcastCalendarEventUpdated === "function"
    ? deps.broadcastCalendarEventUpdated
    : () => {};
  const broadcastCalendarConflict = typeof deps.broadcastCalendarConflict === "function"
    ? deps.broadcastCalendarConflict
    : () => {};

  return {
    id: "runtime-calendar-provider-adapter",
    providerId: "runtime_calendar",
    async listAgenda(input = {}) {
      const userContextId = normalizeUserId(input.userContextId);
      const windowKey = normalizeText(input.window || "week").toLowerCase();
      const range = buildWindow(windowKey);
      const missions = await loadMissions({ userId: userContextId });
      const overrides = await loadRescheduleOverrides(userContextId);
      const overridesByMissionId = new Map(overrides.map((entry) => [entry.missionId, entry]));
      const events = markConflicts(
        missions.flatMap((mission) => buildMissionOccurrences(mission, overridesByMissionId, range)),
      ).slice(0, MAX_CALENDAR_ITEMS);
      return {
        ok: true,
        events,
        windowKey,
        totalMissionCount: missions.filter((mission) => mission.status === "active").length,
      };
    },
    async rescheduleMission(input = {}) {
      const userContextId = normalizeUserId(input.userContextId);
      const missionQuery = normalizeMissionQuery(input.missionQuery);
      const newStartAt = normalizeText(input.newStartAt);
      if (!userContextId || !missionQuery || !Date.parse(newStartAt)) {
        return {
          ok: false,
          code: "calendar.reschedule_invalid",
          message: "Calendar reschedule requires a mission identifier and a valid ISO start time.",
        };
      }

      const missions = await loadMissions({ userId: userContextId });
      const mission = resolveMission(missions, missionQuery);
      if (!mission) {
        return {
          ok: false,
          code: "calendar.mission_not_found",
          message: `I couldn't find a scheduled mission matching "${missionQuery}".`,
        };
      }

      const newStart = new Date(newStartAt);
      if (Number.isNaN(newStart.getTime()) || newStart.getTime() < Date.now() - 10 * 60 * 1000) {
        return {
          ok: false,
          code: "calendar.reschedule_past_time",
          message: "Calendar reschedule must target a future ISO timestamp.",
        };
      }

      const range = {
        start: new Date(newStart.getTime() - 12 * 60 * 60 * 1000),
        end: new Date(newStart.getTime() + 12 * 60 * 60 * 1000),
      };
      const overrides = await loadRescheduleOverrides(userContextId);
      const overridesByMissionId = new Map(overrides.map((entry) => [entry.missionId, entry]));
      const events = markConflicts(missions.flatMap((entry) => buildMissionOccurrences(entry, overridesByMissionId, range)));
      const durationMs = estimateDurationMs(Array.isArray(mission.nodes) ? mission.nodes.length : 1);
      const newEndAt = new Date(newStart.getTime() + durationMs).toISOString();
      const conflict = events.some((event) =>
        event.missionId !== String(mission.id || "").trim()
        && overlaps(newStartAt, newEndAt, event.startAt, event.endAt),
      );

      const trigger = Array.isArray(mission.nodes)
        ? mission.nodes.find((node) => node.type === "schedule-trigger")
        : null;
      const triggerTime = normalizeText(trigger?.triggerTime || "09:00") || "09:00";
      const triggerTimezone = resolveTimezone(trigger?.triggerTimezone, mission?.settings?.timezone);
      const originalTime = toIsoInTimezone(newStartAt.slice(0, 10), triggerTime, triggerTimezone);
      const overrideRecord = await setRescheduleOverride(userContextId, mission.id, newStartAt, originalTime);

      broadcastCalendarRescheduled({
        userContextId,
        missionId: mission.id,
        newStartAt,
        conflict,
      });
      broadcastCalendarEventUpdated({
        userContextId,
        eventId: `${mission.id}::override`,
        patch: {
          startAt: newStartAt,
          endAt: newEndAt,
          conflict,
          status: "scheduled",
          title: mission.label,
        },
      });
      if (conflict) {
        broadcastCalendarConflict({
          userContextId,
          conflicts: [String(mission.id || "").trim()],
        });
      }

      return {
        ok: true,
        mission,
        conflict,
        override: overrideRecord,
      };
    },
    async clearReschedule(input = {}) {
      const userContextId = normalizeUserId(input.userContextId);
      const missionQuery = normalizeMissionQuery(input.missionQuery);
      if (!userContextId || !missionQuery) {
        return {
          ok: false,
          code: "calendar.clear_invalid",
          message: "Calendar override removal requires a mission identifier.",
        };
      }
      const missions = await loadMissions({ userId: userContextId });
      const mission = resolveMission(missions, missionQuery);
      if (!mission) {
        return {
          ok: false,
          code: "calendar.mission_not_found",
          message: `I couldn't find a scheduled mission matching "${missionQuery}".`,
        };
      }
      const deleted = await deleteRescheduleOverride(userContextId, mission.id);
      broadcastCalendarEventUpdated({
        userContextId,
        eventId: `${mission.id}::override`,
        patch: {
          status: "scheduled",
          conflict: false,
          title: mission.label,
        },
      });
      return {
        ok: true,
        deleted,
        mission,
      };
    },
    async getSyncStatus(input = {}) {
      const userContextId = normalizeUserId(input.userContextId);
      const missions = await loadMissions({ userId: userContextId });
      const activeMissions = missions.filter((mission) => mission.status === "active");
      return {
        ok: true,
        scheduler: {
          maxRunsPerTick: SCHEDULER_MAX_RUNS_PER_TICK,
          maxRunsPerUserPerTick: SCHEDULER_MAX_RUNS_PER_USER_PER_TICK,
          fairnessScopedByUser: true,
        },
        activeMissionCount: activeMissions.length,
      };
    },
    describeWindow,
    formatWhen,
  };
}
