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

function normalizeMissionBuildIdempotencySeed(payload: {
  prompt: string
  deploy: boolean
  timezone: string
  enabled: boolean
}): string {
  return JSON.stringify({
    prompt: String(payload.prompt || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 1200),
    deploy: payload.deploy !== false,
    timezone: String(payload.timezone || "").trim(),
    enabled: payload.enabled !== false,
  })
}

function hashMissionBuildSeed(seed: string): string {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, "0")
}

const missionBuildInFlight = new Map<string, Promise<ApiResult<BuildMissionResponse>>>()

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
  results?: Array<{ ok?: boolean; status?: number; error?: string }>
  novachatQueued?: boolean
  error?: string
  schedule?: NotificationSchedule
}

export interface BuildMissionResponse {
  ok?: boolean
  pending?: boolean
  code?: string
  message?: string
  retryAfterMs?: number
  idempotencyKey?: string
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

export interface TriggerMissionStreamEvent {
  type: "started" | "step" | "done" | "error"
  trace?: {
    stepId?: string
    type?: string
    title?: string
    status?: string
    detail?: string
    errorCode?: string
    artifactRef?: string
    retryCount?: number
    startedAt?: string
    endedAt?: string
  }
  data?: TriggerMissionResponse
  error?: string
}

export function triggerMissionScheduleStream(
  scheduleId: string,
  onEvent?: (event: TriggerMissionStreamEvent) => void,
) {
  return new Promise<TriggerMissionResponse>((resolve, reject) => {
    if (typeof window === "undefined") {
      void triggerMissionSchedule(scheduleId)
        .then((res) => resolve(res.data as TriggerMissionResponse))
        .catch((error) => reject(error))
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/notifications/trigger/stream?scheduleId=${encodeURIComponent(scheduleId)}`, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
        })
        if (!res.ok || !res.body) {
          const fallback = await triggerMissionSchedule(scheduleId)
          resolve(fallback.data as TriggerMissionResponse)
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let settled = false

        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          const events = buffer.split("\n\n")
          buffer = events.pop() || ""
          for (const rawEvent of events) {
            const dataLine = rawEvent
              .split("\n")
              .map((line) => line.trim())
              .find((line) => line.startsWith("data:"))
            if (!dataLine) continue
            let payload: TriggerMissionStreamEvent | null = null
            try {
              payload = JSON.parse(dataLine.slice(5).trim()) as TriggerMissionStreamEvent
            } catch {
              continue
            }
            if (!payload) continue
            onEvent?.(payload)
            if (payload.type === "done") {
              settled = true
              resolve((payload.data || {}) as TriggerMissionResponse)
              return
            }
            if (payload.type === "error") {
              settled = true
              reject(new Error(payload.error || "Mission stream failed."))
              return
            }
          }
        }

        if (!settled) {
          const fallback = await triggerMissionSchedule(scheduleId)
          resolve(fallback.data as TriggerMissionResponse)
        }
      } catch (error) {
        try {
          const fallback = await triggerMissionSchedule(scheduleId)
          resolve(fallback.data as TriggerMissionResponse)
        } catch {
          reject(error instanceof Error ? error : new Error("Mission progress stream failed."))
        }
      }
    })()
  })
}

export function buildMissionFromPrompt(payload: {
  prompt: string
  deploy: boolean
  timezone: string
  enabled: boolean
}) {
  const seed = normalizeMissionBuildIdempotencySeed(payload)
  const inFlightKey = hashMissionBuildSeed(seed)
  const existing = missionBuildInFlight.get(inFlightKey)
  if (existing) return existing
  const request = requestJson<BuildMissionResponse>("/api/missions/build", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": inFlightKey,
    },
    body: JSON.stringify(payload),
  })
    .finally(() => {
      missionBuildInFlight.delete(inFlightKey)
    })
  missionBuildInFlight.set(inFlightKey, request)
  return request
}

export function requestNovaSuggest(payload: { stepTitle: string }) {
  return requestJson<NovaSuggestResponse>("/api/missions/nova-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}
