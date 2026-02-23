import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"
import { buildSchedule, loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { isValidDiscordWebhookUrl, redactWebhookTarget } from "@/lib/notifications/discord"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
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
    const chatIds = normalizeRecipients(body?.chatIds)

    if (scheduleId) {
      const schedules = await loadSchedules({ userId })
      const targetIndex = schedules.findIndex((item) => item.id === scheduleId)
      const target = targetIndex >= 0 ? schedules[targetIndex] : undefined
      if (!target) {
        return NextResponse.json({ error: "schedule not found" }, { status: 404 })
      }
      const runKey = `manual-trigger:${target.id}:${Date.now()}`
      const missionRunId = crypto.randomUUID()
      const skillSnapshot = await loadMissionSkillSnapshot({ userId })
      const startedAtMs = Date.now()
      const execution = await executeMissionWorkflow({
        schedule: target,
        source: "trigger",
        missionRunId,
        runKey,
        attempt: 1,
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
      let deadLetterId = ""
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
        if (logStatus === "error") {
          deadLetterId = await appendNotificationDeadLetter({
            scheduleId: target.id,
            userId: target.userId,
            label: target.label,
            source: "trigger",
            runKey,
            attempt: 1,
            reason: logResult.errorMessage || execution.reason || "Manual trigger execution failed.",
            outputOkCount: execution.outputs.filter((item) => item.ok).length,
            outputFailCount: execution.outputs.filter((item) => !item.ok).length,
            metadata: { mode: "manual-trigger" },
          })
        }
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
          deadLetterId: deadLetterId || undefined,
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
    if (integration === "discord") {
      const validation = validateDiscordTargets(chatIds)
      if (!validation.ok) return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const tempSchedule = buildSchedule({
      userId,
      integration,
      label: typeof body?.label === "string" ? body.label : "Manual trigger",
      message: text,
      time,
      timezone,
      enabled: true,
      chatIds,
    })
    const skillSnapshot = await loadMissionSkillSnapshot({ userId })
    const missionRunId = crypto.randomUUID()
    const execution = await executeMissionWorkflow({
      schedule: tempSchedule,
      source: "trigger",
      missionRunId,
      runKey: `manual-trigger:${tempSchedule.id}:${Date.now()}`,
      attempt: 1,
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
