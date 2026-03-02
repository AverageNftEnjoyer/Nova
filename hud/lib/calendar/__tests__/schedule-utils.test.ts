import assert from "node:assert/strict"
import test from "node:test"

import { expandDates, toIsoInTimezone, estimateDurationMs } from "../schedule-utils/index.ts"

// ─── expandDates ──────────────────────────────────────────────────────────────

test("expandDates: daily emits every day in range", () => {
  const start = new Date("2026-03-01T00:00:00Z")
  const end   = new Date("2026-03-04T00:00:00Z")
  const result = expandDates(start, end, "daily", undefined)
  assert.deepEqual(result, ["2026-03-01", "2026-03-02", "2026-03-03"])
})

test("expandDates: daily with empty range returns nothing", () => {
  const d = new Date("2026-03-01T00:00:00Z")
  assert.deepEqual(expandDates(d, d, "daily", undefined), [])
})

test("expandDates: weekly filters to correct days of week", () => {
  // Mon 2 Mar – Sat 7 Mar 2026 (exclusive end = Sun 8 noon so Mon 9 is not included)
  const start = new Date("2026-03-02T12:00:00Z")
  const end   = new Date("2026-03-08T12:00:00Z") // Sun noon — Mon 9 not reached
  const result = expandDates(start, end, "weekly", ["mon", "wed", "fri"])
  assert.deepEqual(result, ["2026-03-02", "2026-03-04", "2026-03-06"])
})

test("expandDates: weekly with no matching days returns empty", () => {
  // Tuesday only in range
  const start = new Date("2026-03-03T12:00:00Z")
  const end   = new Date("2026-03-04T12:00:00Z")
  const result = expandDates(start, end, "weekly", ["sat", "sun"])
  assert.deepEqual(result, [])
})

test("expandDates: once emits only the first date", () => {
  const start = new Date("2026-03-02T00:00:00Z")
  const end   = new Date("2026-03-09T00:00:00Z")
  const result = expandDates(start, end, "once", undefined)
  assert.equal(result.length, 1)
  assert.equal(result[0], "2026-03-02")
})

test("expandDates: unknown mode returns empty", () => {
  const start = new Date("2026-03-02T00:00:00Z")
  const end   = new Date("2026-03-09T00:00:00Z")
  assert.deepEqual(expandDates(start, end, "monthly", undefined), [])
})

// ─── toIsoInTimezone ──────────────────────────────────────────────────────────

test("toIsoInTimezone: returns valid ISO string", () => {
  const iso = toIsoInTimezone("2026-03-10", "09:00", "America/New_York")
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test("toIsoInTimezone: EST offset applied (UTC = local + 5h)", () => {
  const iso = toIsoInTimezone("2026-01-15", "09:00", "America/New_York")
  const date = new Date(iso)
  // 9 AM EST = 14:00 UTC in winter
  assert.equal(date.getUTCHours(), 14)
  assert.equal(date.getUTCMinutes(), 0)
})

test("toIsoInTimezone: UTC timezone gives same time", () => {
  const iso = toIsoInTimezone("2026-03-10", "12:00", "UTC")
  const date = new Date(iso)
  assert.equal(date.getUTCHours(), 12)
})

test("toIsoInTimezone: invalid time falls back gracefully", () => {
  const iso = toIsoInTimezone("2026-03-10", "bad:time", "America/New_York")
  assert.ok(!isNaN(new Date(iso).getTime()), "should return valid ISO even on bad input")
})

// ─── estimateDurationMs ───────────────────────────────────────────────────────

test("estimateDurationMs: 1 node = 75s", () => {
  assert.equal(estimateDurationMs(1), 75_000)
})

test("estimateDurationMs: 5 nodes = 255s", () => {
  assert.equal(estimateDurationMs(5), 255_000)
})

test("estimateDurationMs: 0 nodes = 30s base", () => {
  assert.equal(estimateDurationMs(0), 30_000)
})
