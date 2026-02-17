import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { buildSchedule, loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
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
      const execution = await executeMissionWorkflow({
        schedule: target,
        source: "trigger",
        enforceOutputTime: false,
        scope: verified,
      })
      const novachatQueued = execution.stepTraces.some((trace) =>
        String(trace.type || "").toLowerCase() === "output" &&
        String(trace.status || "").toLowerCase() === "completed" &&
        /\bvia\s+novachat\b/i.test(String(trace.detail || "")),
      )
      const nowIso = new Date().toISOString()
      const updatedSchedule = {
        ...target,
        runCount: (Number.isFinite(target.runCount) ? target.runCount : 0) + 1,
        successCount: (Number.isFinite(target.successCount) ? target.successCount : 0) + (execution.ok ? 1 : 0),
        failureCount: (Number.isFinite(target.failureCount) ? target.failureCount : 0) + (execution.ok ? 0 : 1),
        lastRunAt: nowIso,
        updatedAt: nowIso,
      }
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
        { status: execution.ok ? 200 : 502 },
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
    const execution = await executeMissionWorkflow({
      schedule: tempSchedule,
      source: "trigger",
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

