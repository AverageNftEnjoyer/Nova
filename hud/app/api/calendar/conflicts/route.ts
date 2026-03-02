import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { aggregateCalendarEvents } from "@/lib/calendar/aggregator"
import { detectConflicts } from "@/lib/calendar/conflict-detector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/calendar/conflicts?start=ISO&end=ISO
 *
 * Returns ConflictGroup[] for the authenticated user in the requested range.
 * Fully user-scoped via verified.user.id.
 */
export async function GET(req: Request) {
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

  const now = new Date()
  const rangeStart = startParam ? new Date(startParam) : now
  const rangeEnd = endParam ? new Date(endParam) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid start or end date." }, { status: 400 })
  }
  if (rangeEnd.getTime() <= rangeStart.getTime()) {
    return NextResponse.json({ ok: false, error: "end must be after start." }, { status: 400 })
  }
  if (rangeEnd.getTime() - rangeStart.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: "Range cannot exceed 90 days." }, { status: 400 })
  }

  try {
    const events = await aggregateCalendarEvents(userId, rangeStart, rangeEnd, verified)
    const conflicts = detectConflicts(events)
    return NextResponse.json({
      ok: true,
      conflicts,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to detect conflicts." },
      { status: 500 },
    )
  }
}

