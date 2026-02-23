import type { Mission } from "../../types"

export type MissionVersionEventType = "snapshot" | "pre_restore_backup" | "restore"

export interface MissionVersionRetentionPolicy {
  maxVersionsPerMission: number
  maxAgeDays: number
}

export interface MissionVersionEntry {
  versionId: string
  missionId: string
  userContextId: string
  actorId: string
  ts: string
  eventType: MissionVersionEventType
  reason?: string
  sourceMissionVersion: number
  mission: Mission
}

export interface MissionVersionRestoreResult {
  ok: boolean
  mission?: Mission
  error?: string
  restoredVersionId?: string
  backupVersionId?: string
}
