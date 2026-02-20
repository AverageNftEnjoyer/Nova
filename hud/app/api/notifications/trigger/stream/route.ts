import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { loadSchedules, saveSchedules } from "@/lib/notifications/store"
import { checkUserRateLimit, createRateLimitHeaders, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function streamPayload(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

export async function GET(req: Request) {
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
      void (async () => {
        try {
          const schedules = await loadSchedules({ userId })
          const targetIndex = schedules.findIndex((item) => item.id === scheduleId)
          const target = targetIndex >= 0 ? schedules[targetIndex] : undefined
          if (!target) {
            streamPayload(controller, { type: "error", error: "schedule not found" })
            controller.close()
            return
          }

          streamPayload(controller, {
            type: "started",
            missionId: scheduleId,
            missionLabel: target.label || "Untitled mission",
            startedAt: new Date().toISOString(),
          })

          const runKey = `manual-trigger-stream:${target.id}:${Date.now()}`
          const skillSnapshot = await loadMissionSkillSnapshot({ userId })
          const startedAtMs = Date.now()
          const execution = await executeMissionWorkflow({
            schedule: target,
            source: "trigger",
            enforceOutputTime: false,
            skillSnapshot,
            scope: verified,
            onStepTrace: async (trace) => {
              streamPayload(controller, { type: "step", trace })
            },
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
              mode: "manual-trigger-stream",
              runKey,
              attempt: 1,
            })
            logStatus = logResult.status
          } catch {
            // Logging failures should not block stream responses.
          }
          const updatedSchedule = applyScheduleRunOutcome(target, {
            status: logStatus,
            now: new Date(),
            mode: "manual-trigger-stream",
          })
          schedules[targetIndex] = updatedSchedule
          await saveSchedules(schedules, { userId })

          streamPayload(controller, {
            type: "done",
            data: {
              ok: execution.ok,
              skipped: execution.skipped,
              reason: execution.reason,
              results: execution.outputs,
              stepTraces: execution.stepTraces,
              novachatQueued,
              schedule: updatedSchedule,
            },
          })
        } catch (error) {
          streamPayload(controller, {
            type: "error",
            error: error instanceof Error ? error.message : "Failed to run mission stream.",
          })
        } finally {
          controller.close()
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
