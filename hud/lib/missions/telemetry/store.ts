import "server-only"

import {
  insertTelemetryEvent,
  listTelemetryRecords,
  purgeTelemetryForMissionRecords,
  sanitizeUserContextId,
} from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"
import { MISSION_TELEMETRY_POLICY } from "./config"
import type { MissionLifecycleEvent } from "./types"

function normalizeEvent(event: MissionLifecycleEvent): MissionLifecycleEvent {
  return {
    ...event,
    eventId: String(event.eventId || "").trim(),
    ts: String(event.ts || new Date().toISOString()),
    userContextId: sanitizeUserContextId(event.userContextId),
    missionId: typeof event.missionId === "string" ? event.missionId.trim() : undefined,
    missionRunId: typeof event.missionRunId === "string" ? event.missionRunId.trim() : undefined,
    scheduleId: typeof event.scheduleId === "string" ? event.scheduleId.trim() : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Number(event.durationMs)) : undefined,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : undefined,
  }
}

export async function appendMissionTelemetryEvent(event: MissionLifecycleEvent): Promise<void> {
  const normalized = normalizeEvent(event)
  if (!normalized.userContextId || !normalized.eventId) return
  insertTelemetryEvent(normalized, MISSION_TELEMETRY_POLICY)
}

export async function purgeTelemetryForMission(userContextId: string, missionId: string): Promise<void> {
  purgeTelemetryForMissionRecords(userContextId, missionId)
}

export async function listMissionTelemetryEvents(input: {
  userContextId: string
  sinceTs?: string
  limit?: number
}): Promise<MissionLifecycleEvent[]> {
  const limit = Math.max(1, Math.min(5000, Number.parseInt(String(input.limit || "500"), 10) || 500))
  return listTelemetryRecords({
    userId: input.userContextId,
    sinceTs: input.sinceTs,
    limit,
  }) as MissionLifecycleEvent[]
}
