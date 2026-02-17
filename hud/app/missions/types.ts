export interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  updatedAt: string
  runCount?: number
  successCount?: number
  failureCount?: number
  lastRunAt?: string
}

export interface MissionRunStepTrace {
  stepId: string
  type: string
  title: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  detail?: string
}

export interface MissionRunProgress {
  missionId?: string
  missionLabel: string
  running: boolean
  success: boolean
  reason?: string
  steps: MissionRunStepTrace[]
}

export type MissionStatusMessage = null | { type: "success" | "error"; message: string }

export type MissionRuntimeStatus =
  | { kind: "running"; step: number; total: number }
  | { kind: "completed"; at: number }
  | { kind: "failed"; at: number }

export interface MissionActionMenuState {
  mission: NotificationSchedule
  left: number
  top: number
}

export type WorkflowStepType = "trigger" | "fetch" | "ai" | "transform" | "condition" | "output"
export type AiIntegrationType = "openai" | "claude" | "grok" | "gemini"

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  title: string
  aiPrompt?: string
  aiModel?: string
  aiIntegration?: AiIntegrationType
  aiDetailLevel?: "concise" | "standard" | "detailed"
  triggerMode?: "once" | "daily" | "weekly" | "interval"
  triggerTime?: string
  triggerTimezone?: string
  triggerDays?: string[]
  triggerIntervalMinutes?: string
  fetchSource?: "api" | "web" | "calendar" | "crypto" | "rss" | "database"
  fetchMethod?: "GET" | "POST"
  fetchApiIntegrationId?: string
  fetchUrl?: string
  fetchQuery?: string
  fetchHeaders?: string
  fetchSelector?: string
  fetchRefreshMinutes?: string
  fetchIncludeSources?: boolean
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich"
  transformFormat?: "text" | "json" | "markdown" | "table"
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists"
  conditionValue?: string
  conditionLogic?: "all" | "any"
  conditionFailureAction?: "skip" | "notify" | "stop"
  outputChannel?: "telegram" | "discord" | "email" | "push" | "webhook"
  outputTiming?: "immediate" | "scheduled" | "digest"
  outputTime?: string
  outputFrequency?: "once" | "multiple"
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

export interface GeneratedMissionSummary {
  description?: string
  priority?: string
  schedule?: {
    mode?: string
    days?: string[]
    time?: string
    timezone?: string
  }
  missionActive?: boolean
  tags?: string[]
  workflowSteps?: Array<Partial<WorkflowStep>>
}

export interface QuickTemplateOption {
  id: string
  label: string
  description: string
  integration: string
  priority: string
  title: string
  message: string
  time: string
  tags: string[]
  steps: Array<{ type: WorkflowStepType; title: string }>
}
