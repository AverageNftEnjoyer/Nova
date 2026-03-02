import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { SAVE_WORKFLOW_VALIDATION_POLICY, validateMissionWorkflowMessage } from "@/lib/missions/workflow/validation"
import { buildSchedule, loadSchedules, parseDailyTime, saveSchedules } from "@/lib/notifications/store"
import type { NotificationSchedule } from "@/lib/notifications/store"
import { isValidDiscordWebhookUrl, redactWebhookTarget } from "@/lib/notifications/discord"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { emitMissionTelemetryEvent } from "@/lib/missions/telemetry"
import type { IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { removeMissionScheduleFromGoogleCalendar, syncMissionScheduleToGoogleCalendar } from "@/lib/calendar/google-schedule-mirror"
import { deleteMissionForNotificationSchedule, syncMissionFromNotificationSchedule } from "@/lib/notifications/mission-sync"
import { resolveTimezone } from "@/lib/shared/timezone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_INTEGRATIONS = new Set(["telegram", "discord", "email", "webhook"])
const DISCORD_MAX_TARGETS = Math.max(
  1,
  Math.min(200, Number.parseInt(process.env.NOVA_DISCORD_MAX_TARGETS || "50", 10) || 50),
)
function normalizeRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.map((value) => String(value || "").trim()).filter(Boolean)))
}

function validateDiscordTargets(targets: string[]): { ok: true } | { ok: false; message: string } {
  if (targets.length === 0) return { ok: true }
  if (targets.length > DISCORD_MAX_TARGETS) {
    return { ok: false, message: `Discord target count exceeds cap (${DISCORD_MAX_TARGETS}).` }
  }
  const invalid = targets.find((target) => !isValidDiscordWebhookUrl(target))
  if (invalid) {
    return { ok: false, message: `Invalid Discord webhook URL: ${redactWebhookTarget(invalid)}` }
  }
  return { ok: true }
}

function parseIntegration(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!value) return null
  if (!/^[a-z0-9_-]+$/.test(value)) return null
  if (!ALLOWED_INTEGRATIONS.has(value)) return null
  return value
}

async function runScheduleReadBackfill(
  schedules: NotificationSchedule[],
  scope: NonNullable<IntegrationsStoreScope>,
): Promise<void> {
  await Promise.allSettled(
    schedules.map((schedule) =>
      syncMissionFromNotificationSchedule(schedule)
        .then((mission) => syncMissionScheduleToGoogleCalendar({ mission, scope }))
        .catch((error) => {
        console.warn(
          "[notifications.schedules][mission_sync] reconcile failed:",
          error instanceof Error ? error.message : String(error),
        )
      })),
  )
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  const userId = verified.user.id

  ensureNotificationSchedulerStarted()
  const schedules = await loadSchedules({ userId })
  // Keep read latency low: reconcile/mirror backfill continues in the background.
  void runScheduleReadBackfill(schedules, verified).catch((error) => {
    console.warn(
      "[notifications.schedules][read_backfill] failed:",
      error instanceof Error ? error.message : String(error),
    )
  })
  return NextResponse.json({ schedules })
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  const userId = verified.user.id

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const explicitId = typeof body?.id === "string" ? body.id.trim() : ""
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    const time = typeof body?.time === "string" ? body.time.trim() : ""
    const timezone = resolveTimezone(typeof body?.timezone === "string" ? body.timezone : undefined)

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const workflowValidation = validateMissionWorkflowMessage({
      message,
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

    if (!parseDailyTime(time)) {
      return NextResponse.json({ error: "time must be HH:mm (24h format)" }, { status: 400 })
    }

    const integration = parseIntegration(body?.integration)
    if (!integration) {
      return NextResponse.json({ error: "integration is required and must be one of: telegram, discord, email, webhook" }, { status: 400 })
    }
    const normalizedTargets = normalizeRecipients(body?.chatIds)
    if (integration === "discord") {
      const validation = validateDiscordTargets(normalizedTargets)
      if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const schedule = buildSchedule({
      id: explicitId || undefined,
      userId,
      integration,
      label: typeof body?.label === "string" ? body.label : undefined,
      message,
      time,
      timezone,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : true,
      chatIds: normalizedTargets,
    })

    const schedules = await loadSchedules({ userId })
    if (explicitId) {
      const existingIndex = schedules.findIndex((item) => item.id === explicitId)
      if (existingIndex >= 0) {
        const current = schedules[existingIndex]
        schedules[existingIndex] = {
          ...current,
          integration: schedule.integration,
          label: schedule.label,
          message: schedule.message,
          time: schedule.time,
          timezone: schedule.timezone,
          enabled: schedule.enabled,
          chatIds: schedule.chatIds,
          updatedAt: new Date().toISOString(),
        }
      } else {
        schedules.push(schedule)
      }
    } else {
      schedules.push(schedule)
    }
    const saved = explicitId
      ? schedules.find((item) => item.id === explicitId) || schedule
      : schedule
    const mission = await syncMissionFromNotificationSchedule(saved)
    await saveSchedules(schedules, { userId })
    await syncMissionScheduleToGoogleCalendar({ mission, scope: verified }).catch((error) => {
      console.warn("[notifications.schedules][gcalendar_sync] schedule mirror failed:", error instanceof Error ? error.message : String(error))
    })
    return NextResponse.json({ schedule: saved }, { status: 201 })
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
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  const userId = verified.user.id

  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const id = typeof body?.id === "string" ? body.id.trim() : ""
    if (!id) {
      return NextResponse.json({ error: "schedule id is required" }, { status: 400 })
    }

    const schedules = await loadSchedules({ userId })
    const targetIndex = schedules.findIndex((s) => s.id === id)

    if (targetIndex < 0) {
      return NextResponse.json({ error: "schedule not found" }, { status: 404 })
    }

    const current = schedules[targetIndex]
    const nextMessage = typeof body?.message === "string" ? body.message.trim() || current.message : current.message
    const workflowValidation = validateMissionWorkflowMessage({
      message: nextMessage,
      stage: "save",
      mode: SAVE_WORKFLOW_VALIDATION_POLICY.mode,
      profile: SAVE_WORKFLOW_VALIDATION_POLICY.profile,
      userContextId: userId,
      scheduleId: id,
    })
    if (workflowValidation.blocked) {
      await emitMissionTelemetryEvent({
        eventType: "mission.validation.completed",
        status: "error",
        userContextId: userId,
        scheduleId: id,
        metadata: {
          stage: "save",
          blocked: true,
          errorCount: workflowValidation.issueCount.error,
          warningCount: workflowValidation.issueCount.warning,
        },
      }).catch(() => {})
      return NextResponse.json(
        {
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
      scheduleId: id,
      metadata: {
        stage: "save",
        blocked: false,
        errorCount: workflowValidation.issueCount.error,
        warningCount: workflowValidation.issueCount.warning,
      },
    }).catch(() => {})

    if (typeof body?.time === "string" && !parseDailyTime(body.time.trim())) {
      return NextResponse.json({ error: "time must be HH:mm (24h format)" }, { status: 400 })
    }

    const parsedIntegration = typeof body?.integration === "undefined" ? current.integration : parseIntegration(body?.integration)
    if (parsedIntegration === null) {
      return NextResponse.json({ error: "integration is invalid. Allowed: telegram, discord, email, webhook" }, { status: 400 })
    }
    const normalizedTargets = Array.isArray(body?.chatIds) ? normalizeRecipients(body.chatIds) : current.chatIds
    if (parsedIntegration === "discord") {
      const validation = validateDiscordTargets(normalizedTargets)
      if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const updated = {
      ...current,
      integration: parsedIntegration,
      label: typeof body?.label === "string" ? body.label.trim() || current.label : current.label,
      message: nextMessage,
      time: typeof body?.time === "string" ? body.time.trim() : current.time,
      timezone: typeof body?.timezone === "string" ? body.timezone.trim() || current.timezone : current.timezone,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : current.enabled,
      chatIds: normalizedTargets,
      updatedAt: new Date().toISOString(),
      lastSentLocalDate: typeof body?.resetLastSent === "boolean" && body.resetLastSent ? undefined : current.lastSentLocalDate,
    }

    schedules[targetIndex] = updated
    const mission = await syncMissionFromNotificationSchedule(updated)
    await saveSchedules(schedules, { userId })
    await syncMissionScheduleToGoogleCalendar({ mission, scope: verified }).catch((error) => {
      console.warn("[notifications.schedules][gcalendar_sync] schedule mirror failed:", error instanceof Error ? error.message : String(error))
    })

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
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  const userId = verified.user.id

  ensureNotificationSchedulerStarted()

  try {
    const url = new URL(req.url)
    const id = (url.searchParams.get("id") || "").trim()

    if (!id) {
      return NextResponse.json({ error: "schedule id is required via query param: ?id=..." }, { status: 400 })
    }

    const schedules = await loadSchedules({ userId })
    const next = schedules.filter((s) => s.id !== id)

    if (next.length === schedules.length) {
      return NextResponse.json({ error: "schedule not found" }, { status: 404 })
    }

    await saveSchedules(next, { userId })
    await deleteMissionForNotificationSchedule({ scheduleId: id, userId })
    await removeMissionScheduleFromGoogleCalendar({ missionId: id, userId, scope: verified }).catch((error) => {
      console.warn("[notifications.schedules][gcalendar_sync] schedule mirror delete failed:", error instanceof Error ? error.message : String(error))
    })
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

