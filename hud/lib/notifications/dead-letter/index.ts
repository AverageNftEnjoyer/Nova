import "server-only"

import {
  appendDeadLetterRecord,
  purgeDeadLetterRecords,
} from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"

export interface NotificationDeadLetterEntry {
  id: string
  ts: number
  scheduleId: string
  userId?: string
  label?: string
  source: "scheduler" | "trigger"
  runKey?: string
  attempt?: number
  reason: string
  outputOkCount: number
  outputFailCount: number
  metadata?: Record<string, unknown>
}

export async function purgeDeadLetterForMission(userId: string | undefined, scheduleId: string): Promise<void> {
  purgeDeadLetterRecords("notification", userId, scheduleId)
}

export async function appendNotificationDeadLetter(
  entry: Omit<NotificationDeadLetterEntry, "id" | "ts">,
): Promise<string> {
  const row: NotificationDeadLetterEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() }
  return appendDeadLetterRecord("notification", entry.userId, row)
}
