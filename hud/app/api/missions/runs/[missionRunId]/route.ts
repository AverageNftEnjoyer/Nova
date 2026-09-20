import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

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
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionRunStatusRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const { missionRunId: rawMissionRunId } = await context.params
  const missionRunId = String(rawMissionRunId || "").trim()
  if (!missionRunId) {
    return NextResponse.json({ ok: false, error: "missionRunId is required." }, { status: 400 })
  }

  // Local-only mode - no database
  return NextResponse.json({ ok: false, error: "Mission run not found." }, { status: 404 })
}
