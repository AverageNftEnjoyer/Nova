import type { MissionVersionRetentionPolicy } from "./types"

function parseIntWithBounds(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const MISSION_VERSIONING_RETENTION_POLICY: MissionVersionRetentionPolicy = {
  maxVersionsPerMission: parseIntWithBounds(process.env.NOVA_MISSION_VERSION_MAX_VERSIONS_PER_MISSION, 150, 10, 5000),
  maxAgeDays: parseIntWithBounds(process.env.NOVA_MISSION_VERSION_MAX_AGE_DAYS, 365, 7, 3650),
}
