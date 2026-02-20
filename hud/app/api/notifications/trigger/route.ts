import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { buildSchedule, loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.missionTrigger)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  const userId = verified.user.id

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const scheduleId = typeof body?.scheduleId === "string" ? body.scheduleId.trim() : ""
    const text = typeof body?.message === "string" ? body.message.trim() : ""
    const integration = typeof body?.integration === "string" ? body.integration.trim().toLowerCase() : ""
    const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "America/New_York"
    const time = typeof body?.time === "string" ? body.time.trim() : "09:00"

    if (scheduleId) {
      const schedules = await loadSchedules({ userId })
      const targetIndex = schedules.findIndex((item) => item.id === scheduleId)
      const target = targetIndex >= 0 ? schedules[targetIndex] : undefined
      if (!target) {
        return NextResponse.json({ error: "schedule not found" }, { status: 404 })
      }
      const runKey = `manual-trigger:${target.id}:${Date.now()}`
      const skillSnapshot = await loadMissionSkillSnapshot({ userId })
      const startedAtMs = Date.now()
      const execution = await executeMissionWorkflow({
        schedule: target,
        source: "trigger",
        enforceOutputTime: false,
        skillSnapshot,
        scope: verified,
      })
      const durationMs = Date.now() - startedAtMs
      const novachatQueued = execution.stepTraces.some((trace) =>
        String(trace.type || "").toLowerCase() === "output" &&
        String(trace.status || "").toLowerCase() === "completed" &&
        /\bvia\s+novachat\b/i.test(String(trace.detail || "")),
      )
      let logStatus: "success" | "error" | "skipped" = execution.ok ? "success" : execution.skipped ? "skipped" : "error"
      try {
        const logResult = await appendRunLogForExecution({
          schedule: target,
          source: "trigger",
          execution,
          durationMs,
          mode: "manual-trigger",
          runKey,
          attempt: 1,
        })
        logStatus = logResult.status
      } catch {
        // Logging failures should not block trigger response.
      }
      const updatedSchedule = applyScheduleRunOutcome(target, {
        status: logStatus,
        now: new Date(),
        mode: "manual-trigger",
      })
      schedules[targetIndex] = updatedSchedule
      await saveSchedules(schedules, { userId })
      return NextResponse.json(
        {
          ok: execution.ok,
          skipped: execution.skipped,
          reason: execution.reason,
          results: execution.outputs,
          stepTraces: execution.stepTraces,
          novachatQueued,
          schedule: updatedSchedule,
        },
        { status: execution.ok || execution.skipped ? 200 : 502 },
      )
    }

    if (!text) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    if (integration !== "telegram" && integration !== "discord") {
      return NextResponse.json({ error: "integration must be either 'telegram' or 'discord'" }, { status: 400 })
    }

    const tempSchedule = buildSchedule({
      userId,
      integration,
      label: typeof body?.label === "string" ? body.label : "Manual trigger",
      message: text,
      time,
      timezone,
      enabled: true,
      chatIds: Array.isArray(body?.chatIds) ? body.chatIds.map((v: unknown) => String(v)) : [],
    })
    const skillSnapshot = await loadMissionSkillSnapshot({ userId })
    const execution = await executeMissionWorkflow({
      schedule: tempSchedule,
      source: "trigger",
      skillSnapshot,
      scope: verified,
    })
    const novachatQueued = execution.stepTraces.some((trace) =>
      String(trace.type || "").toLowerCase() === "output" &&
      String(trace.status || "").toLowerCase() === "completed" &&
      /\bvia\s+novachat\b/i.test(String(trace.detail || "")),
    )

    return NextResponse.json(
      {
        ok: execution.ok,
        skipped: execution.skipped,
        reason: execution.reason,
        results: execution.outputs,
        stepTraces: execution.stepTraces,
        novachatQueued,
      },
      { status: execution.ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send notification",
      },
      { status: 500 },
    )
  }
}

