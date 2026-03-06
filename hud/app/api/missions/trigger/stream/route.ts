import { ensureMissionSchedulerStarted as ensureHudMissionSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMission } from "@/lib/missions/workflow/execute-mission"
import { enqueueMissionRunForQueue, isMissionQueueModeEnabled } from "@/lib/missions/workflow/queue-mode"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, type MissionRunRecord } from "@/lib/notifications/run-metrics"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"
import { loadMissions } from "../../../../../../src/runtime/modules/services/missions/persistence/index.js"
import { checkUserRateLimit, createRateLimitHeaders, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import type { Mission, NodeExecutionTrace, WorkflowStepTrace } from "@/lib/missions/types"
import { ensureMissionSchedulerStarted } from "../../../../../../src/runtime/modules/services/missions/scheduler/index.js"

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

function buildRunRecordFromMission(mission: Mission, userId: string): MissionRunRecord {
  return {
    id: mission.id,
    userId,
    label: String(mission.label || "Untitled mission").trim() || "Untitled mission",
    updatedAt: mission.updatedAt || mission.createdAt || new Date().toISOString(),
    lastSentLocalDate: mission.lastSentLocalDate,
    runCount: Number.isFinite(Number(mission.runCount)) ? Number(mission.runCount) : 0,
    successCount: Number.isFinite(Number(mission.successCount)) ? Number(mission.successCount) : 0,
    failureCount: Number.isFinite(Number(mission.failureCount)) ? Number(mission.failureCount) : 0,
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
  const missionId = String(url.searchParams.get("missionId") || "").trim()
  if (!missionId) {
    return new Response("Missing missionId", { status: 400 })
  }

  ensureMissionSchedulerStarted({ startScheduler: ensureHudMissionSchedulerStarted })

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
          const missions = (await loadMissions({ userId })) as Mission[]
          const mission = missions.find((row) => row.id === missionId) || null
          if (!mission) {
            safeStreamPayload({ type: "error", error: "mission not found" })
            return
          }
          const target = buildRunRecordFromMission(mission, userId)

          safeStreamPayload({
            type: "started",
            missionId,
            missionLabel: target.label || "Untitled mission",
            startedAt: new Date().toISOString(),
          })

          const runKey = `manual-trigger-stream:${mission.id}:${Date.now()}`
          const missionRunId = crypto.randomUUID()
          const conversationId = `mission-trigger-stream:${mission.id}`
          const sessionKey = `agent:nova:hud:user:${userId}:dm:${conversationId}`
          if (isMissionQueueModeEnabled()) {
            const enqueueResult = await enqueueMissionRunForQueue({
              mission,
              userId,
              missionRunId,
              runKey,
              requestIdempotencyKey: req.headers.get("x-idempotency-key") || undefined,
            })
            if (!enqueueResult.ok) {
              safeStreamPayload({
                type: "error",
                error: enqueueResult.error,
              })
              return
            }
            safeStreamPayload({
              type: "done",
              data: {
                ok: true,
                queued: true,
                missionRunId,
                reason: "Mission queued for worker execution.",
                results: [],
                stepTraces: [],
                telegramQueued: false,
              },
            })
            return
          }
          const skillSnapshot = await loadMissionSkillSnapshot({ userId })
          const startedAtMs = Date.now()
          const dagResult = await executeMission({
            mission,
            source: "trigger",
            missionRunId,
            runKey,
            userContextId: userId,
            conversationId,
            sessionKey,
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
