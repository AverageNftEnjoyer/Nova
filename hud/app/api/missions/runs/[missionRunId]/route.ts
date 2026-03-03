import { NextResponse } from "next/server"

import { createSupabaseAdminClient, requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type MissionRunRow = {
  id: string
  mission_id: string
  status: string
  source: string
  attempt: number
  max_attempts: number
  scheduled_for: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_detail: string | null
  created_at: string
}

export async function GET(
  req: Request,
  context: { params: Promise<{ missionRunId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionRunStatusRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const { missionRunId: rawMissionRunId } = await context.params
  const missionRunId = String(rawMissionRunId || "").trim()
  if (!missionRunId) {
    return NextResponse.json({ ok: false, error: "missionRunId is required." }, { status: 400 })
  }

  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from("job_runs")
    .select("id, mission_id, status, source, attempt, max_attempts, scheduled_for, started_at, finished_at, duration_ms, error_code, error_detail, created_at")
    .eq("id", missionRunId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message || "Failed to load mission run status." }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Mission run not found." }, { status: 404 })
  }

  const row = data as MissionRunRow
  return NextResponse.json({
    ok: true,
    run: {
      id: row.id,
      missionId: row.mission_id,
      status: row.status,
      source: row.source,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      scheduledFor: row.scheduled_for,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
      errorDetail: row.error_detail,
      createdAt: row.created_at,
    },
  })
}
