import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { getDb } from "../../../../../../src/db/index.js"

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
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionRunStatusRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const { missionRunId: rawMissionRunId } = await context.params
  const missionRunId = String(rawMissionRunId || "").trim()
  if (!missionRunId) {
    return NextResponse.json({ ok: false, error: "missionRunId is required." }, { status: 400 })
  }

  try {
    const row = getDb()
      .prepare(
        `SELECT id, mission_id, status, source, attempt, max_attempts, scheduled_for, started_at, finished_at,
                duration_ms, error_code, error_detail, created_at
         FROM job_runs WHERE id = ? AND user_id = ?`,
      )
      .get(missionRunId, userId) as MissionRunRow | undefined

    if (!row) {
      return NextResponse.json({ ok: false, error: "Mission run not found." }, { status: 404 })
    }

    return NextResponse.json({ ok: true, run: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load mission run."
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
