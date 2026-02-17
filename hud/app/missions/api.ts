import type { GeneratedMissionSummary, NotificationSchedule } from "./types"

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(input, init)
  const data = await res.json().catch(() => ({})) as T
  return {
    ok: res.ok,
    status: res.status,
    data,
  }
}

export interface SchedulesListResponse {
  schedules?: NotificationSchedule[]
  error?: string
}

export interface ScheduleMutationResponse {
  schedule?: NotificationSchedule
  error?: string
}

export interface TriggerMissionResponse {
  ok?: boolean
  skipped?: boolean
  reason?: string
  stepTraces?: unknown
  error?: string
  schedule?: NotificationSchedule
}

export interface BuildMissionResponse {
  ok?: boolean
  error?: string
  debug?: string
  provider?: string
  model?: string
  workflow?: {
    label?: string
    integration?: string
    summary?: GeneratedMissionSummary
  }
}

export interface NovaSuggestResponse {
  ok?: boolean
  prompt?: string
  error?: string
}

export interface IntegrationCatalogResponse {
  catalog?: unknown[]
}

export function fetchSchedules() {
  return requestJson<SchedulesListResponse>("/api/notifications/schedules", { cache: "no-store" })
}

export function fetchIntegrationCatalog() {
  return requestJson<IntegrationCatalogResponse>("/api/integrations/catalog", { cache: "no-store" })
}

export function createMissionSchedule(payload: Record<string, unknown>) {
  return requestJson<ScheduleMutationResponse>("/api/notifications/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function updateMissionSchedule(payload: Record<string, unknown>) {
  return requestJson<ScheduleMutationResponse>("/api/notifications/schedules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function deleteMissionSchedule(id: string) {
  return requestJson<ScheduleMutationResponse>(`/api/notifications/schedules?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function triggerMissionSchedule(scheduleId: string) {
  return requestJson<TriggerMissionResponse>("/api/notifications/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduleId }),
  })
}

export function buildMissionFromPrompt(payload: {
  prompt: string
  deploy: boolean
  timezone: string
  enabled: boolean
}) {
  return requestJson<BuildMissionResponse>("/api/missions/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function requestNovaSuggest(payload: { stepTitle: string }) {
  return requestJson<NovaSuggestResponse>("/api/missions/nova-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}
