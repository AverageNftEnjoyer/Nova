import "server-only"

import type { Mission } from "@/lib/missions/types"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { createCalendarEvent, deleteCalendarEvent, getCalendarEvent } from "@/lib/integrations/google-calendar/service"
import { estimateDurationMs, toIsoInTimezone } from "@/lib/calendar/schedule-utils"
import { getLocalParts } from "@/lib/missions/workflow/time"
import { resolveTimezone } from "@/lib/shared/timezone"
import { purgeMissionDerivedData } from "@/lib/missions/purge"
import { deleteMission, loadMissions } from "../../../../src/runtime/modules/services/missions/persistence/index.js"
import {
  buildMissionScheduleMirrorEventId,
  collectMirroredMissionIdsForDeletion,
  isMissionScheduleMirrorCandidate,
  syncMissionScheduleToGoogleCalendar as syncMissionScheduleToGoogleCalendarRuntime,
  removeMissionScheduleFromGoogleCalendar as removeMissionScheduleFromGoogleCalendarRuntime,
} from "../../../../src/runtime/modules/services/missions/calendar-mirror/index.js"

const CALENDAR_RECONCILE_DELETE_MAX_PARALLEL = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.NOVA_CALENDAR_RECONCILE_DELETE_MAX_PARALLEL || "4", 10) || 4),
)

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const cappedConcurrency = Math.max(1, Math.floor(concurrency))
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = new Array(Math.min(cappedConcurrency, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

export async function syncMissionScheduleToGoogleCalendar(params: {
  mission: Mission
  scope?: IntegrationsStoreScope
}): Promise<void> {
  await syncMissionScheduleToGoogleCalendarRuntime(params, {
    loadIntegrationsConfig,
    createCalendarEvent,
    deleteCalendarEvent,
    estimateDurationMs,
    toIsoInTimezone,
    getLocalParts,
    resolveTimezone,
    warn: console.warn,
    info: console.info,
  })
}

export async function removeMissionScheduleFromGoogleCalendar(params: {
  missionId: string
  userId: string
  scope?: IntegrationsStoreScope
}): Promise<void> {
  return removeMissionScheduleFromGoogleCalendarRuntime(params, {
    loadIntegrationsConfig,
    deleteCalendarEvent,
  })
}

export async function reconcileDeletedMissionSchedulesFromGoogleCalendar(params: {
  userId: string
  scope?: IntegrationsStoreScope
}): Promise<{ deletedMissionIds: string[] }> {
  const userId = String(params.userId || "").trim()
  if (!userId) return { deletedMissionIds: [] }

  const scope = params.scope ?? { userId }
  const config = await loadIntegrationsConfig(scope).catch(() => null)
  if (!config?.gcalendar?.connected) return { deletedMissionIds: [] }

  const missions = (await loadMissions({ userId })) as Mission[]
  const mirrorCandidates = missions.filter((mission) => isMissionScheduleMirrorCandidate(mission))
  if (mirrorCandidates.length === 0) return { deletedMissionIds: [] }

  const lookupByMissionId = new Map<string, "exists" | "missing" | "error">()
  await Promise.all(mirrorCandidates.map(async (mission) => {
    const missionId = String(mission.id || "").trim()
    const eventId = buildMissionScheduleMirrorEventId(userId, missionId)
    try {
      const event = await getCalendarEvent(eventId, { calendarId: "primary", scope })
      lookupByMissionId.set(missionId, !event || event.status === "cancelled" ? "missing" : "exists")
    } catch (error) {
      lookupByMissionId.set(missionId, "error")
      console.warn(
        `[gcalendar][schedule_mirror][reconcile] lookup failed mission=${missionId} user=${userId} reason=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }))

  const deletedMissionIds = collectMirroredMissionIdsForDeletion(mirrorCandidates, lookupByMissionId)
  await mapWithConcurrency(
    deletedMissionIds,
    CALENDAR_RECONCILE_DELETE_MAX_PARALLEL,
    async (missionId) => {
      const deleted = await deleteMission(missionId, userId)
      if (!deleted.deleted) return
      await purgeMissionDerivedData(userId, missionId).catch((error) => {
        console.error(
          `[gcalendar][schedule_mirror][reconcile] purge failed mission=${missionId} user=${userId} reason=${error instanceof Error ? error.message : String(error)}`,
        )
      })
      console.info(
        `[gcalendar][schedule_mirror][reconcile] deleted local mission=${missionId} user=${userId} reason=missing_google_event`,
      )
    },
  )

  return { deletedMissionIds }
}
