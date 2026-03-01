import { NextResponse } from "next/server"

import { buildMissionFromPrompt } from "@/lib/missions/runtime"
import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { upsertMission } from "@/lib/missions/store"
import { validateMissionGraphForVersioning } from "@/lib/missions/workflow/versioning"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { finalizeMissionBuildRequest, reserveMissionBuildRequest } from "@/lib/missions/build-idempotency"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import { syncMissionScheduleToGoogleCalendar } from "@/lib/calendar/google-schedule-mirror"
import { resolveTimezone } from "@/lib/shared/timezone"

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

  ensureNotificationSchedulerStarted()
  const startedAtMs = Date.now()

  let debugSelected = "server_llm=unknown model=unknown"
  let reservationKey = ""
  try {
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string
      deploy?: boolean
      timezone?: string
      enabled?: boolean
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Prompt is required." }, { status: 400 })
    }
    if (prompt.length > 5000) {
      return NextResponse.json({ ok: false, error: "Prompt exceeds 5000 characters." }, { status: 400 })
    }
    await emitMissionTelemetryEvent({
      eventType: "mission.build.started",
      status: "info",
      userContextId: userId,
      metadata: {
        deploy: body.deploy !== false,
      },
    }).catch(() => {})

    const deploy = body.deploy !== false
    const timezoneOverride = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null
    const reservation = await reserveMissionBuildRequest({
      userContextId: userId,
      clientKey: req.headers.get("x-idempotency-key"),
      prompt,
      deploy,
      timezone: timezoneOverride || "",
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    })
    reservationKey = String(reservation.key || "")
    if (reservation.status === "pending") {
      const retryAfterMs = Math.max(250, Number(reservation.retryAfterMs || 1000))
      const headers = new Headers()
      headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      return NextResponse.json(
        {
          ok: true,
          pending: true,
          code: "MISSION_BUILD_PENDING",
          message: "Mission build already in progress.",
          idempotencyKey: reservation.key,
          retryAfterMs,
        },
        { status: 202, headers },
      )
    }
    if (reservation.status === "completed") {
      return NextResponse.json({
        ...(reservation.result || {}),
        ok: true,
        pending: false,
        idempotencyKey: reservation.key,
      })
    }
    if (reservation.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          error: reservation.error || "Mission build previously failed.",
          idempotencyKey: reservation.key,
        },
        { status: 500 },
      )
    }
    const generated = await buildMissionFromPrompt(prompt, { userId, scope: verified })
    debugSelected = `server_llm=${generated.provider} model=${generated.model}`

    const mission = generated.mission
    const triggerNode = mission.nodes.find((n) => n.type === "schedule-trigger") as
      | { triggerTime?: string; triggerTimezone?: string } | undefined
    const scheduleTime = triggerNode?.triggerTime || "09:00"
    const scheduleTimezone = resolveTimezone(timezoneOverride, triggerNode?.triggerTimezone, mission.settings?.timezone)

    // Backward-compat wrapper so existing agent consumers (chat-special-handlers.js)
    // can still read workflow.label and workflow.summary.schedule.*
    const responseBase = {
      ok: true,
      provider: generated.provider,
      model: generated.model,
      debug: debugSelected,
      workflow: {
        label: mission.label,
        integration: mission.integration,
        summary: {
          description: mission.description,
          workflowSteps: mission.nodes,   // length-only usage
          schedule: { time: scheduleTime, timezone: scheduleTimezone },
        },
      },
    }

    if (!mission.label?.trim()) {
      return NextResponse.json({ ok: false, error: "Generated mission is missing a label." }, { status: 500 })
    }

    const graphIssues = validateMissionGraphForVersioning(mission)
    if (graphIssues.length > 0) {
      return NextResponse.json({ ok: false, error: "Generated mission graph failed validation.", validation: { blocked: true, issues: graphIssues } }, { status: 422 })
    }

    if (!deploy) {
      const payload = { ...responseBase, deployed: false, mission, idempotencyKey: reservation.key }
      await finalizeMissionBuildRequest({ key: reservation.key, userContextId: userId, ok: true, result: payload })
      await emitMissionTelemetryEvent({
        eventType: "mission.build.completed",
        status: "success",
        userContextId: userId,
        durationMs: Date.now() - startedAtMs,
        metadata: { deployed: false },
      }).catch(() => {})
      return NextResponse.json(payload)
    }

    await emitMissionTelemetryEvent({
      eventType: "mission.validation.completed",
      status: "success",
      userContextId: userId,
      metadata: { stage: "save", blocked: false, issueCount: 0 },
    }).catch(() => {})

    const deployedMission = { ...mission, status: "active" as const, settings: { ...mission.settings, timezone: scheduleTimezone } }
    await upsertMission(deployedMission, userId)
    await syncMissionScheduleToGoogleCalendar({ mission: deployedMission, scope: verified }).catch((error) => {
      console.warn("[missions.build][gcalendar_sync] schedule mirror failed:", error instanceof Error ? error.message : String(error))
    })

    const payload = { ...responseBase, deployed: true, mission: deployedMission, idempotencyKey: reservation.key }
    await finalizeMissionBuildRequest({ key: reservation.key, userContextId: userId, ok: true, result: payload })
    await emitMissionTelemetryEvent({
      eventType: "mission.build.completed",
      status: "success",
      userContextId: userId,
      missionId: mission.id,
      durationMs: Date.now() - startedAtMs,
      metadata: { deployed: true },
    }).catch(() => {})
    return NextResponse.json(payload, { status: 201 })
  } catch (error) {
    if (reservationKey) {
      await finalizeMissionBuildRequest({
        key: reservationKey,
        userContextId: userId,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to build workflow.",
      })
    }
    await emitMissionTelemetryEvent({
      eventType: "mission.build.failed",
      status: "error",
      userContextId: userId,
      durationMs: Date.now() - startedAtMs,
      metadata: {
        error: error instanceof Error ? error.message : "Failed to build workflow.",
      },
    }).catch(() => {})
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to build workflow.", debug: debugSelected },
      { status: 500 },
    )
  }
}
