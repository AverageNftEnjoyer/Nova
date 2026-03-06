import "server-only"

import type { Mission } from "@/lib/missions/types"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/google-calendar/service"
import { estimateDurationMs, toIsoInTimezone } from "@/lib/calendar/schedule-utils"
import { getLocalParts } from "@/lib/missions/workflow/time"
import { resolveTimezone } from "@/lib/shared/timezone"
import {
  syncMissionScheduleToGoogleCalendar as syncMissionScheduleToGoogleCalendarRuntime,
  removeMissionScheduleFromGoogleCalendar as removeMissionScheduleFromGoogleCalendarRuntime,
} from "../../../../../src/runtime/modules/services/missions/calendar-mirror/index.js"

export async function syncMissionScheduleToGoogleCalendar(params: {
  mission: Mission
  scope?: IntegrationsStoreScope
}): Promise<void> {
  return syncMissionScheduleToGoogleCalendarRuntime(params, {
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
