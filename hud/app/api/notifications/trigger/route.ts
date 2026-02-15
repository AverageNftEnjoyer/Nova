import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { buildSchedule, loadSchedules } from "@/lib/notifications/store"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const scheduleId = typeof body?.scheduleId === "string" ? body.scheduleId.trim() : ""
    const text = typeof body?.message === "string" ? body.message.trim() : ""
    const integration = typeof body?.integration === "string" ? body.integration.trim().toLowerCase() : ""
    const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "America/New_York"
    const time = typeof body?.time === "string" ? body.time.trim() : "09:00"

    if (scheduleId) {
      const schedules = await loadSchedules()
      const target = schedules.find((item) => item.id === scheduleId)
      if (!target) {
        return NextResponse.json({ error: "schedule not found" }, { status: 404 })
      }
      const execution = await executeMissionWorkflow({
        schedule: target,
        source: "trigger",
        enforceOutputTime: false,
      })
      return NextResponse.json(
        {
          ok: execution.ok,
          skipped: execution.skipped,
          reason: execution.reason,
          results: execution.outputs,
          stepTraces: execution.stepTraces,
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
    })

    return NextResponse.json(
      {
        ok: execution.ok,
        skipped: execution.skipped,
        reason: execution.reason,
        results: execution.outputs,
        stepTraces: execution.stepTraces,
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
