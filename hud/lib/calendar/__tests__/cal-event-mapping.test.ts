/**
 * Tests for apiEventToCalEvent logic — all-day detection, grid clamping,
 * durMin floor, htmlLink safety guard.
 *
 * We inline the logic from page.tsx so this test file has zero Next.js deps.
 */
import assert from "node:assert/strict"
import test from "node:test"

import type { CalendarEvent, PersonalCalendarEvent, MissionCalendarEvent } from "../types/index.js"

// ─── Constants (mirrored from page.tsx) ──────────────────────────────────────

const GRID_START = 6

// ─── Inline CalEvent type ─────────────────────────────────────────────────────

interface CalEvent {
  id:          string
  kind:        string
  title:       string
  sub?:        string
  date:        Date
  startH:      number
  startM:      number
  durMin:      number
  status:      string
  missionId?:  string
  nodeCount?:  number
  conflict?:   boolean
  allDay?:     boolean
  provider?:   string
  externalId?: string
  htmlLink?:   string
}

// ─── Inline apiEventToCalEvent from page.tsx ──────────────────────────────────

function apiEventToCalEvent(ev: CalendarEvent): CalEvent | null {
  const start    = new Date(ev.startAt)
  const end      = new Date(ev.endAt)
  const personal = ev.kind === "personal" ? (ev as PersonalCalendarEvent) : null

  const durMs  = end.getTime() - start.getTime()
  const allDay = personal?.provider === "gcalendar" && durMs >= 20 * 60 * 60 * 1000

  const rawH   = start.getHours()
  const startH = allDay ? GRID_START : Math.max(rawH, 0)
  const startM = allDay ? 0 : start.getMinutes()
  const durMin = allDay ? 60 : Math.max(Math.round(durMs / 60000), 15)

  return {
    id:         ev.id,
    kind:       ev.kind,
    title:      ev.title,
    sub:        ev.subtitle,
    date:       start,
    startH,
    startM,
    durMin,
    status:     ev.status,
    missionId:  ev.kind === "mission" ? (ev as MissionCalendarEvent).missionId : undefined,
    nodeCount:  ev.kind === "mission" ? (ev as MissionCalendarEvent).nodeCount  : undefined,
    conflict:   ev.kind === "mission" ? (ev as MissionCalendarEvent).conflict   : undefined,
    allDay,
    provider:   personal?.provider,
    externalId: personal?.externalId,
    htmlLink:   personal?.htmlLink,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePersonal(overrides: Partial<PersonalCalendarEvent> = {}): PersonalCalendarEvent {
  return {
    id: "p1",
    kind: "personal",
    provider: "gcalendar",
    title: "Test Event",
    startAt: "2026-03-10T14:00:00Z",
    endAt:   "2026-03-10T15:00:00Z",
    status: "scheduled",
    reschedulable: false,
    ...overrides,
  }
}

function makeMission(overrides: Partial<MissionCalendarEvent> = {}): MissionCalendarEvent {
  return {
    id: "m1",
    kind: "mission",
    missionId: "m1",
    title: "Test Mission",
    startAt: "2026-03-10T09:00:00Z",
    endAt:   "2026-03-10T09:30:00Z",
    status: "scheduled",
    nodeCount: 5,
    reschedulable: true,
    ...overrides,
  }
}

// ─── Timed personal event ─────────────────────────────────────────────────────

test("timed personal event: correct hours and minutes extracted", () => {
  const ev = makePersonal({ startAt: "2026-03-10T14:30:00Z", endAt: "2026-03-10T15:00:00Z" })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.startH, new Date("2026-03-10T14:30:00Z").getHours())
  assert.equal(result.startM, new Date("2026-03-10T14:30:00Z").getMinutes())
  assert.equal(result.allDay, false)
})

test("timed personal event: durMin correct", () => {
  const ev = makePersonal({ startAt: "2026-03-10T09:00:00Z", endAt: "2026-03-10T10:30:00Z" })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.durMin, 90)
})

// ─── All-day detection ────────────────────────────────────────────────────────

test("all-day event (>=20h duration): allDay=true, startH clamped to GRID_START", () => {
  // All-day event parsed at local noon → 12:00 UTC → startH=12 but should clamp to GRID_START
  const startAt = new Date("2026-03-10T12:00:00Z").toISOString()
  const endAt   = new Date("2026-03-11T12:00:00Z").toISOString() // 24h later
  const ev = makePersonal({ startAt, endAt })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.allDay, true)
  assert.equal(result.startH, GRID_START)
  assert.equal(result.startM, 0)
  assert.equal(result.durMin, 60, "all-day events get a fixed 60-min display pill")
})

test("all-day detection: 19h duration is NOT all-day", () => {
  const startAt = new Date("2026-03-10T09:00:00Z").toISOString()
  const endAt   = new Date("2026-03-11T04:00:00Z").toISOString() // 19h
  const ev = makePersonal({ startAt, endAt })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.allDay, false)
})

test("all-day detection: manual provider is never all-day even with 24h span", () => {
  const startAt = new Date("2026-03-10T00:00:00Z").toISOString()
  const endAt   = new Date("2026-03-11T00:00:00Z").toISOString()
  const ev = makePersonal({ provider: "manual", startAt, endAt })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.allDay, false)
})

// ─── durMin floor ─────────────────────────────────────────────────────────────

test("durMin is floored at 15 for very short events", () => {
  const ev = makePersonal({
    startAt: "2026-03-10T09:00:00Z",
    endAt:   "2026-03-10T09:05:00Z", // 5 min
  })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.durMin, 15)
})

test("durMin is floored at 15 when start === end (zero duration)", () => {
  const ev = makePersonal({
    startAt: "2026-03-10T09:00:00Z",
    endAt:   "2026-03-10T09:00:00Z",
  })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.durMin, 15)
})

// ─── htmlLink safety ─────────────────────────────────────────────────────────

test("htmlLink is preserved when it starts with https://", () => {
  const ev = makePersonal({ htmlLink: "https://calendar.google.com/event?eid=abc" })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.htmlLink, "https://calendar.google.com/event?eid=abc")
})

test("htmlLink is preserved as-is in mapping (safety guard is in JSX render)", () => {
  // The mapping passes through whatever Google sent — the guard is in the render:
  // ev.htmlLink?.startsWith("https://")
  // This test confirms the value comes through unchanged.
  const ev = makePersonal({ htmlLink: "https://legit.example.com" })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.htmlLink, "https://legit.example.com")
})

test("htmlLink is undefined when not provided", () => {
  const ev = makePersonal({ htmlLink: undefined })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.htmlLink, undefined)
})

// ─── Mission event passthrough ────────────────────────────────────────────────

test("mission event: missionId and nodeCount passed through", () => {
  const ev = makeMission({ missionId: "m-xyz", nodeCount: 7 })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.missionId, "m-xyz")
  assert.equal(result.nodeCount, 7)
  assert.equal(result.allDay, false)
  assert.equal(result.provider, undefined)
})

test("mission event: conflict flag passed through", () => {
  const ev = makeMission({ conflict: true })
  const result = apiEventToCalEvent(ev)!
  assert.equal(result.conflict, true)
})
