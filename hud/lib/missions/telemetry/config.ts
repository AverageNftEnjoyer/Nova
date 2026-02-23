import type { MissionLifecycleEventType } from "./types"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function readRatioEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

export const MISSION_TELEMETRY_POLICY = {
  maxMetadataDepth: readIntEnv("NOVA_MISSION_TELEMETRY_MAX_METADATA_DEPTH", 4, 1, 8),
  maxStringLength: readIntEnv("NOVA_MISSION_TELEMETRY_MAX_STRING_LENGTH", 512, 32, 4096),
  retentionDays: readIntEnv("NOVA_MISSION_TELEMETRY_RETENTION_DAYS", 30, 1, 365),
  maxEventsPerUser: readIntEnv("NOVA_MISSION_TELEMETRY_MAX_EVENTS_PER_USER", 10_000, 100, 500_000),
} as const

export const MISSION_SLO_POLICY = {
  validationPassRateMin: readRatioEnv("NOVA_MISSION_SLO_VALIDATION_PASS_RATE_MIN", 0.98),
  runSuccessRateMin: readRatioEnv("NOVA_MISSION_SLO_RUN_SUCCESS_RATE_MIN", 0.97),
  retryRateMax: readRatioEnv("NOVA_MISSION_SLO_RETRY_RATE_MAX", 0.1),
  runP95MsMax: readIntEnv("NOVA_MISSION_SLO_RUN_P95_MS_MAX", 30_000, 100, 600_000),
  lookbackDays: readIntEnv("NOVA_MISSION_SLO_LOOKBACK_DAYS", 7, 1, 30),
} as const

export const RUN_DURATION_EVENT_TYPES = new Set<MissionLifecycleEventType>([
  "mission.run.completed",
  "mission.run.failed",
])
