import { NextResponse } from "next/server"

import { buildMissionFromPrompt } from "@/lib/missions/runtime"
import { ensureMissionSchedulerStarted } from "@/lib/notifications/scheduler"
import { upsertMission } from "@/lib/missions/store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import { syncMissionScheduleToGoogleCalendar } from "@/lib/calendar/google-schedule-mirror"
import {
  finalizeMissionBuildRequest,
  reserveMissionBuildRequest,
} from "../../../../../src/runtime/modules/services/missions/build-idempotency/index.js"
import { runMissionBuildRequest } from "../../../../../src/runtime/modules/services/missions/build-execution/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) return runtimeSharedTokenErrorResponse(runtimeTokenDecision)

  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.missionBuild)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  const userId = verified.user.id
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string
    deploy?: boolean
    timezone?: string
    enabled?: boolean
    engine?: string
  }

  const result = await runMissionBuildRequest(
    {
      ...body,
      userContextId: userId,
      scope: verified,
    },
    {
      ensureMissionSchedulerStarted,
      reserveMissionBuildRequest,
      finalizeMissionBuildRequest,
      buildMissionFromPrompt,
      upsertMission,
      syncMissionScheduleToGoogleCalendar,
      emitTelemetry: emitMissionTelemetryEvent,
      warn: console.warn,
    },
  )

  const headers = new Headers()
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (value != null && String(value).trim()) headers.set(key, String(value))
  }
  return NextResponse.json(result.body, { status: result.statusCode, headers })
}
