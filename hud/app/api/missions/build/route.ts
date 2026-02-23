import { NextResponse } from "next/server"

import { buildWorkflowFromPrompt, WORKFLOW_MARKER } from "@/lib/missions/runtime"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { SAVE_WORKFLOW_VALIDATION_POLICY, validateMissionWorkflowMessage } from "@/lib/missions/workflow/validation"
import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { buildSchedule } from "@/lib/notifications/store"
import { migrateLegacyScheduleToMission, upsertMission } from "@/lib/missions/store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { finalizeMissionBuildRequest, reserveMissionBuildRequest } from "@/lib/missions/build-idempotency"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"

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
    const selected = resolveConfiguredLlmProvider(await loadIntegrationsConfig(verified))
    debugSelected = `server_llm=${selected.provider} model=${selected.model}`

    const generated = await buildWorkflowFromPrompt(prompt, verified)
    const workflow = generated.workflow
    const summary = workflow.summary

    const scheduleTime = String(summary.schedule?.time || "09:00").trim() || "09:00"
    const scheduleTimezone = timezoneOverride || String(summary.schedule?.timezone || "America/New_York").trim() || "America/New_York"
    const messageDescription = String(summary.description || "").trim() || prompt

    const payloadMessage = `${messageDescription}\n\n${WORKFLOW_MARKER}\n${JSON.stringify(summary)}`

    const responseBase = {
      ok: true,
      provider: generated.provider,
      model: generated.model,
      debug: debugSelected,
      workflow: {
        ...workflow,
        summary: {
          ...summary,
          schedule: {
            ...(summary.schedule || {}),
            time: scheduleTime,
            timezone: scheduleTimezone,
          },
        },
      },
    }

    if (!deploy) {
      const payload = { ...responseBase, deployed: false, idempotencyKey: reservation.key }
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

    if (!workflow.label?.trim()) {
      return NextResponse.json({ ok: false, error: "Generated workflow is missing a label." }, { status: 500 })
    }
    const workflowValidation = validateMissionWorkflowMessage({
      message: payloadMessage,
      stage: "save",
      mode: SAVE_WORKFLOW_VALIDATION_POLICY.mode,
      profile: SAVE_WORKFLOW_VALIDATION_POLICY.profile,
      userContextId: userId,
    })
    if (workflowValidation.blocked) {
      await emitMissionTelemetryEvent({
        eventType: "mission.validation.completed",
        status: "error",
        userContextId: userId,
        metadata: {
          stage: "save",
          blocked: true,
          errorCount: workflowValidation.issueCount.error,
          warningCount: workflowValidation.issueCount.warning,
        },
      }).catch(() => {})
      return NextResponse.json(
        {
          ok: false,
          error: "Workflow validation failed.",
          validation: workflowValidation,
        },
        { status: 400 },
      )
    }
    await emitMissionTelemetryEvent({
      eventType: "mission.validation.completed",
      status: "success",
      userContextId: userId,
      metadata: {
        stage: "save",
        blocked: false,
        errorCount: workflowValidation.issueCount.error,
        warningCount: workflowValidation.issueCount.warning,
      },
    }).catch(() => {})
    const syntheticSchedule = buildSchedule({
      userId,
      integration: workflow.integration || "telegram",
      label: workflow.label,
      message: payloadMessage,
      time: scheduleTime,
      timezone: scheduleTimezone,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      chatIds: [],
    })
    const mission = migrateLegacyScheduleToMission(syntheticSchedule)
    await upsertMission(mission, userId)

    const payload = { ...responseBase, deployed: true, mission, idempotencyKey: reservation.key }
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
