export const GLOBAL_SCOPE: "__global__"
export const RUN_LOG_KEEP_ROWS: number
export const MISSION_SECRET_CONTEXT: "missions"

export function sanitizeUserContextId(value: unknown): string
export function getMissionsChangeToken(): string | null
export function listMissionUserIds(): string[]
export function readMissionRecords(userId: string): unknown[]
export function upsertMissionRecord<T>(
  userId: string,
  missionId: string,
  mutate: (existing: T | null) => T | null,
  incoming?: T,
): T | null
export function replaceMissionRecords(userId: string, missions: object[]): void
export function deleteMissionRecord(userId: string, missionId: string): boolean

export function insertTelemetryEvent(event: object, policy?: object): void
export function listTelemetryRecords(input: { userId: string; sinceTs?: string; limit: number }): unknown[]
export function purgeTelemetryForMissionRecords(userId: string, missionId: string): number

export function insertVersionRecord(entry: object, policy?: object): void
export function listVersionRecords(input: { userId: string; missionId: string; limit: number }): unknown[]
export function purgeVersionRecords(userId: string, missionId: string): number

export function appendRunLogRecord(scheduleId: string, userId: string | undefined, entry: object): void
export function readRunLogRecords(scheduleId: string, userId: string | undefined, maxLines: number): unknown[]
export function purgeRunLogRecords(scheduleId: string, userId?: string): number

export function appendDeadLetterRecord(
  kind: "notification" | "mission_run",
  userId: string | undefined,
  entry: object,
): string
export function purgeDeadLetterRecords(kind: "notification" | "mission_run", userId: string | undefined, missionId: string): number
export function listDeadLetterRecords(kind: "notification" | "mission_run", userId?: string, limit?: number): unknown[]

export function appendJournalRecord(entry: object): void
export function insertArtifactRecord(record: object): void
export function pruneExpiredArtifactRecords(userId: string, nowMs: number): number
export function listArtifactRecords(userId: string, scanLimit: number): unknown[]
