/**
 * Calendar Agent Task Source — Phase 3
 *
 * Produces AgentCalendarEvent[] for the calendar aggregator by:
 *   1. Reading past mission execution runs from the telemetry log
 *      (mission.run.started / completed / failed events)
 *   2. Projecting the *next* scheduled run slot for each active mission
 *      that hasn't already fired within the range
 *
 * Read-only — no reschedule support in Phase 3.
 * Scoped strictly to userId; no cross-user reads possible.
 */

import "server-only"

import { listMissionTelemetryEvents } from "@/lib/missions/telemetry/store"
import { loadMissions } from "@/lib/missions/store"
import { expandDates, toIsoInTimezone, estimateDurationMs } from "./schedule-utils"
import type { AgentCalendarEvent } from "./types"

// ─── Status mapping ───────────────────────────────────────────────────────────

function telemetryStatusToCalStatus(
  eventType: string,
  metaStatus: string,
): AgentCalendarEvent["status"] {
  if (eventType === "mission.run.started") return "running"
  if (metaStatus === "success") return "completed"
  if (metaStatus === "error") return "failed"
  return "completed"
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function loadAgentTaskEvents(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<AgentCalendarEvent[]> {
  if (!userId) return []

  const [telemetryEvents, missions] = await Promise.all([
    listMissionTelemetryEvents({
      userContextId: userId,
      sinceTs: rangeStart.toISOString(),
      limit: 2000,
    }),
    loadMissions({ userId }),
  ])

  const rangeStartMs = rangeStart.getTime()
  const rangeEndMs = rangeEnd.getTime()

  const events: AgentCalendarEvent[] = []

  // ── 1. Past / in-progress runs from telemetry ──────────────────────────────
  // Deduplicate: prefer mission.run.completed > mission.run.failed > mission.run.started
  // for the same missionRunId, so we don't show double entries.
  // Skip telemetry for missions that no longer exist (deleted/orphaned).
  const missionIds = new Set(missions.map((m) => m.id))
  const runById = new Map<string, (typeof telemetryEvents)[number]>()

  for (const ev of telemetryEvents) {
    const tsMs = Date.parse(ev.ts)
    if (!Number.isFinite(tsMs) || tsMs < rangeStartMs || tsMs >= rangeEndMs) continue
    if (!ev.eventType.startsWith("mission.run.")) continue
    if (!ev.missionRunId && !ev.missionId) continue
    const mid = ev.missionId ?? ev.scheduleId
    if (mid && !missionIds.has(mid)) continue

    const key = ev.missionRunId ?? `${ev.missionId}::${ev.ts}`
    const existing = runById.get(key)
    if (!existing) {
      runById.set(key, ev)
    } else {
      // completed/failed beats started
      const priority = (t: string) =>
        t === "mission.run.completed" ? 2 : t === "mission.run.failed" ? 2 : 1
      if (priority(ev.eventType) >= priority(existing.eventType)) {
        runById.set(key, ev)
      }
    }
  }

  const missionLabels = new Map(missions.map((m) => [m.id, m.label]))
  const missionNodeCounts = new Map(missions.map((m) => [m.id, m.nodes?.length ?? 1]))

  // Cap: max calendar events per mission from telemetry (prevents scheduler-spam floods)
  const MAX_TELEMETRY_EVENTS_PER_MISSION = 20
  const perMissionCount = new Map<string, number>()

  for (const ev of runById.values()) {
    const midKey = (ev.missionId ?? ev.scheduleId) ?? "system"
    const count = perMissionCount.get(midKey) ?? 0
    if (count >= MAX_TELEMETRY_EVENTS_PER_MISSION) continue
    perMissionCount.set(midKey, count + 1)

    const startMs = Date.parse(ev.ts)
    const nodeCount = ev.missionId ? (missionNodeCounts.get(ev.missionId) ?? 1) : 1
    const durMs = Number.isFinite(ev.durationMs) && ev.durationMs! > 0
      ? ev.durationMs!
      : estimateDurationMs(nodeCount)

    const startAt = new Date(startMs).toISOString()
    const endAt = new Date(startMs + durMs).toISOString()
    const label = ev.missionId
      ? (missionLabels.get(ev.missionId) ?? `Mission ${ev.missionId.slice(0, 8)}`)
      : "Agent Task"

    events.push({
      id: `agent::${ev.missionRunId ?? ev.eventId}`,
      kind: "agent",
      title: label,
      subtitle: `${ev.eventType.replace("mission.run.", "")} · scheduler`,
      startAt,
      endAt,
      status: telemetryStatusToCalStatus(ev.eventType, ev.status),
      agentType: "mission-runner",
      triggeredBy: ev.missionId ?? "system",
      missionRunId: ev.missionRunId,
      reschedulable: false,
    })
  }

  // ── 2. Next scheduled run slots for active missions ─────────────────────────
  // Show upcoming scheduled runs that haven't appeared in telemetry yet.
  const telemetryMissionDates = new Set(
    [...runById.values()].map((ev) => {
      if (!ev.missionId) return null
      const date = new Date(ev.ts).toISOString().slice(0, 10)
      return `${ev.missionId}::${date}`
    }).filter(Boolean),
  )

  for (const mission of missions) {
    if (mission.status !== "active") continue

    const trigger = mission.nodes?.find((n) => n.type === "schedule-trigger") as
      | { type: "schedule-trigger"; triggerMode?: string; triggerTime?: string; triggerTimezone?: string; triggerDays?: string[] }
      | undefined

    if (!trigger) continue

    const mode = trigger.triggerMode ?? "daily"
    const timeStr = trigger.triggerTime ?? "09:00"
    const tz = trigger.triggerTimezone ?? "America/New_York"
    const days = trigger.triggerDays
    const nodeCount = mission.nodes?.length ?? 1

    const dates = expandDates(rangeStart, rangeEnd, mode, days)

    for (const dateStr of dates) {
      const key = `${mission.id}::${dateStr}`
      // Skip if we already have a telemetry entry for this mission on this date
      if (telemetryMissionDates.has(key)) continue

      const startAt = toIsoInTimezone(dateStr, timeStr, tz)
      const startAtMs = Date.parse(startAt)
      if (!Number.isFinite(startAtMs)) continue
      // Only show future/upcoming slots (not past ones without a telemetry entry — those ran before telemetry existed)
      if (startAtMs <= Date.now() - 15 * 60 * 1000) continue
      if (startAtMs < rangeStartMs || startAtMs >= rangeEndMs) continue

      const durMs = estimateDurationMs(nodeCount)
      const endAt = new Date(startAtMs + durMs).toISOString()

      events.push({
        id: `agent::upcoming::${mission.id}::${dateStr}`,
        kind: "agent",
        title: mission.label,
        subtitle: `scheduled · ${mode}`,
        startAt,
        endAt,
        status: "scheduled",
        agentType: "mission-runner",
        triggeredBy: mission.id,
        reschedulable: false,
      })
    }
  }

  return events.sort((a, b) => a.startAt.localeCompare(b.startAt))
}
