/**
 * Persisted U.B Agents City progression state: kv_state namespace "town-progress", key "state", per user.
 *
 * Holds only what cannot be recomputed from nova.db: high-water marks (so pruned tool runs / LLM rows or deleted
 * notes never lower XP), integrations ever connected, when each quest was first completed, daily quest XP already
 * paid, the highest level and building levels already announced, unacknowledged events and the tutorial choice.
 */

import { kvGet, kvSet } from "../../../src/db/index.js"
import { isIntegrationSetupKey, type IntegrationSetupKey } from "../integrations/navigation"
import { TOWN_COUNT_KEYS, type TownCountKey } from "./rules"
import type { TownEvent } from "./types"

export const TOWN_PROGRESS_NAMESPACE = "town-progress"
export const TOWN_PROGRESS_KEY = "state"
export const TOWN_STATE_VERSION = 1
/** Oldest unacknowledged events are dropped beyond this. */
export const MAX_PENDING_EVENTS = 50

export interface TownPersistedState {
  version: number
  /** False until the first computation set the baseline (existing progress is not replayed as events). */
  initialized: boolean
  tutorial: { skipped: boolean; finished: boolean }
  /** Highest count ever observed per source. */
  counters: Partial<Record<TownCountKey, number>>
  /** Highest uses ever observed per integration. */
  uses: Partial<Record<IntegrationSetupKey, number>>
  /** First time each integration was seen connected. */
  connectedEver: Partial<Record<IntegrationSetupKey, string>>
  /** Non-daily quest id → first completion time. */
  quests: Record<string, string>
  /** Today's completed daily quests (ids carry the day). */
  daily: { day: string; done: Record<string, string> }
  /** Daily quests completed on any day, and the XP they paid. */
  dailyCompleted: number
  dailyXp: number
  /** Highest town level already announced. */
  celebratedLevel: number
  /** Highest building level already announced per integration. */
  buildings: Partial<Record<IntegrationSetupKey, number>>
  pending: TownEvent[]
}

export function emptyTownState(): TownPersistedState {
  return {
    version: TOWN_STATE_VERSION,
    initialized: false,
    tutorial: { skipped: false, finished: false },
    counters: {},
    uses: {},
    connectedEver: {},
    quests: {},
    daily: { day: "", done: {} },
    dailyCompleted: 0,
    dailyXp: 0,
    celebratedLevel: 1,
    buildings: {},
    pending: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonNegative(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(value)) return out
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string" && entry) out[key] = entry
  return out
}

function integrationMap<T>(value: unknown, read: (entry: unknown) => T | null): Partial<Record<IntegrationSetupKey, T>> {
  const out: Partial<Record<IntegrationSetupKey, T>> = {}
  if (!isRecord(value)) return out
  for (const [key, entry] of Object.entries(value)) {
    if (!isIntegrationSetupKey(key)) continue
    const parsed = read(entry)
    if (parsed !== null) out[key] = parsed
  }
  return out
}

const EVENT_KINDS: readonly TownEvent["kind"][] = ["level-up", "quest-complete", "building-up", "achievement"]

function readEvent(value: unknown): TownEvent | null {
  if (!isRecord(value)) return null
  const { id, kind, title, detail, xp, at } = value
  if (typeof id !== "string" || !id || typeof title !== "string" || typeof at !== "string") return null
  if (!EVENT_KINDS.includes(kind as TownEvent["kind"])) return null
  return {
    id,
    kind: kind as TownEvent["kind"],
    title,
    detail: typeof detail === "string" ? detail : "",
    ...(typeof xp === "number" && Number.isFinite(xp) ? { xp } : {}),
    at,
  }
}

/** Parses a stored value defensively; anything unreadable falls back to the empty state's field. */
export function normalizeTownState(raw: unknown): TownPersistedState {
  const base = emptyTownState()
  if (!isRecord(raw)) return base
  const counters: Partial<Record<TownCountKey, number>> = {}
  if (isRecord(raw.counters)) {
    for (const key of TOWN_COUNT_KEYS) {
      const value = nonNegative(raw.counters[key])
      if (value > 0) counters[key] = value
    }
  }
  const tutorial = isRecord(raw.tutorial) ? raw.tutorial : {}
  const daily = isRecord(raw.daily) ? raw.daily : {}
  return {
    version: TOWN_STATE_VERSION,
    initialized: raw.initialized === true,
    tutorial: { skipped: tutorial.skipped === true, finished: tutorial.finished === true },
    counters,
    uses: integrationMap(raw.uses, (entry) => (nonNegative(entry) > 0 ? nonNegative(entry) : null)),
    connectedEver: integrationMap(raw.connectedEver, (entry) => (typeof entry === "string" && entry ? entry : null)),
    quests: stringMap(raw.quests),
    daily: { day: typeof daily.day === "string" ? daily.day : "", done: stringMap(daily.done) },
    dailyCompleted: nonNegative(raw.dailyCompleted),
    dailyXp: nonNegative(raw.dailyXp),
    celebratedLevel: Math.max(1, nonNegative(raw.celebratedLevel)),
    buildings: integrationMap(raw.buildings, (entry) => (nonNegative(entry) > 0 ? Math.min(3, nonNegative(entry)) : null)),
    pending: Array.isArray(raw.pending)
      ? raw.pending.map(readEvent).filter((event): event is TownEvent => event !== null).slice(-MAX_PENDING_EVENTS)
      : [],
  }
}

export function readTownState(userId: string): TownPersistedState {
  return normalizeTownState(kvGet(userId, TOWN_PROGRESS_NAMESPACE, TOWN_PROGRESS_KEY))
}

export function writeTownState(userId: string, state: TownPersistedState): void {
  kvSet(userId, TOWN_PROGRESS_NAMESPACE, TOWN_PROGRESS_KEY, state)
}
