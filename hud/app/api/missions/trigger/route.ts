import { NextResponse } from "next/server"

import { ensureMissionSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMission } from "@/lib/missions/workflow/execute-mission"
import { enqueueMissionRunForQueue, isMissionQueueModeEnabled } from "@/lib/missions/workflow/queue-mode"
import { loadMissions, upsertMission } from "@/lib/missions/store"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, type MissionRunRecord } from "@/lib/notifications/run-metrics"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"
import { dispatchOutput, type MissionOutputDispatchTarget } from "@/lib/missions/output/dispatch"
import { isValidDiscordWebhookUrl, redactWebhookTarget } from "@/lib/notifications/discord"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import type { NodeExecutionTrace, WorkflowStepTrace } from "@/lib/missions/types"
import { resolveTimezone } from "@/lib/shared/timezone"

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

function buildRunRecordFromMission(mission: {
  id: string
  label?: string
  createdAt?: string
  updatedAt?: string
  runCount?: number
  successCount?: number
  failureCount?: number
  lastRunAt?: string
  lastRunStatus?: "success" | "error" | "skipped"
  lastSentLocalDate?: string
}, userId: string): MissionRunRecord {
  return {
    id: mission.id,
    userId,
    label: String(mission.label || "Untitled mission").trim() || "Untitled mission",
    updatedAt: mission.updatedAt || mission.createdAt || new Date().toISOString(),
    runCount: Number.isFinite(Number(mission.runCount)) ? Number(mission.runCount) : 0,
    successCount: Number.isFinite(Number(mission.successCount)) ? Number(mission.successCount) : 0,
    failureCount: Number.isFinite(Number(mission.failureCount)) ? Number(mission.failureCount) : 0,
    lastRunAt: mission.lastRunAt,
    lastRunStatus: mission.lastRunStatus,
    lastSentLocalDate: mission.lastSentLocalDate,
  }
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

  ensureMissionSchedulerStarted()

  try {
    const body = await req.json()
    const missionId = typeof body?.missionId === "string" ? body.missionId.trim() : ""
    const text = typeof body?.message === "string" ? body.message.trim() : ""
    const integration = typeof body?.integration === "string" ? body.integration.trim().toLowerCase() : ""
    const timezone = resolveTimezone(typeof body?.timezone === "string" ? body.timezone : undefined)
    const chatIds = normalizeRecipients(body?.chatIds)

    // ── Run a saved mission by ID via the DAG engine ───────────────────────────
    if (missionId) {
      const allMissions = await loadMissions({ userId })
      const mission = allMissions.find((m) => m.id === missionId)
      if (!mission) {
        return NextResponse.json({ error: "Mission not found." }, { status: 404 })
      }
      const target = buildRunRecordFromMission(mission, userId)

      const missionRunId = crypto.randomUUID()
      const runKey = `manual-trigger:${mission.id}:${Date.now()}`
      if (isMissionQueueModeEnabled()) {
        const enqueueResult = await enqueueMissionRunForQueue({
          mission,
          userId,
          missionRunId,
          runKey,
          requestIdempotencyKey: req.headers.get("x-idempotency-key") || undefined,
        })
        if (!enqueueResult.ok) {
          return NextResponse.json({ ok: false, error: enqueueResult.error }, { status: 502 })
        }
        return NextResponse.json(
          {
            ok: true,
            queued: true,
            missionRunId,
            reason: "Mission queued for worker execution.",
            results: [],
            stepTraces: [],
            telegramQueued: false,
          },
          { status: 202 },
        )
      }
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

    const adHocId = crypto.randomUUID()
    const adHocLabel = String(typeof body?.label === "string" ? body.label : "Manual trigger").trim() || "Manual trigger"
    const adHocSchedule: MissionRunRecord = {
      id: adHocId,
      userId,
      label: adHocLabel,
      updatedAt: new Date().toISOString(),
      runCount: 0,
      successCount: 0,
      failureCount: 0,
    }
    const adHocTarget: MissionOutputDispatchTarget = {
      missionId: adHocId,
      missionLabel: adHocSchedule.label,
      userContextId: userId,
      timezone,
    }

    const startedAt = new Date().toISOString()
    const results = await dispatchOutput(integration, text, chatIds, adHocTarget, verified)
    const endedAt = new Date().toISOString()
    const ok = results.some((r) => r.ok)

    const stepTraces: WorkflowStepTrace[] = [
      {
        stepId: adHocId,
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
