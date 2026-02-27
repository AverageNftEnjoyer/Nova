/**
 * Calendar aggregator — Phase 2
 * Reads Mission objects from the store and converts their schedule-trigger nodes
 * into CalendarEvent objects for the calendar view.
 * Applies per-user reschedule overrides from reschedule-store.
 *
 * Phase 3+: AgentTask and PersonalEvent sources added here.
 */

import "server-only"

import { loadMissions } from "@/lib/missions/store"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { loadRescheduleOverrides } from "./reschedule-store"
import { loadAgentTaskEvents } from "./agent-task-source"
import { loadGmailCalendarEvents } from "./gmail-calendar-source"
import { expandDates, toIsoInTimezone, estimateDurationMs } from "./schedule-utils"
import type { MissionCalendarEvent, CalendarEvent } from "./types"

// ─── Main export ──────────────────────────────────────────────────────────────

export async function aggregateCalendarEvents(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<CalendarEvent[]> {
  // Load integrations config once and share the connected flag with sources
  // to avoid redundant DB round-trips.
  const integrationsConfig = await loadIntegrationsConfig({ userId }).catch(() => null)
  const gcalendarConnected = Boolean(integrationsConfig?.gcalendar?.connected)

  const [missions, overrides, agentTaskEvents, gmailCalendarEvents] = await Promise.all([
    loadMissions({ userId }),
    loadRescheduleOverrides(userId),
    loadAgentTaskEvents(userId, rangeStart, rangeEnd),
    loadGmailCalendarEvents(userId, rangeStart, rangeEnd, gcalendarConnected),
  ])

  const overrideMap = new Map(overrides.map((r) => [r.missionId, r.overriddenTime]))

  const events: CalendarEvent[] = []

  for (const mission of missions) {
    // Only active missions run on a recurring schedule.
    // Archived/paused/draft missions must not generate calendar entries
    // — paused/draft missions have no live schedule, and showing them
    // would spam the view with every day in the range.
    if (mission.status !== "active") continue

    const trigger = mission.nodes?.find((n) => n.type === "schedule-trigger") as
      | { type: "schedule-trigger"; triggerMode?: string; triggerTime?: string; triggerTimezone?: string; triggerDays?: string[] }
      | undefined

    if (!trigger) continue

    const mode = trigger.triggerMode ?? "daily"
    const tz = trigger.triggerTimezone ?? "America/New_York"
    const days = trigger.triggerDays
    const nodeCount = mission.nodes?.length ?? 1
    const durationMs = estimateDurationMs(nodeCount)

    // Reschedule override takes priority over trigger node time
    const overriddenIso = overrideMap.get(mission.id)

    const missionStatus = "scheduled" as const

    const outputNode = mission.nodes?.find((n) =>
      ["telegram-output", "discord-output", "email-output", "slack-output", "webhook-output"].includes(n.type),
    )
    const integration = mission.integration
      ?? (outputNode?.type.replace("-output", "") ?? undefined)

    if (overriddenIso) {
      // Override mode: emit a single instance at the overridden time (if within range)
      const overrideDate = new Date(overriddenIso)
      if (overrideDate >= rangeStart && overrideDate < rangeEnd) {
        const endAt = new Date(overrideDate.getTime() + durationMs).toISOString()
        events.push({
          id: `${mission.id}::override`,
          kind: "mission",
          missionId: mission.id,
          title: mission.label,
          subtitle: `${mission.category ?? "mission"} · ${nodeCount} nodes`,
          startAt: overriddenIso,
          endAt,
          status: missionStatus,
          nodeCount,
          integration: typeof integration === "string" ? integration : undefined,
          category: mission.category,
          reschedulable: true,
        })
      }
    } else {
      // Normal schedule expansion
      const timeStr = trigger.triggerTime ?? "09:00"
      const dates = expandDates(rangeStart, rangeEnd, mode, days)

      for (const dateStr of dates) {
        const startAt = toIsoInTimezone(dateStr, timeStr, tz)
        const endAt = new Date(new Date(startAt).getTime() + durationMs).toISOString()
        events.push({
          id: `${mission.id}::${dateStr}`,
          kind: "mission",
          missionId: mission.id,
          title: mission.label,
          subtitle: `${mission.category ?? "mission"} · ${nodeCount} nodes`,
          startAt,
          endAt,
          status: missionStatus,
          nodeCount,
          integration: typeof integration === "string" ? integration : undefined,
          category: mission.category,
          reschedulable: true,
        })
      }
    }
  }

  // Agent task events
  for (const agentEv of agentTaskEvents) {
    events.push(agentEv)
  }

  // GmailCalendar personal events
  for (const personalEv of gmailCalendarEvents) {
    events.push(personalEv)
  }

  // Deduplicate by event ID — prevents any upstream duplication from
  // producing 1000+ identical pills on the calendar grid.
  const seen = new Set<string>()
  const unique: CalendarEvent[] = []
  for (const ev of events) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id)
      unique.push(ev)
    }
  }

  markConflicts(unique)

  return unique.sort((a, b) => a.startAt.localeCompare(b.startAt))
}

/**
 * Mark mission events that overlap any other event.
 * Events must already be sorted by startAt (the sort below ensures this).
 * Sliding-window: for each event i, only scan forward until the next event
 * starts after i ends — O(n·k) where k is typical overlap count (~1–3).
 */
function markConflicts(events: CalendarEvent[]) {
  for (let i = 0; i < events.length; i++) {
    const a = events[i]
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j]
      if (b.startAt >= a.endAt) break // sorted — no later event can overlap a
      if (a.startAt < b.endAt && b.startAt < a.endAt) {
        if (a.kind === "mission") (a as MissionCalendarEvent).conflict = true
        if (b.kind === "mission") (b as MissionCalendarEvent).conflict = true
      }
    }
  }
}
