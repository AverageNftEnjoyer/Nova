import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { loadMissions } from "@/lib/missions/store"
import { setRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { aggregateCalendarEvents } from "@/lib/calendar/aggregator"
import { hasConflict } from "@/lib/calendar/conflict-detector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PATCH /api/calendar/reschedule
 *
 * Body: { missionId: string; newStartAt: string /* ISO8601 * / }
 *
 * Persists a calendar drag-drop reschedule override.
 * Does NOT modify the Mission graph — the scheduler reads the override
 * from reschedule-store on its next tick.
 *
 * Returns { ok: true; conflict: boolean } or error.
 */
export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id

  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionSave)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Body must be a JSON object." }, { status: 400 })
  }

  const { missionId: rawMissionId, newStartAt } = body as Record<string, unknown>

  if (typeof rawMissionId !== "string" || !rawMissionId.trim()) {
    return NextResponse.json({ ok: false, error: "missionId is required." }, { status: 400 })
  }
  const missionId = rawMissionId.trim().slice(0, 256)
  if (typeof newStartAt !== "string" || isNaN(new Date(newStartAt).getTime())) {
    return NextResponse.json({ ok: false, error: "newStartAt must be a valid ISO8601 string." }, { status: 400 })
  }

  // Verify the mission belongs to this user
  const missions = await loadMissions({ userId })
  const mission = missions.find((m) => m.id === missionId)
  if (!mission) {
    return NextResponse.json({ ok: false, error: "Mission not found." }, { status: 404 })
  }

  // Cannot reschedule to a time in the past (>10 min buffer for latency)
  const newDate = new Date(newStartAt)
  if (newDate.getTime() < Date.now() - 10 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: "Cannot reschedule to a past time." }, { status: 422 })
  }

  // Conflict check against a 24-hour window around the new time
  const windowStart = new Date(newDate.getTime() - 12 * 60 * 60 * 1000)
  const windowEnd   = new Date(newDate.getTime() + 12 * 60 * 60 * 1000)
  const windowEvents = await aggregateCalendarEvents(userId, windowStart, windowEnd)

  // Estimate duration same way as aggregator
  const nodeCount = mission.nodes?.length ?? 1
  const durationMs = (30 + nodeCount * 45) * 1000
  const newEndAt = new Date(newDate.getTime() + durationMs).toISOString()

  const conflictDetected = hasConflict(windowEvents, newStartAt, newEndAt, missionId)

  // Determine the original time for the record
  const trigger = mission.nodes?.find((n) => n.type === "schedule-trigger") as
    | { triggerTime?: string } | undefined
  const originalTime = trigger?.triggerTime
    ? `${newDate.toISOString().slice(0, 10)}T${trigger.triggerTime}:00Z`
    : newDate.toISOString()

  await setRescheduleOverride(userId, missionId, newStartAt, originalTime)

  return NextResponse.json({ ok: true, conflict: conflictDetected, newStartAt })
}
