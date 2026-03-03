import "server-only"

import type { Mission } from "@/lib/missions/types"
import { jobLedger } from "@/lib/missions/job-ledger/store"

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  return fallback
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const QUEUE_MANUAL_PRIORITY = readIntEnv("NOVA_MISSIONS_QUEUE_MANUAL_PRIORITY", 8, 1, 10)

export function isMissionQueueModeEnabled(): boolean {
  return readBooleanEnv("NOVA_MISSIONS_QUEUE_MODE_ENABLED", false)
}

function buildQueueIdempotencyKey(input: {
  userId: string
  missionId: string
  requestIdempotencyKey?: string
}): string | undefined {
  const clientKey = String(input.requestIdempotencyKey || "").trim()
  if (!clientKey) return undefined
  return `manual:${input.userId}:${input.missionId}:${clientKey}`
}

export async function enqueueMissionRunForQueue(input: {
  mission: Mission
  userId: string
  missionRunId: string
  runKey: string
  requestIdempotencyKey?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const idempotencyKey = buildQueueIdempotencyKey({
    userId: input.userId,
    missionId: input.mission.id,
    requestIdempotencyKey: input.requestIdempotencyKey,
  })

  const maxAttempts = input.mission.settings.retryOnFail ? input.mission.settings.retryCount + 1 : 1
  const result = await jobLedger.enqueue({
    id: input.missionRunId,
    user_id: input.userId,
    mission_id: input.mission.id,
    source: "manual",
    priority: QUEUE_MANUAL_PRIORITY,
    max_attempts: maxAttempts,
    run_key: input.runKey,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  })

  if (!result.ok) {
    if (result.error === "duplicate_idempotency_key") {
      return { ok: false, error: "Duplicate run request rejected by idempotency key." }
    }
    return { ok: false, error: result.error || "Failed to enqueue mission run." }
  }

  return { ok: true }
}
