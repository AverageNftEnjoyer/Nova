import "server-only"

import { appendJournalRecord } from "../../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"
import type { MissionDiffJournalEntry } from "./types"

export async function appendMissionOperationJournalEntry(entry: MissionDiffJournalEntry): Promise<void> {
  const payload = {
    ...entry,
    userContextId: String(entry.userContextId || ""),
    actorId: String(entry.actorId || "").trim().slice(0, 128),
    missionId: String(entry.missionId || "").trim().slice(0, 128),
    ts: String(entry.ts || new Date().toISOString()),
  }
  appendJournalRecord(payload)
}
