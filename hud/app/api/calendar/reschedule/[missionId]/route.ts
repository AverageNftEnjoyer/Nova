import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { deleteRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { loadMissions } from "@/lib/missions/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * DELETE /api/calendar/reschedule/:missionId
 *
 * Removes a calendar reschedule override, restoring the mission to its
 * original schedule-trigger time.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id

  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionSave)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const rawMissionId = (await params).missionId
  if (!rawMissionId) {
    return NextResponse.json({ ok: false, error: "missionId is required." }, { status: 400 })
  }
  const missionId = String(rawMissionId).trim().slice(0, 256)

  // Verify mission belongs to this user before touching their data
  const missions = await loadMissions({ userId })
  const owns = missions.some((m) => m.id === missionId)
  if (!owns) {
    return NextResponse.json({ ok: false, error: "Mission not found." }, { status: 404 })
  }

  const deleted = await deleteRescheduleOverride(userId, missionId)
  return NextResponse.json({ ok: true, deleted })
}
