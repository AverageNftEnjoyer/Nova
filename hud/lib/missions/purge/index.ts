/**
 * Mission Derived-Data Purge
 *
 * When a mission is deleted, all derived artifacts keyed to that missionId
 * must be permanently removed to prevent orphaned storage, stale calendar
 * events, and information leakage between user sessions.
 *
 * Called exclusively from DELETE /api/missions after `deleteMission` succeeds.
 * Every sub-purge is try-caught: a failure in one purge does not abort the others,
 * but is logged so operators can detect storage inconsistencies.
 *
 * Hard-purge (calendar correctness depends on it):
 *   - reschedule override (deleteRescheduleOverride)
 *
 * Best-effort purge (historical / audit data):
 *   - mission version snapshots
 *   - mission telemetry events
 *   - per-mission notification run log file
 *   - dead-letter entries for this schedule/mission
 */

import "server-only"

import { deleteRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { purgeVersionsForMission } from "@/lib/missions/workflow/versioning"
import { purgeTelemetryForMission } from "@/lib/missions/telemetry"
import { purgeNotificationRunLog } from "@/lib/notifications/run-log"
import { purgeDeadLetterForMission } from "@/lib/notifications/dead-letter"
import { jobLedger } from "@/lib/missions/job-ledger/store"

interface PurgeResult {
  jobLedger: "ok" | "error"
  rescheduleOverride: "ok" | "error"
  versionSnapshots: "ok" | "error"
  telemetryEvents: "ok" | "error"
  notificationRunLog: "ok" | "error"
  deadLetter: "ok" | "error"
}

export async function purgeMissionDerivedData(
  userId: string,
  missionId: string,
): Promise<PurgeResult> {
  const result: PurgeResult = {
    jobLedger: "ok",
    rescheduleOverride: "ok",
    versionSnapshots: "ok",
    telemetryEvents: "ok",
    notificationRunLog: "ok",
    deadLetter: "ok",
  }

  // Hard purge — cancel all pending/claimed job runs before any other purge fires.
  // Prevents scheduler from picking up and executing runs for a deleted mission.
  try {
    await jobLedger.cancelPendingForMission({ userId, missionId })
  } catch (err) {
    result.jobLedger = "error"
    console.error(
      JSON.stringify({
        event: "mission.purge.job_ledger.error",
        missionId,
        userContextId: userId,
        error: err instanceof Error ? err.message : "unknown",
      }),
    )
  }

  // Hard purge — calendar will show stale events if this fails
  try {
    await deleteRescheduleOverride(userId, missionId)
  } catch (err) {
    result.rescheduleOverride = "error"
    console.error(
      JSON.stringify({
        event: "mission.purge.reschedule_override.error",
        missionId,
        userContextId: userId,
        error: err instanceof Error ? err.message : "unknown",
      }),
    )
  }

  // Best-effort purges run in parallel
  await Promise.allSettled([
    purgeVersionsForMission(userId, missionId)
      .catch((err) => {
        result.versionSnapshots = "error"
        console.error(
          JSON.stringify({
            event: "mission.purge.version_snapshots.error",
            missionId,
            userContextId: userId,
            error: err instanceof Error ? err.message : "unknown",
          }),
        )
      }),

    purgeTelemetryForMission(userId, missionId)
      .catch((err) => {
        result.telemetryEvents = "error"
        console.error(
          JSON.stringify({
            event: "mission.purge.telemetry_events.error",
            missionId,
            userContextId: userId,
            error: err instanceof Error ? err.message : "unknown",
          }),
        )
      }),

    purgeNotificationRunLog(missionId, userId)
      .catch((err) => {
        result.notificationRunLog = "error"
        console.error(
          JSON.stringify({
            event: "mission.purge.notification_run_log.error",
            missionId,
            userContextId: userId,
            error: err instanceof Error ? err.message : "unknown",
          }),
        )
      }),

    purgeDeadLetterForMission(userId, missionId)
      .catch((err) => {
        result.deadLetter = "error"
        console.error(
          JSON.stringify({
            event: "mission.purge.dead_letter.error",
            missionId,
            userContextId: userId,
            error: err instanceof Error ? err.message : "unknown",
          }),
        )
      }),
  ])

  return result
}
