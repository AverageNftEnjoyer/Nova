import "server-only"

import { randomUUID } from "node:crypto"

import type { MissionLifecycleEvent, MissionLifecycleEventType, MissionLifecycleStatus } from "./types"
import { sanitizeMissionTelemetryMetadata } from "./sanitizer"
import { appendMissionTelemetryEvent } from "./store"

export async function emitMissionTelemetryEvent(input: {
  eventType: MissionLifecycleEventType
  status: MissionLifecycleStatus
  userContextId: string
  missionId?: string
  missionRunId?: string
  scheduleId?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  const event: MissionLifecycleEvent = {
    eventId: randomUUID(),
    ts: new Date().toISOString(),
    eventType: input.eventType,
    status: input.status,
    userContextId: String(input.userContextId || "").trim(),
    missionId: typeof input.missionId === "string" ? input.missionId : undefined,
    missionRunId: typeof input.missionRunId === "string" ? input.missionRunId : undefined,
    scheduleId: typeof input.scheduleId === "string" ? input.scheduleId : undefined,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : undefined,
    metadata: sanitizeMissionTelemetryMetadata(input.metadata || {}),
  }
  await appendMissionTelemetryEvent(event)
}
