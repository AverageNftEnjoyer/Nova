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

export interface MissionDeleteResponse {
  ok?: boolean
  deleted?: boolean
  reason?: "deleted" | "not_found" | "invalid_user"
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

export interface WorkflowAutofixCandidate {
  id: string
  issueCode: string
  risk: "low" | "medium" | "high"
  disposition: "safe_auto_apply" | "needs_approval"
  confidence: number
  path: string
  title: string
  message: string
  remediation: string
  changePreview: string
}

export interface WorkflowAutofixResponse {
  ok: boolean
  blocked: boolean
  mode: "minimal" | "full"
  profile: "minimal" | "runtime" | "strict" | "ai-friendly"
  candidates: WorkflowAutofixCandidate[]
  appliedFixIds: string[]
  pendingApprovalFixIds: string[]
  issueReduction: { before: number; after: number }
  summary: GeneratedMissionSummary
}

export interface MissionWorkflowAutofixApiResponse {
  ok?: boolean
  error?: string
  autofix?: WorkflowAutofixResponse
}

export interface MissionVersionRecord {
  versionId: string
  missionId: string
  actorId: string
  ts: string
  eventType: "snapshot" | "pre_restore_backup" | "restore"
  reason?: string
  sourceMissionVersion: number
}

export interface MissionVersionsListResponse {
  ok?: boolean
  error?: string
  versions?: MissionVersionRecord[]
}

export interface MissionVersionRestoreResponse {
  ok?: boolean
  error?: string
  mission?: unknown
  restore?: {
    restoredVersionId?: string
    backupVersionId?: string
  }
}

export interface MissionReliabilitySloStatus {
  metric: "validationPassRate" | "runSuccessRate" | "retryRate" | "runP95Ms"
  target: number
  value: number
  ok: boolean
  unit: "ratio" | "ms"
}

export interface MissionReliabilitySummary {
  totalEvents: number
  validationPassRate: number
  runSuccessRate: number
  retryRate: number
  runP95Ms: number
}

export interface MissionReliabilityResponse {
  ok?: boolean
  error?: string
  lookbackDays?: number
  since?: string
  summary?: MissionReliabilitySummary
  slos?: MissionReliabilitySloStatus[]
  totalEvents?: number
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
  }).then(async (result) => {
    if (result.status !== 404) return result
    // Upsert fallback: some mission graph saves do not have a legacy schedule row yet.
    return createMissionSchedule(payload)
  })
}

export function deleteMissionSchedule(id: string) {
  return requestJson<ScheduleMutationResponse>(`/api/notifications/schedules?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function deleteMissionById(id: string) {
  return requestJson<MissionDeleteResponse>(`/api/missions?id=${encodeURIComponent(id)}`, {
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

export function previewMissionWorkflowAutofix(payload: {
  summary: GeneratedMissionSummary
  mode?: "minimal" | "full"
  profile?: "minimal" | "runtime" | "strict" | "ai-friendly"
  scheduleId?: string
}) {
  return requestJson<MissionWorkflowAutofixApiResponse>("/api/missions/autofix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: payload.summary,
      apply: false,
      mode: payload.mode || "full",
      profile: payload.profile || "strict",
      scheduleId: payload.scheduleId,
    }),
  })
}

export function applyMissionWorkflowAutofix(payload: {
  summary: GeneratedMissionSummary
  approvedFixIds?: string[]
  mode?: "minimal" | "full"
  profile?: "minimal" | "runtime" | "strict" | "ai-friendly"
  scheduleId?: string
}) {
  return requestJson<MissionWorkflowAutofixApiResponse>("/api/missions/autofix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: payload.summary,
      apply: true,
      approvedFixIds: Array.isArray(payload.approvedFixIds) ? payload.approvedFixIds : [],
      mode: payload.mode || "full",
      profile: payload.profile || "strict",
      scheduleId: payload.scheduleId,
    }),
  })
}

export function fetchMissionVersions(payload: { missionId: string; limit?: number }) {
  const missionId = encodeURIComponent(payload.missionId)
  const limit = Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 50
  return requestJson<MissionVersionsListResponse>(`/api/missions/versions?missionId=${missionId}&limit=${limit}`, {
    cache: "no-store",
  })
}

export function restoreMissionVersion(payload: { missionId: string; versionId: string; reason?: string }) {
  return requestJson<MissionVersionRestoreResponse>("/api/missions/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function fetchMissionReliability(payload?: { days?: number }) {
  const days = Number.isFinite(Number(payload?.days)) ? Math.max(1, Math.min(30, Number(payload?.days))) : undefined
  const query = typeof days === "number" ? `?days=${encodeURIComponent(String(days))}` : ""
  return requestJson<MissionReliabilityResponse>(`/api/missions/reliability${query}`, {
    cache: "no-store",
  })
}
