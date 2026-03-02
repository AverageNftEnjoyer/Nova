import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMission } from "@/lib/missions/workflow/execute-mission"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"
import { loadMissions } from "@/lib/missions/store"
import { checkUserRateLimit, createRateLimitHeaders, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import type { Mission, NodeExecutionTrace, WorkflowStepTrace } from "@/lib/missions/types"
import type { NotificationSchedule } from "@/lib/notifications/store"
import { resolveTimezone } from "@/lib/shared/timezone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function streamPayload(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

function nodeTracesToStepTraces(traces: NodeExecutionTrace[]): WorkflowStepTrace[] {
  return traces.map((trace) => ({
    stepId: trace.nodeId,
    type: trace.nodeType,
    title: trace.label,
    status: trace.status,
    detail: trace.detail,
    errorCode: trace.errorCode,
    artifactRef: trace.artifactRef,
    retryCount: trace.retryCount,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
  }))
}

function buildScheduleFallbackFromMission(mission: Mission, userId: string): NotificationSchedule {
  const trigger = mission.nodes.find((node) => node.type === "schedule-trigger")
  const time = trigger?.type === "schedule-trigger" && typeof trigger.triggerTime === "string" && trigger.triggerTime.trim().length > 0
    ? trigger.triggerTime.trim()
    : "09:00"
  const timezone = trigger?.type === "schedule-trigger" && typeof trigger.triggerTimezone === "string" && trigger.triggerTimezone.trim().length > 0
    ? trigger.triggerTimezone.trim()
    : resolveTimezone(mission.settings?.timezone)
  const nowIso = new Date().toISOString()
  return {
    id: mission.id,
    userId,
    integration: String(mission.integration || "telegram").trim() || "telegram",
    label: String(mission.label || "Untitled mission").trim() || "Untitled mission",
    message: String(mission.description || mission.label || "Mission run"),
    time,
    timezone,
    enabled: mission.status !== "archived",
    chatIds: Array.isArray(mission.chatIds) ? mission.chatIds.map((id) => String(id).trim()).filter(Boolean) : [],
    createdAt: mission.createdAt || nowIso,
    updatedAt: mission.updatedAt || nowIso,
    runCount: Number.isFinite(mission.runCount) ? mission.runCount : 0,
    successCount: Number.isFinite(mission.successCount) ? mission.successCount : 0,
    failureCount: Number.isFinite(mission.failureCount) ? mission.failureCount : 0,
    lastRunAt: mission.lastRunAt,
    lastRunStatus: mission.lastRunStatus,
  }
}

export async function GET(req: Request) {
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) {
    const message = runtimeTokenDecision.code === "RUNTIME_TOKEN_REQUIRED"
      ? "Runtime shared token required."
      : "Runtime shared token is invalid."
    return new Response(message, { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }

  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? new Response("Unauthorized", { status: 401 })
  }
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.missionTriggerStream)
  if (!limit.allowed) {
    return new Response("Too many requests.", {
      status: 429,
      headers: createRateLimitHeaders(limit, {
        "Content-Type": "text/plain; charset=utf-8",
      }),
    })
  }
  const userId = verified.user.id
  const url = new URL(req.url)
  const scheduleId = String(url.searchParams.get("scheduleId") || "").trim()
  if (!scheduleId) {
    return new Response("Missing scheduleId", { status: 400 })
  }

  ensureNotificationSchedulerStarted()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let streamClosed = false
      const safeStreamPayload = (payload: unknown) => {
        if (streamClosed) return
        try {
          streamPayload(controller, payload)
        } catch (error) {
          if (!(error instanceof TypeError) || !/controller is already closed/i.test(String(error.message || ""))) {
            throw error
          }
        }
      }
      const safeClose = () => {
        if (streamClosed) return
        streamClosed = true
        try {
          controller.close()
        } catch {
          // Stream may already be closed; ignore.
        }
      }
      void (async () => {
        try {
          const missions = await loadMissions({ userId })
          const mission = missions.find((row) => row.id === scheduleId) || null
          if (!mission) {
            safeStreamPayload({ type: "error", error: "schedule not found" })
            return
          }
          const target = buildScheduleFallbackFromMission(mission, userId)

          safeStreamPayload({
            type: "started",
            missionId: scheduleId,
            missionLabel: target.label || "Untitled mission",
            startedAt: new Date().toISOString(),
          })

          const runKey = `manual-trigger-stream:${mission.id}:${Date.now()}`
          const missionRunId = crypto.randomUUID()
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
            onNodeTrace: async (trace) => {
              const stepTrace = nodeTracesToStepTraces([trace])[0]
              safeStreamPayload({ type: "step", trace: stepTrace })
            },
          })
          const durationMs = Date.now() - startedAtMs
          const stepTraces = nodeTracesToStepTraces(dagResult.nodeTraces)
          const execution = {
            ok: dagResult.ok,
            skipped: dagResult.skipped,
            reason: dagResult.reason,
            outputs: dagResult.outputs,
            stepTraces,
          }

          const telegramQueued = stepTraces.some((trace) =>
            String(trace.type || "").toLowerCase() === "output" &&
            String(trace.status || "").toLowerCase() === "completed" &&
            /\bvia\s+telegram\b/i.test(String(trace.detail || "")),
          )
          let logStatus: "success" | "error" | "skipped" = execution.ok ? "success" : execution.skipped ? "skipped" : "error"
          let deadLetterId = ""
          try {
            const logResult = await appendRunLogForExecution({
              schedule: target,
              source: "trigger",
              execution,
              durationMs,
              mode: "manual-trigger-stream",
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
                reason: logResult.errorMessage || execution.reason || "Manual trigger stream execution failed.",
                outputOkCount: execution.outputs.filter((item) => item.ok).length,
                outputFailCount: execution.outputs.filter((item) => !item.ok).length,
                metadata: { mode: "manual-trigger-stream" },
              })
            }
          } catch {
            // Logging failures should not block stream responses.
          }
          const updatedSchedule = applyScheduleRunOutcome(target, {
            status: logStatus,
            now: new Date(),
            mode: "manual-trigger-stream",
          })

          safeStreamPayload({
            type: "done",
            data: {
              ok: execution.ok,
              skipped: execution.skipped,
              reason: execution.reason,
              results: execution.outputs,
              stepTraces,
              telegramQueued,
              deadLetterId: deadLetterId || undefined,
              schedule: updatedSchedule,
            },
          })
        } catch (error) {
          safeStreamPayload({
            type: "error",
            error: error instanceof Error ? error.message : "Failed to run mission stream.",
          })
        } finally {
          safeClose()
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
