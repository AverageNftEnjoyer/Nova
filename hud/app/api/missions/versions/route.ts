import { NextResponse } from "next/server"

import { loadMissions, upsertMission } from "@/lib/missions/store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { listMissionVersions, restoreMissionVersion, validateMissionGraphForVersioning } from "@/lib/missions/workflow/versioning"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import { syncMissionScheduleToGoogleCalendar } from "@/lib/calendar/google-schedule-mirror"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionVersionsRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)
  const url = new URL(req.url)
  const missionId = String(url.searchParams.get("missionId") || "").trim()
  const limit = Number.parseInt(String(url.searchParams.get("limit") || "50"), 10)
  if (!missionId) {
    return NextResponse.json({ ok: false, error: "missionId query param is required." }, { status: 400 })
  }
  const versions = await listMissionVersions({
    userContextId: userId,
    missionId,
    limit: Number.isFinite(limit) ? limit : 50,
  })
  return NextResponse.json({ ok: true, versions })
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionVersionRestore)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)
  let body: {
    missionId?: string
    versionId?: string
    reason?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 })
  }
  const missionId = String(body.missionId || "").trim()
  const versionId = String(body.versionId || "").trim()
  if (!missionId || !versionId) {
    return NextResponse.json({ ok: false, error: "missionId and versionId are required." }, { status: 400 })
  }
  const missions = await loadMissions({ userId })
  const currentMission = missions.find((row) => row.id === missionId)
  if (!currentMission) {
    return NextResponse.json({ ok: false, error: "Mission not found." }, { status: 404 })
  }
  const restored = await restoreMissionVersion({
    userContextId: userId,
    actorId: userId,
    missionId,
    versionId,
    currentMission,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    validateMission: (mission) => {
      const issues = validateMissionGraphForVersioning(mission)
      return { ok: issues.length === 0, issues }
    },
  })
  if (!restored.ok || !restored.mission) {
    await emitMissionTelemetryEvent({
      eventType: "mission.rollback.failed",
      status: "error",
      userContextId: userId,
      missionId,
      metadata: {
        versionId,
        reason: restored.error || "Restore failed.",
      },
    }).catch(() => {})
    return NextResponse.json(
      {
        ok: false,
        error: restored.error || "Restore failed.",
        restore: {
          backupVersionId: restored.backupVersionId,
        },
      },
      { status: 409 },
    )
  }
  await upsertMission(restored.mission, userId)
  await syncMissionScheduleToGoogleCalendar({ mission: restored.mission, scope: verified }).catch((error) => {
    console.warn("[missions.versions][gcalendar_sync] schedule mirror failed:", error instanceof Error ? error.message : String(error))
  })
  await emitMissionTelemetryEvent({
    eventType: "mission.rollback.completed",
    status: "success",
    userContextId: userId,
    missionId,
    metadata: {
      versionId,
      restoredVersionId: restored.restoredVersionId,
      backupVersionId: restored.backupVersionId,
    },
  }).catch(() => {})
  return NextResponse.json({
    ok: true,
    mission: restored.mission,
    restore: {
      restoredVersionId: restored.restoredVersionId,
      backupVersionId: restored.backupVersionId,
    },
  })
}
