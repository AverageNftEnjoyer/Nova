/**
 * Tests pure mapping logic from gmail-calendar-source without DB/server imports.
 * We inline the mapping function under test to avoid server-only import barriers.
 */
import assert from "node:assert/strict"
import test from "node:test"

import type { PersonalCalendarEvent } from "../types.js"
import type { GmailCalendarEventItem } from "../../integrations/gcalendar/types.js"

// ─── Inline the mapping from gmail-calendar-source ────────────────────────────

function mapGcalEvent(ev: GmailCalendarEventItem, rangeStart: Date): PersonalCalendarEvent | null {
  if (ev.status === "cancelled" || !ev.id) return null

  const isAllDay = !ev.start?.dateTime

  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? ""
  const endRaw   = ev.end?.dateTime   ?? ev.end?.date   ?? ""

  const startAt = startRaw
    ? isAllDay
      ? new Date(`${startRaw}T12:00:00`).toISOString()
      : new Date(startRaw).toISOString()
    : rangeStart.toISOString()

  const endAt = endRaw
    ? isAllDay
      ? new Date(`${endRaw}T12:00:00`).toISOString()
      : new Date(endRaw).toISOString()
    : new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString()

  return {
    id: `gcal::${ev.id}`,
    kind: "personal",
    provider: "gcalendar",
    externalId: ev.id,
    htmlLink: ev.htmlLink,
    title: ev.summary || "(No title)",
    subtitle: ev.organizer?.email,
    startAt,
    endAt,
    status: "scheduled",
    reschedulable: false,
  }
}

const RANGE_START = new Date("2026-03-10T00:00:00Z")

// ─── Timed events ─────────────────────────────────────────────────────────────

test("maps timed event to PersonalCalendarEvent correctly", () => {
  const ev: GmailCalendarEventItem = {
    id: "abc123",
    summary: "Team Standup",
    start: { dateTime: "2026-03-10T09:00:00-05:00" },
    end:   { dateTime: "2026-03-10T09:30:00-05:00" },
    htmlLink: "https://calendar.google.com/event?eid=abc",
    organizer: { email: "boss@example.com" },
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.ok(result)
  assert.equal(result.id, "gcal::abc123")
  assert.equal(result.kind, "personal")
  assert.equal(result.provider, "gcalendar")
  assert.equal(result.externalId, "abc123")
  assert.equal(result.title, "Team Standup")
  assert.equal(result.subtitle, "boss@example.com")
  assert.equal(result.htmlLink, "https://calendar.google.com/event?eid=abc")
  assert.equal(result.reschedulable, false)
  // Duration = 30 min
  const durMs = new Date(result.endAt).getTime() - new Date(result.startAt).getTime()
  assert.equal(durMs, 30 * 60 * 1000)
})

// ─── All-day events ───────────────────────────────────────────────────────────

test("all-day event: no dateTime — parsed as local noon, duration >= 20h", () => {
  const ev: GmailCalendarEventItem = {
    id: "alldayX",
    summary: "Holiday",
    start: { date: "2026-03-15" },
    end:   { date: "2026-03-16" },
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.ok(result)
  // Start should be 2026-03-15T12:00:00 local → ISO UTC
  assert.match(result.startAt, /2026-03-15/)
  // End should be 2026-03-16T12:00:00 → 24h later
  const durMs = new Date(result.endAt).getTime() - new Date(result.startAt).getTime()
  assert.equal(durMs, 24 * 60 * 60 * 1000, "all-day duration should be 24 hours")
})

test("all-day event with no end: fallback is startAt + 1 hour", () => {
  const ev: GmailCalendarEventItem = {
    id: "noend",
    summary: "No End",
    start: { date: "2026-03-15" },
    // no end
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.ok(result)
  const durMs = new Date(result.endAt).getTime() - new Date(result.startAt).getTime()
  assert.equal(durMs, 60 * 60 * 1000, "fallback duration should be 1 hour")
})

// ─── Filtering ────────────────────────────────────────────────────────────────

test("cancelled event is filtered out", () => {
  const ev: GmailCalendarEventItem = {
    id: "cancelled1",
    summary: "Cancelled Meeting",
    start: { dateTime: "2026-03-10T10:00:00Z" },
    end:   { dateTime: "2026-03-10T10:30:00Z" },
    status: "cancelled",
  }
  assert.equal(mapGcalEvent(ev, RANGE_START), null)
})

test("event with no id is filtered out", () => {
  const ev: GmailCalendarEventItem = {
    id: "",
    summary: "No ID",
    start: { dateTime: "2026-03-10T10:00:00Z" },
    end:   { dateTime: "2026-03-10T10:30:00Z" },
    status: "confirmed",
  }
  assert.equal(mapGcalEvent(ev, RANGE_START), null)
})

test("no summary falls back to (No title)", () => {
  const ev: GmailCalendarEventItem = {
    id: "notitle",
    start: { dateTime: "2026-03-10T10:00:00Z" },
    end:   { dateTime: "2026-03-10T10:30:00Z" },
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.ok(result)
  assert.equal(result.title, "(No title)")
})

// ─── id prefix ────────────────────────────────────────────────────────────────

test("id is prefixed with gcal::", () => {
  const ev: GmailCalendarEventItem = {
    id: "xyz",
    summary: "Test",
    start: { dateTime: "2026-03-10T10:00:00Z" },
    end:   { dateTime: "2026-03-10T11:00:00Z" },
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.equal(result?.id, "gcal::xyz")
})

// ─── rangeStart fallback ──────────────────────────────────────────────────────

test("missing start date falls back to rangeStart", () => {
  const ev: GmailCalendarEventItem = {
    id: "nostart",
    summary: "No Start",
    status: "confirmed",
  }
  const result = mapGcalEvent(ev, RANGE_START)
  assert.ok(result)
  assert.equal(result.startAt, RANGE_START.toISOString())
})
