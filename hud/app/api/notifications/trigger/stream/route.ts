import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { executeMissionWorkflow } from "@/lib/missions/runtime"
import { loadSchedules, saveSchedules } from "@/lib/notifications/store"
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

          const execution = await executeMissionWorkflow({
            schedule: target,
            source: "trigger",
            enforceOutputTime: false,
            scope: verified,
            onStepTrace: async (trace) => {
              streamPayload(controller, { type: "step", trace })
            },
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
