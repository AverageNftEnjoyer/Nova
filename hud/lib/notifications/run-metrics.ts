import "server-only"

import type { WorkflowStepTrace } from "@/lib/missions/types"
import { appendNotificationRunLog, type NotificationRunStatus } from "@/lib/notifications/run-log"
import type { NotificationSchedule } from "@/lib/notifications/store"

interface RunExecutionSummary {
  ok: boolean
  skipped: boolean
  outputs: Array<{ ok: boolean; error?: string; status?: number }>
  reason?: string
  stepTraces: WorkflowStepTrace[]
}

export function summarizeOutputCounts(outputs: unknown): { okCount: number; failCount: number } {
  const list = Array.isArray(outputs) ? outputs : []
  const okCount = list.filter((row) => Boolean((row as { ok?: unknown })?.ok)).length
  return {
    okCount,
    failCount: Math.max(0, list.length - okCount),
  }
}

export function resolveRunStatus(params: {
  execution?: RunExecutionSummary | null
  fallbackError?: string
}): { status: NotificationRunStatus; errorMessage: string } {
  const execution = params.execution ?? null
  if (execution?.skipped) {
    const reason = String(execution.reason || "").trim()
    return {
      status: "skipped",
      errorMessage: reason,
    }
  }
  if (execution?.ok) {
    return {
      status: "success",
      errorMessage: "",
    }
  }
  const reason = String(params.fallbackError || execution?.reason || "").trim()
  return {
    status: "error",
    errorMessage: reason || "Execution failed.",
  }
}

export function applyScheduleRunOutcome(
  schedule: NotificationSchedule,
  params: {
    status: NotificationRunStatus
    now?: Date
    dayStamp?: string
    mode?: string
  },
): NotificationSchedule {
  const nowIso = (params.now || new Date()).toISOString()
  const status = params.status
  const mode = String(params.mode || "").trim().toLowerCase()
  const requiresDayLock = mode !== "interval"

  return {
    ...schedule,
    lastSentLocalDate:
      status === "success" && requiresDayLock && params.dayStamp
        ? params.dayStamp
        : schedule.lastSentLocalDate,
    runCount: (Number.isFinite(schedule.runCount) ? schedule.runCount : 0) + 1,
    successCount: (Number.isFinite(schedule.successCount) ? schedule.successCount : 0) + (status === "success" ? 1 : 0),
    failureCount: (Number.isFinite(schedule.failureCount) ? schedule.failureCount : 0) + (status === "error" ? 1 : 0),
    lastRunAt: nowIso,
    lastRunStatus: status,
    updatedAt: nowIso,
  }
}

export async function appendRunLogForExecution(params: {
  schedule: NotificationSchedule
  source: "scheduler" | "trigger"
  execution?: RunExecutionSummary | null
  fallbackError?: string
  mode?: string
  dayStamp?: string
  runKey?: string
  attempt?: number
  durationMs?: number
}): Promise<{ status: NotificationRunStatus; errorMessage: string }> {
  const statusMeta = resolveRunStatus({
    execution: params.execution,
    fallbackError: params.fallbackError,
  })
  const counts = summarizeOutputCounts(params.execution?.outputs)
  await appendNotificationRunLog(params.schedule.id, params.schedule.userId, {
    ts: Date.now(),
    scheduleId: params.schedule.id,
    userId: params.schedule.userId,
    label: params.schedule.label,
    source: params.source,
    status: statusMeta.status,
    error: statusMeta.status === "error" ? statusMeta.errorMessage : undefined,
    mode: params.mode,
    dayStamp: params.dayStamp,
    runKey: String(params.runKey || "").trim() || undefined,
    attempt:
      Number.isFinite(Number(params.attempt || 0)) && Number(params.attempt || 0) > 0
        ? Math.floor(Number(params.attempt || 0))
        : undefined,
    durationMs: Number.isFinite(Number(params.durationMs || 0)) ? Math.max(0, Number(params.durationMs || 0)) : 0,
    outputOkCount: counts.okCount,
    outputFailCount: counts.failCount,
  })
  return statusMeta
}
