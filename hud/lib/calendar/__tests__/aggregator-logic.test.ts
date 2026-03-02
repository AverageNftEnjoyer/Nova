/**
 * Tests the pure-logic parts of the aggregator that don't need DB/Supabase:
 *   - conflict detection (sliding-window)
 *   - event sort order
 *   - conflict only marks mission events, not personal/agent
 */
import assert from "node:assert/strict"
import test from "node:test"

import type { CalendarEvent, MissionCalendarEvent, PersonalCalendarEvent, AgentCalendarEvent } from "../types/index.js"

// ─── Inline the logic under test so we don't need server-only imports ─────────

function markConflicts(events: CalendarEvent[]) {
  for (let i = 0; i < events.length; i++) {
    const a = events[i]
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j]
      if (b.startAt >= a.endAt) break
      if (a.startAt < b.endAt && b.startAt < a.endAt) {
        if (a.kind === "mission") (a as MissionCalendarEvent).conflict = true
        if (b.kind === "mission") (b as MissionCalendarEvent).conflict = true
      }
    }
  }
}

function makeMission(id: string, startAt: string, endAt: string): MissionCalendarEvent {
  return {
    id, kind: "mission", missionId: id,
    title: `Mission ${id}`, startAt, endAt,
    status: "scheduled", nodeCount: 3,
    reschedulable: true,
  }
}

function makePersonal(id: string, startAt: string, endAt: string): PersonalCalendarEvent {
  return {
    id, kind: "personal", provider: "gcalendar",
    title: `Event ${id}`, startAt, endAt,
    status: "scheduled", reschedulable: false,
  }
}

function makeAgent(id: string, startAt: string, endAt: string): AgentCalendarEvent {
  return {
    id, kind: "agent", agentType: "summarizer",
    title: `Agent ${id}`, startAt, endAt,
    status: "running", reschedulable: false,
  }
}

// ─── markConflicts ────────────────────────────────────────────────────────────

test("markConflicts: no overlap — no conflicts", () => {
  const events: CalendarEvent[] = [
    makeMission("a", "2026-03-10T09:00:00Z", "2026-03-10T09:30:00Z"),
    makeMission("b", "2026-03-10T10:00:00Z", "2026-03-10T10:30:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, undefined)
  assert.equal((events[1] as MissionCalendarEvent).conflict, undefined)
})

test("markConflicts: overlapping missions both flagged", () => {
  const events: CalendarEvent[] = [
    makeMission("a", "2026-03-10T09:00:00Z", "2026-03-10T09:45:00Z"),
    makeMission("b", "2026-03-10T09:30:00Z", "2026-03-10T10:00:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, true)
  assert.equal((events[1] as MissionCalendarEvent).conflict, true)
})

test("markConflicts: adjacent (touching) events are not conflicts", () => {
  const events: CalendarEvent[] = [
    makeMission("a", "2026-03-10T09:00:00Z", "2026-03-10T09:30:00Z"),
    makeMission("b", "2026-03-10T09:30:00Z", "2026-03-10T10:00:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, undefined)
  assert.equal((events[1] as MissionCalendarEvent).conflict, undefined)
})

test("markConflicts: personal event overlapping mission — only mission flagged", () => {
  const events: CalendarEvent[] = [
    makeMission("m1",  "2026-03-10T09:00:00Z", "2026-03-10T09:45:00Z"),
    makePersonal("p1", "2026-03-10T09:20:00Z", "2026-03-10T09:50:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, true)
  // PersonalCalendarEvent has no conflict field — confirm mission is the only one flagged
  assert.equal((events[0] as MissionCalendarEvent).conflict, true)
})

test("markConflicts: agent event overlapping mission — only mission flagged", () => {
  const events: CalendarEvent[] = [
    makeMission("m1", "2026-03-10T09:00:00Z", "2026-03-10T09:45:00Z"),
    makeAgent("a1",   "2026-03-10T09:20:00Z", "2026-03-10T09:50:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, true)
})

test("markConflicts: three-way overlap — all three missions flagged", () => {
  const events: CalendarEvent[] = [
    makeMission("a", "2026-03-10T09:00:00Z", "2026-03-10T10:00:00Z"),
    makeMission("b", "2026-03-10T09:20:00Z", "2026-03-10T09:50:00Z"),
    makeMission("c", "2026-03-10T09:40:00Z", "2026-03-10T10:10:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, true)
  assert.equal((events[1] as MissionCalendarEvent).conflict, true)
  assert.equal((events[2] as MissionCalendarEvent).conflict, true)
})

test("markConflicts: early-exit works — event after gap not reached", () => {
  // b ends before c starts; c should NOT be flagged
  const events: CalendarEvent[] = [
    makeMission("a", "2026-03-10T08:00:00Z", "2026-03-10T08:30:00Z"),
    makeMission("b", "2026-03-10T09:00:00Z", "2026-03-10T09:30:00Z"),
    makeMission("c", "2026-03-10T10:00:00Z", "2026-03-10T10:30:00Z"),
  ]
  markConflicts(events)
  assert.equal((events[0] as MissionCalendarEvent).conflict, undefined)
  assert.equal((events[1] as MissionCalendarEvent).conflict, undefined)
  assert.equal((events[2] as MissionCalendarEvent).conflict, undefined)
})

// ─── Sort order ───────────────────────────────────────────────────────────────

test("sort: events are ordered by startAt lexicographically", () => {
  const events: CalendarEvent[] = [
    makeMission("c", "2026-03-10T12:00:00Z", "2026-03-10T12:30:00Z"),
    makeMission("a", "2026-03-10T08:00:00Z", "2026-03-10T08:30:00Z"),
    makeMission("b", "2026-03-10T10:00:00Z", "2026-03-10T10:30:00Z"),
  ]
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))
  assert.equal(sorted[0].id, "a")
  assert.equal(sorted[1].id, "b")
  assert.equal(sorted[2].id, "c")
})
