import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMission } from "@/lib/missions/workflow/execute-mission"
import { loadMissions, upsertMission } from "@/lib/missions/store"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"
import { buildSchedule, loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { dispatchOutput } from "@/lib/missions/output/dispatch"
import { isValidDiscordWebhookUrl, redactWebhookTarget } from "@/lib/notifications/discord"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import type { NodeExecutionTrace, WorkflowStepTrace } from "@/lib/missions/types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeTracesToStepTraces(traces: NodeExecutionTrace[]): WorkflowStepTrace[] {
  return traces.map((t) => ({
    stepId: t.nodeId,
    type: t.nodeType,
    title: t.label,
    status: t.status,
    detail: t.detail,
    errorCode: t.errorCode,
    artifactRef: t.artifactRef,
    retryCount: t.retryCount,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
  }))
}

function detectTelegramDelivered(traces: NodeExecutionTrace[]): boolean {
  return traces.some((t) => t.nodeType === "telegram-output" && t.status === "completed")
}

function normalizeRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.map((value) => String(value || "").trim()).filter(Boolean)))
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DISCORD_MAX_TARGETS = Math.max(
  1,
  Math.min(200, Number.parseInt(process.env.NOVA_DISCORD_MAX_TARGETS || "50", 10) || 50),
)

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
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) return runtimeSharedTokenErrorResponse(runtimeTokenDecision)

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

    // ── Run a saved mission by ID via the DAG engine ───────────────────────────
    if (scheduleId) {
      const [allMissions, schedules] = await Promise.all([
        loadMissions({ userId }),
        loadSchedules({ userId }),
      ])
      const mission = allMissions.find((m) => m.id === scheduleId)
      if (!mission) {
        return NextResponse.json({ error: "Mission not found." }, { status: 404 })
      }
      const targetIndex = schedules.findIndex((row) => row.id === scheduleId)
      const target = targetIndex >= 0 ? schedules[targetIndex] : null

      const missionRunId = crypto.randomUUID()
      const runKey = `manual-trigger:${mission.id}:${Date.now()}`
      const skillSnapshot = await loadMissionSkillSnapshot({ userId })
      const startedAtMs = Date.now()

      const dagResult = await executeMission({
        mission,
        source: "trigger",
        missionRunId,
        runKey,
        attempt: 1,
        enforceOutputTime: false,
        skillSnapshot,
        scope: verified,
      })

      const durationMs = Date.now() - startedAtMs
      const stepTraces = nodeTracesToStepTraces(dagResult.nodeTraces)
      const telegramQueued = detectTelegramDelivered(dagResult.nodeTraces)
      const execution = {
        ok: dagResult.ok,
        skipped: dagResult.skipped,
        reason: dagResult.reason,
        outputs: dagResult.outputs,
        stepTraces,
      }

      // Persist updated run counters
      try {
        const now = new Date().toISOString()
        const runStatus = dagResult.ok ? "success" : dagResult.skipped ? "skipped" : "error"
        await upsertMission(
          {
            ...mission,
            runCount: (mission.runCount || 0) + 1,
            successCount: (mission.successCount || 0) + (runStatus === "success" ? 1 : 0),
            failureCount: (mission.failureCount || 0) + (runStatus === "error" ? 1 : 0),
            lastRunAt: now,
            lastRunStatus: dagResult.ok ? "success" : dagResult.skipped ? "skipped" : "error",
            updatedAt: now,
          },
          userId,
        )
      } catch {
        // Metrics update failure should not block the response.
      }

      let deadLetterId = ""
      if (target) {
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
        try {
          await saveSchedules(schedules, { userId })
        } catch {
          // Schedule persistence is best-effort for mission-first execution.
        }
      }

      return NextResponse.json(
        {
          ok: execution.ok,
          skipped: execution.skipped,
          reason: execution.reason,
          results: execution.outputs,
          stepTraces,
          telegramQueued,
          deadLetterId: deadLetterId || undefined,
          durationMs,
        },
        { status: execution.ok || execution.skipped ? 200 : 502 },
      )
    }

    // ── Ad-hoc text send (no persisted mission) ────────────────────────────────
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

    const adHocSchedule = buildSchedule({
      userId,
      integration,
      label: typeof body?.label === "string" ? body.label : "Manual trigger",
      message: text,
      time,
      timezone,
      enabled: true,
      chatIds,
    })

    const startedAt = new Date().toISOString()
    const results = await dispatchOutput(integration, text, chatIds, adHocSchedule, verified)
    const endedAt = new Date().toISOString()
    const ok = results.some((r) => r.ok)

    const stepTraces: WorkflowStepTrace[] = [
      {
        stepId: adHocSchedule.id,
        type: `${integration}-output`,
        title: `Send via ${integration}`,
        status: ok ? "completed" : "failed",
        detail: ok ? `Dispatched to ${chatIds.length} target(s)` : (results[0]?.error ?? "Dispatch failed"),
        startedAt,
        endedAt,
      },
    ]

    return NextResponse.json(
      {
        ok,
        skipped: false,
        results,
        stepTraces,
        telegramQueued: false,
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send notification" },
      { status: 500 },
    )
  }
}
