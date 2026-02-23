import { NextResponse } from "next/server"

import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { evaluateMissionSlos, listMissionTelemetryEvents, MISSION_SLO_POLICY } from "@/lib/missions/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionReliabilityRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(30, Number.parseInt(String(url.searchParams.get("days") || ""), 10) || MISSION_SLO_POLICY.lookbackDays))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const events = await listMissionTelemetryEvents({
    userContextId: userId,
    sinceTs: since,
    limit: 5000,
  })
  const evaluation = evaluateMissionSlos(events)

  return NextResponse.json({
    ok: true,
    lookbackDays: days,
    since,
    summary: evaluation.summary,
    slos: evaluation.statuses,
    totalEvents: events.length,
  })
}
