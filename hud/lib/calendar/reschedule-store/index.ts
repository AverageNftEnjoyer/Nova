/**
 * Calendar Reschedule Store
 *
 * Per-user calendar drag-drop reschedule overrides, persisted in the local SQLite database
 * (table `calendar_overrides`, keyed by (userId, missionId) - no cross-user access is possible).
 * Kept independent of the Mission graph so Builder edits and calendar edits do not conflict.
 *
 * The implementation is shared with the agent runtime:
 * src/runtime/modules/services/calendar/overrides-store.
 */

import "server-only"

import {
  deleteRescheduleOverride as deleteOverride,
  getRescheduleOverride as getOverride,
  loadRescheduleOverrides as loadOverrides,
  setRescheduleOverride as setOverride,
} from "../../../../src/runtime/modules/services/calendar/overrides-store/index.js"

export interface RescheduleRecord {
  missionId: string
  userId: string
  originalTime: string
  overriddenTime: string
  overriddenBy: "calendar" | "builder"
  createdAt: string
  updatedAt: string
}

export async function loadRescheduleOverrides(userId: string): Promise<RescheduleRecord[]> {
  return (await loadOverrides(userId)) as RescheduleRecord[]
}

export async function getRescheduleOverride(userId: string, missionId: string): Promise<RescheduleRecord | null> {
  return (await getOverride(userId, missionId)) as RescheduleRecord | null
}

export async function setRescheduleOverride(
  userId: string,
  missionId: string,
  newStartAt: string,
  originalTime: string,
): Promise<RescheduleRecord> {
  return (await setOverride(userId, missionId, newStartAt, originalTime)) as RescheduleRecord
}

export async function deleteRescheduleOverride(userId: string, missionId: string): Promise<boolean> {
  return deleteOverride(userId, missionId)
}
