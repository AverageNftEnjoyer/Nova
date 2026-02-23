import "server-only"

type InflightEntry = {
  startedAtMs: number
  userContextId: string
}

type ExecutionGuardState = typeof globalThis & {
  __novaMissionExecutionInflight?: Map<string, InflightEntry>
}

const state = globalThis as ExecutionGuardState
const inflight = state.__novaMissionExecutionInflight ?? new Map<string, InflightEntry>()
state.__novaMissionExecutionInflight = inflight

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function sanitizeScopeId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export const MISSION_EXECUTION_GUARD_POLICY = {
  perUserInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER", 3, 1, 100),
  globalInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL", 200, 1, 5000),
  slotTtlMs: readIntEnv("NOVA_MISSION_EXECUTION_SLOT_TTL_MS", 15 * 60_000, 30_000, 24 * 60 * 60_000),
} as const

export type MissionExecutionSlot = {
  release: () => void
}

export type MissionExecutionGuardDecision = {
  ok: boolean
  reason?: string
  slot?: MissionExecutionSlot
}

function pruneExpiredSlots(nowMs: number): void {
  for (const [key, entry] of inflight.entries()) {
    if (!entry || nowMs - entry.startedAtMs > MISSION_EXECUTION_GUARD_POLICY.slotTtlMs) {
      inflight.delete(key)
    }
  }
}

export function acquireMissionExecutionSlot(input: {
  userContextId: string
  missionRunId: string
}): MissionExecutionGuardDecision {
  const userContextId = sanitizeScopeId(input.userContextId)
  const missionRunId = sanitizeScopeId(input.missionRunId)
  if (!userContextId || !missionRunId) {
    return { ok: true, slot: { release: () => undefined } }
  }

  const nowMs = Date.now()
  pruneExpiredSlots(nowMs)

  const globalInflight = inflight.size
  if (globalInflight >= MISSION_EXECUTION_GUARD_POLICY.globalInflightLimit) {
    return {
      ok: false,
      reason: `Mission execution concurrency exceeded global in-flight cap (${MISSION_EXECUTION_GUARD_POLICY.globalInflightLimit}).`,
    }
  }

  let userInflight = 0
  for (const entry of inflight.values()) {
    if (entry.userContextId === userContextId) userInflight += 1
  }
  if (userInflight >= MISSION_EXECUTION_GUARD_POLICY.perUserInflightLimit) {
    return {
      ok: false,
      reason: `Mission execution concurrency exceeded per-user cap (${MISSION_EXECUTION_GUARD_POLICY.perUserInflightLimit}).`,
    }
  }

  const key = `${userContextId}:${missionRunId}`
  inflight.set(key, { userContextId, startedAtMs: nowMs })
  return {
    ok: true,
    slot: {
      release: () => {
        inflight.delete(key)
      },
    },
  }
}
