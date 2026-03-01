import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { aggregateCalendarEvents } from "@/lib/calendar/aggregator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SLOW_CALENDAR_EVENTS_MS = 1_200

/**
 * GET /api/calendar/events?start=ISO&end=ISO
 *
 * Returns CalendarEvent[] for the authenticated user within the requested
 * time range. Scoped strictly to userId — no cross-user reads possible.
 *
 * Phase 1: MissionInstance events only.
 * Phase 2+: AgentTask, PersonalEvent sources added here.
 */
export async function GET(req: Request) {
  const requestStartedAt = Date.now()
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id

  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.calendarEventsRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const url = new URL(req.url)
  const startParam = url.searchParams.get("start")
  const endParam = url.searchParams.get("end")

  // Default: current week (Mon–Sun)
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sun
  const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  const rangeStart = startParam ? new Date(startParam) : weekStart
  const rangeEnd = endParam ? new Date(endParam) : weekEnd

  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid start or end date." }, { status: 400 })
  }
  if (rangeEnd.getTime() <= rangeStart.getTime()) {
    return NextResponse.json({ ok: false, error: "end must be after start." }, { status: 400 })
  }
  if (rangeEnd.getTime() - rangeStart.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: "Range cannot exceed 90 days." }, { status: 400 })
  }

  const MAX_EVENTS_RESPONSE = 2000

  try {
    const aggregateStartedAt = Date.now()
    const allEvents = await aggregateCalendarEvents(userId, rangeStart, rangeEnd, verified)
    const aggregateMs = Date.now() - aggregateStartedAt
    const totalMs = Date.now() - requestStartedAt
    const truncated = allEvents.length > MAX_EVENTS_RESPONSE
    const events = truncated ? allEvents.slice(0, MAX_EVENTS_RESPONSE) : allEvents
    const missionCount = allEvents.filter((event) => event.kind === "mission").length
    const personalCount = allEvents.filter((event) => event.kind === "personal").length
    const agentCount = allEvents.filter((event) => event.kind === "agent").length
    if (totalMs >= SLOW_CALENDAR_EVENTS_MS) {
      console.info(
        "[calendar.events][latency]",
        JSON.stringify({
          userContextId: userId,
          totalMs,
          aggregateMs,
          totalEvents: allEvents.length,
          missionCount,
          personalCount,
          agentCount,
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString(),
        }),
      )
    }
    const headers = new Headers()
    headers.set("Cache-Control", "no-store")
    headers.set("Server-Timing", `aggregate;dur=${aggregateMs}, total;dur=${totalMs}`)
    return NextResponse.json({
      ok: true,
      events,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      ...(truncated ? { truncated: true, totalCount: allEvents.length } : {}),
      telemetry: {
        totalMs,
        aggregateMs,
        totalEvents: allEvents.length,
        missionCount,
        personalCount,
        agentCount,
      },
    }, { headers })
  } catch (err) {
    console.warn(
      "[calendar.events][error]",
      JSON.stringify({
        userContextId: userId,
        totalMs: Date.now() - requestStartedAt,
        error: err instanceof Error ? err.message : "Failed to load calendar events.",
      }),
    )
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load calendar events." },
      { status: 500 },
    )
  }
}
