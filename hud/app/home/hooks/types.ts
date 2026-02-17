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
}

export interface MissionSummary {
  id: string
  integration: string
  title: string
  description: string
  priority: "low" | "medium" | "high" | "critical"
  enabledCount: number
  totalCount: number
  times: string[]
  timezone: string
}
