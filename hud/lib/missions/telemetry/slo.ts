import { MISSION_SLO_POLICY, RUN_DURATION_EVENT_TYPES } from "./config"
import type { MissionLifecycleEvent, MissionSloEvaluation, MissionSloStatus, MissionTelemetrySummary } from "./types"

function computeP95(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx] || 0
}

export function summarizeMissionTelemetry(events: MissionLifecycleEvent[]): MissionTelemetrySummary {
  const validations = events.filter((event) => event.eventType === "mission.validation.completed")
  const validationPasses = validations.filter((event) => event.status !== "error").length

  const runs = events.filter((event) => event.eventType === "mission.run.completed" || event.eventType === "mission.run.failed")
  const runSuccesses = runs.filter((event) => event.eventType === "mission.run.completed" && event.status === "success").length
  const retries = runs.filter((event) => Number(event.metadata?.attempt || 1) > 1).length
  const durations = runs
    .filter((event) => RUN_DURATION_EVENT_TYPES.has(event.eventType) && Number.isFinite(Number(event.durationMs)))
    .map((event) => Number(event.durationMs || 0))

  return {
    totalEvents: events.length,
    validationPassRate: validations.length > 0 ? validationPasses / validations.length : 1,
    runSuccessRate: runs.length > 0 ? runSuccesses / runs.length : 1,
    retryRate: runs.length > 0 ? retries / runs.length : 0,
    runP95Ms: computeP95(durations),
  }
}

function buildStatuses(summary: MissionTelemetrySummary): MissionSloStatus[] {
  return [
    {
      metric: "validationPassRate",
      target: MISSION_SLO_POLICY.validationPassRateMin,
      value: summary.validationPassRate,
      ok: summary.validationPassRate >= MISSION_SLO_POLICY.validationPassRateMin,
      unit: "ratio",
    },
    {
      metric: "runSuccessRate",
      target: MISSION_SLO_POLICY.runSuccessRateMin,
      value: summary.runSuccessRate,
      ok: summary.runSuccessRate >= MISSION_SLO_POLICY.runSuccessRateMin,
      unit: "ratio",
    },
    {
      metric: "retryRate",
      target: MISSION_SLO_POLICY.retryRateMax,
      value: summary.retryRate,
      ok: summary.retryRate <= MISSION_SLO_POLICY.retryRateMax,
      unit: "ratio",
    },
    {
      metric: "runP95Ms",
      target: MISSION_SLO_POLICY.runP95MsMax,
      value: summary.runP95Ms,
      ok: summary.runP95Ms <= MISSION_SLO_POLICY.runP95MsMax,
      unit: "ms",
    },
  ]
}

export function evaluateMissionSlos(events: MissionLifecycleEvent[]): MissionSloEvaluation {
  const summary = summarizeMissionTelemetry(events)
  return {
    summary,
    statuses: buildStatuses(summary),
  }
}
