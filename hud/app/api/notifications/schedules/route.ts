import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { buildSchedule, loadSchedules, parseDailyTime, saveSchedules } from "@/lib/notifications/store"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseIntegration(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!value) return null
  if (!/^[a-z0-9_-]+$/.test(value)) return null
  return value
}

export async function GET(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()
  const schedules = await loadSchedules()
  return NextResponse.json({ schedules })
}

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    const time = typeof body?.time === "string" ? body.time.trim() : ""
    const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "America/New_York"

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    if (!parseDailyTime(time)) {
      return NextResponse.json({ error: "time must be HH:mm (24h format)" }, { status: 400 })
    }

    const integration = parseIntegration(body?.integration)
    if (!integration) {
      return NextResponse.json({ error: "integration is required" }, { status: 400 })
    }

    const schedule = buildSchedule({
      integration,
      label: typeof body?.label === "string" ? body.label : undefined,
      message,
      time,
      timezone,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : true,
      chatIds: Array.isArray(body?.chatIds) ? body.chatIds.map((v: unknown) => String(v)) : [],
    })

    const schedules = await loadSchedules()
    schedules.push(schedule)
    await saveSchedules(schedules)

    return NextResponse.json({ schedule }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create schedule",
      },
      { status: 500 },
    )
  }
}

export async function PATCH(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const id = typeof body?.id === "string" ? body.id.trim() : ""
    if (!id) {
      return NextResponse.json({ error: "schedule id is required" }, { status: 400 })
    }

    const schedules = await loadSchedules()
    const targetIndex = schedules.findIndex((s) => s.id === id)

    if (targetIndex < 0) {
      return NextResponse.json({ error: "schedule not found" }, { status: 404 })
    }

    const current = schedules[targetIndex]

    if (typeof body?.time === "string" && !parseDailyTime(body.time.trim())) {
      return NextResponse.json({ error: "time must be HH:mm (24h format)" }, { status: 400 })
    }

    const parsedIntegration = typeof body?.integration === "undefined" ? current.integration : parseIntegration(body?.integration)
    if (parsedIntegration === null) {
      return NextResponse.json({ error: "integration is invalid" }, { status: 400 })
    }

    const updated = {
      ...current,
      integration: parsedIntegration,
      label: typeof body?.label === "string" ? body.label.trim() || current.label : current.label,
      message: typeof body?.message === "string" ? body.message.trim() || current.message : current.message,
      time: typeof body?.time === "string" ? body.time.trim() : current.time,
      timezone: typeof body?.timezone === "string" ? body.timezone.trim() || current.timezone : current.timezone,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : current.enabled,
      chatIds: Array.isArray(body?.chatIds) ? body.chatIds.map((v: unknown) => String(v).trim()).filter(Boolean) : current.chatIds,
      updatedAt: new Date().toISOString(),
      lastSentLocalDate: typeof body?.resetLastSent === "boolean" && body.resetLastSent ? undefined : current.lastSentLocalDate,
    }

    schedules[targetIndex] = updated
    await saveSchedules(schedules)

    return NextResponse.json({ schedule: updated })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update schedule",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()

  try {
    const url = new URL(req.url)
    const id = (url.searchParams.get("id") || "").trim()

    if (!id) {
      return NextResponse.json({ error: "schedule id is required via query param: ?id=..." }, { status: 400 })
    }

    const schedules = await loadSchedules()
    const next = schedules.filter((s) => s.id !== id)

    if (next.length === schedules.length) {
      return NextResponse.json({ error: "schedule not found" }, { status: 404 })
    }

    await saveSchedules(next)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete schedule",
      },
      { status: 500 },
    )
  }
}
