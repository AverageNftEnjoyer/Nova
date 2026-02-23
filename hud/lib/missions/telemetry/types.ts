export type MissionLifecycleEventType =
  | "mission.build.started"
  | "mission.build.completed"
  | "mission.build.failed"
  | "mission.validation.completed"
  | "mission.run.started"
  | "mission.run.completed"
  | "mission.run.failed"
  | "mission.autofix.completed"
  | "mission.rollback.completed"
  | "mission.rollback.failed"

export type MissionLifecycleStatus = "success" | "error" | "warning" | "info"

export interface MissionLifecycleEvent {
  eventId: string
  ts: string
  eventType: MissionLifecycleEventType
  status: MissionLifecycleStatus
  userContextId: string
  missionId?: string
  missionRunId?: string
  scheduleId?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface MissionTelemetrySummary {
  totalEvents: number
  validationPassRate: number
  runSuccessRate: number
  retryRate: number
  runP95Ms: number
}

export interface MissionSloStatus {
  metric: "validationPassRate" | "runSuccessRate" | "retryRate" | "runP95Ms"
  target: number
  value: number
  ok: boolean
  unit: "ratio" | "ms"
}

export interface MissionSloEvaluation {
  summary: MissionTelemetrySummary
  statuses: MissionSloStatus[]
}
