import "server-only"

import { appendDeadLetterRecord } from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"
import type { JobRunSource } from "./types"

export interface MissionRunDeadLetterEntry {
  id: string
  ts: number
  userId: string
  missionId: string
  jobRunId: string
  attempt: number
  maxAttempts: number
  source: JobRunSource
  status: "dead" | "retry_enqueue_failed"
  reason: string
  errorCode?: string
  errorDetail?: string
  retryBackoffMs?: number
}

export async function appendMissionRunDeadLetter(
  entry: Omit<MissionRunDeadLetterEntry, "id" | "ts">,
): Promise<string> {
  const row: MissionRunDeadLetterEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() }
  return appendDeadLetterRecord("mission_run", entry.userId, row)
}
