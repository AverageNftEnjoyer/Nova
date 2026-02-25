/**
 * Calendar Conflict Detector — Phase 2
 *
 * Pure utility: detects overlapping CalendarEvents and returns
 * ConflictGroup[] for the requested period.
 * No I/O — safe to call from client or server.
 */

import type { CalendarEvent } from "./types"

export interface ConflictGroup {
  eventIds: string[]
  overlapStart: string   // ISO8601
  overlapEnd: string     // ISO8601
}

/**
 * Given a sorted list of CalendarEvents, returns groups of overlapping events.
 * Two events overlap when: a.startAt < b.endAt AND b.startAt < a.endAt
 */
export function detectConflicts(events: CalendarEvent[]): ConflictGroup[] {
  const groups: ConflictGroup[] = []

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]
      const b = events[j]

      const aStart = a.startAt
      const aEnd   = a.endAt
      const bStart = b.startAt
      const bEnd   = b.endAt

      if (aStart < bEnd && bStart < aEnd) {
        const overlapStart = aStart > bStart ? aStart : bStart
        const overlapEnd   = aEnd   < bEnd   ? aEnd   : bEnd

        // Merge into an existing group if one of the ids is already there
        const existing = groups.find((g) => g.eventIds.includes(a.id) || g.eventIds.includes(b.id))
        if (existing) {
          if (!existing.eventIds.includes(a.id)) existing.eventIds.push(a.id)
          if (!existing.eventIds.includes(b.id)) existing.eventIds.push(b.id)
          // Widen the overlap window
          if (overlapStart < existing.overlapStart) existing.overlapStart = overlapStart
          if (overlapEnd   > existing.overlapEnd)   existing.overlapEnd   = overlapEnd
        } else {
          groups.push({ eventIds: [a.id, b.id], overlapStart, overlapEnd })
        }
      }
    }
  }

  return groups
}

/**
 * Mutates a CalendarEvent[] in-place: sets conflict=true on MissionCalendarEvents
 * that overlap with any other event.
 */
export function markConflictsOnEvents(events: CalendarEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]
      const b = events[j]
      if (a.startAt < b.endAt && b.startAt < a.endAt) {
        if (a.kind === "mission") (a as { conflict?: boolean }).conflict = true
        if (b.kind === "mission") (b as { conflict?: boolean }).conflict = true
      }
    }
  }
}

/**
 * Check whether a proposed [newStart, newEnd) slot overlaps any existing event,
 * excluding the event being rescheduled (identified by excludeId).
 */
export function hasConflict(
  events: CalendarEvent[],
  newStart: string,
  newEnd: string,
  excludeId: string,
): boolean {
  return events.some(
    (e) =>
      e.id !== excludeId &&
      e.id.split("::")[0] !== excludeId.split("::")[0] &&
      newStart < e.endAt &&
      e.startAt < newEnd,
  )
}
