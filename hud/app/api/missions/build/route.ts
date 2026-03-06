import { NextResponse } from "next/server"

import { buildMissionFromPrompt } from "@/lib/missions/runtime"
import { ensureMissionSchedulerStarted as ensureHudMissionSchedulerStarted } from "@/lib/notifications/scheduler"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/google-calendar/service"
import { estimateDurationMs, toIsoInTimezone } from "@/lib/calendar/schedule-utils"
import { getLocalParts } from "@/lib/missions/workflow/time"
import {
  finalizeMissionBuildRequest,
  reserveMissionBuildRequest,
} from "../../../../../src/runtime/modules/services/missions/build-idempotency/index.js"
import { runMissionBuildRequest } from "../../../../../src/runtime/modules/services/missions/build-execution/index.js"
import { upsertMission } from "../../../../../src/runtime/modules/services/missions/persistence/index.js"
import { ensureMissionSchedulerStarted } from "../../../../../src/runtime/modules/services/missions/scheduler/index.js"
import { syncMissionScheduleToGoogleCalendar } from "../../../../../src/runtime/modules/services/missions/calendar-mirror/index.js"
import { resolveTimezone } from "../../../../../src/runtime/modules/services/shared/timezone/index.js"

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
      ensureMissionSchedulerStarted: () => ensureMissionSchedulerStarted({
        startScheduler: ensureHudMissionSchedulerStarted,
      }),
      reserveMissionBuildRequest,
      finalizeMissionBuildRequest,
      buildMissionFromPrompt,
      upsertMission,
      syncMissionScheduleToGoogleCalendar: (params: { mission: unknown; scope?: unknown }) => (
        syncMissionScheduleToGoogleCalendar(params, {
          loadIntegrationsConfig,
          createCalendarEvent,
          deleteCalendarEvent,
          estimateDurationMs,
          toIsoInTimezone,
          getLocalParts,
          resolveTimezone,
          warn: console.warn,
          info: console.info,
        })
      ),
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
