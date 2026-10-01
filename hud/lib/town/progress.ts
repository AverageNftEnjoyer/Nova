/**
 * Nova City progression engine: turns real activity (stats.ts) into XP, a level, quests, buildings and
 * once-only celebration events, persisting what must survive reloads in kv_state (state.ts).
 *
 * Free of `server-only` and `@/` runtime imports so scripts/smoke/town can run it in plain Node; server.ts adds the
 * integration-config lookup that decides which integrations are connected.
 */

import { tx } from "../../../src/db/index.js"
import { INTEGRATION_SETUP_KEYS, type IntegrationSetupKey } from "../integrations/navigation"
import { evaluateQuests, integrationBuildingName, integrationLabel, questRewardFor, type TownQuestContext } from "./quests"
import {
  TOWN_COUNT_KEYS,
  buildBuildings,
  computeXpSources,
  levelForXp,
  titleForLevel,
  totalXp,
  type TownLifetimeCounts,
} from "./rules"
import { readTownActivity, type TownActivity } from "./stats"
import { MAX_PENDING_EVENTS, readTownState, writeTownState, type TownPersistedState } from "./state"
import type { TownAckRequest, TownEvent, TownProgress, TownQuest } from "./types"

export interface BuildTownProgressOptions {
  /** IANA zone that decides "today" for daily quests. */
  timeZone: string
  /** Integrations connected right now (the same flags the HUD uses). */
  connected: ReadonlySet<IntegrationSetupKey>
  now?: Date
  /** Skip the per-user cache (tests). */
  fresh?: boolean
}

/** The UI polls; a short cache keeps that to one computation per user and zone every few seconds. */
export const TOWN_CACHE_TTL_MS = 3_000

interface CacheEntry {
  at: number
  value: TownProgress
}

const cacheStore = globalThis as typeof globalThis & { __novaTownProgressCache?: Map<string, CacheEntry> }

function cache(): Map<string, CacheEntry> {
  if (!cacheStore.__novaTownProgressCache) cacheStore.__novaTownProgressCache = new Map()
  return cacheStore.__novaTownProgressCache
}

export function invalidateTownProgressCache(userId: string): void {
  const prefix = `${userId}\u0000`
  for (const key of cache().keys()) if (key.startsWith(prefix)) cache().delete(key)
}

function pushEvent(state: TownPersistedState, event: TownEvent): boolean {
  if (state.pending.some((existing) => existing.id === event.id)) return false
  state.pending.push(event)
  if (state.pending.length > MAX_PENDING_EVENTS) state.pending.splice(0, state.pending.length - MAX_PENDING_EVENTS)
  return true
}

/** Raises high-water marks from live counts; returns the effective (never lower) counts. */
function mergeHighWater(state: TownPersistedState, activity: TownActivity): { counts: TownLifetimeCounts; changed: boolean } {
  let changed = false
  const counts = { ...activity.counts }
  for (const key of TOWN_COUNT_KEYS) {
    const stored = state.counters[key] ?? 0
    if (counts[key] > stored) {
      state.counters[key] = counts[key]
      changed = true
    } else {
      counts[key] = stored
    }
  }
  for (const key of INTEGRATION_SETUP_KEYS) {
    const stored = state.uses[key] ?? 0
    if (activity.uses[key] > stored) {
      state.uses[key] = activity.uses[key]
      changed = true
    } else {
      activity.uses[key] = stored
    }
  }
  return { counts, changed }
}

function questCompleteEvent(quest: TownQuest, at: string): TownEvent {
  return {
    id: `quest-${quest.id}`,
    kind: "quest-complete",
    title: `Quest complete: ${quest.title}`,
    detail: quest.description,
    xp: quest.xpReward,
    at,
  }
}

/**
 * Computes the user's progress and records anything new (completions, high-water marks, events) in one
 * transaction. Pure reads when nothing changed.
 */
export function buildTownProgress(userId: string, options: BuildTownProgressOptions): TownProgress {
  const now = options.now ?? new Date()
  const cacheKey = `${userId}\u0000${options.timeZone}\u0000${[...options.connected].sort().join(",")}`
  if (!options.fresh) {
    const hit = cache().get(cacheKey)
    if (hit && now.getTime() - hit.at >= 0 && now.getTime() - hit.at < TOWN_CACHE_TTL_MS) return hit.value
  }

  const activity = readTownActivity(userId, options.timeZone, now)
  const nowIso = now.toISOString()

  const progress = tx(() => {
    const state = readTownState(userId)
    const firstRun = !state.initialized
    let changed = firstRun

    const merged = mergeHighWater(state, activity)
    changed ||= merged.changed
    const counts = merged.counts

    for (const key of options.connected) {
      if (!state.connectedEver[key]) {
        state.connectedEver[key] = nowIso
        changed = true
      }
    }
    const connectedEver = new Set(
      INTEGRATION_SETUP_KEYS.filter((key) => Boolean(state.connectedEver[key])),
    )

    if (state.daily.day !== activity.dayKey) {
      state.daily = { day: activity.dayKey, done: {} }
      changed = true
    }

    const ctx: TownQuestContext = {
      counts,
      today: activity.today,
      dayKey: activity.dayKey,
      connectedEver,
      connected: options.connected,
      uses: activity.uses,
    }
    const evaluation = evaluateQuests(ctx, { ...state.quests, ...state.daily.done }, nowIso)
    const newEvents: TownEvent[] = []
    for (const quest of evaluation.newlyCompleted) {
      if (quest.category === "daily") {
        state.daily.done[quest.id] = nowIso
        state.dailyCompleted += 1
        state.dailyXp += quest.xpReward
      } else {
        state.quests[quest.id] = nowIso
      }
      changed = true
      if (!firstRun) newEvents.push(questCompleteEvent(quest, nowIso))
    }

    let questsCompleted = 0
    let questXp = 0
    for (const id of Object.keys(state.quests)) {
      const reward = questRewardFor(id)
      if (reward <= 0) continue
      questsCompleted += 1
      questXp += reward
    }

    const sources = computeXpSources(counts, connectedEver.size, {
      questsCompleted,
      questXp,
      dailyCompleted: state.dailyCompleted,
      dailyXp: state.dailyXp,
    })
    const level = levelForXp(totalXp(sources))
    const buildings = buildBuildings(options.connected, activity.uses)

    if (firstRun) {
      state.initialized = true
      newEvents.push({
        id: "founded",
        kind: "achievement",
        title: "Nova City founded",
        detail: `Your city starts at level ${level.level} (${level.title}). Every real task, deployment, note and chat grows it from here.`,
        at: nowIso,
      })
    } else if (level.level > state.celebratedLevel) {
      const gained = level.level - state.celebratedLevel
      newEvents.push({
        id: `level-${level.level}`,
        kind: "level-up",
        title: `Level ${level.level}: ${level.title}`,
        detail:
          gained > 1
            ? `Nova City grew ${gained} levels and is now a level ${level.level} ${level.title}.`
            : level.title !== titleForLevel(state.celebratedLevel)
              ? `Nova City is now a ${level.title}.`
              : `Nova City reached level ${level.level}.`,
        at: nowIso,
      })
    }
    if (level.level > state.celebratedLevel) {
      state.celebratedLevel = level.level
      changed = true
    }

    for (const building of buildings) {
      const announced = state.buildings[building.integration] ?? 0
      if (building.level <= announced) continue
      state.buildings[building.integration] = building.level
      changed = true
      if (firstRun) continue
      const name = integrationBuildingName(building.integration)
      newEvents.push({
        id: `building-${building.integration}-${building.level}`,
        kind: "building-up",
        title: building.level === 1 ? `${name} opened` : `${name} grew to level ${building.level}`,
        detail:
          building.level === 1
            ? `${integrationLabel(building.integration)} is connected and its building is up.`
            : `${building.uses.toLocaleString("en-US")} uses of ${integrationLabel(building.integration)} built it up.`,
        at: nowIso,
      })
    }

    for (const event of newEvents) pushEvent(state, event)

    const allTutorialDone = evaluation.currentTutorialQuestId === null
    if (allTutorialDone && !state.tutorial.finished && !state.tutorial.skipped) {
      state.tutorial.finished = true
      changed = true
    }

    if (changed) writeTownState(userId, state)

    const result: TownProgress = {
      level,
      sources,
      quests: evaluation.quests,
      buildings,
      pendingEvents: [...state.pending],
      tutorial: {
        active: !state.tutorial.skipped && !state.tutorial.finished && evaluation.currentTutorialQuestId !== null,
        currentQuestId: evaluation.currentTutorialQuestId,
        skipped: state.tutorial.skipped,
      },
      generatedAt: nowIso,
    }
    return result
  })

  cache().set(cacheKey, { at: now.getTime(), value: progress })
  return progress
}

const MAX_ACK_EVENT_IDS = 200

/** Validates an untrusted POST body. Returns null when it is not a TownAckRequest. */
export function parseTownAckRequest(raw: unknown): TownAckRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const request: TownAckRequest = {}
  if (body.eventIds !== undefined) {
    if (!Array.isArray(body.eventIds) || body.eventIds.length > MAX_ACK_EVENT_IDS) return null
    if (!body.eventIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)) return null
    request.eventIds = body.eventIds as string[]
  }
  if (body.tutorial !== undefined) {
    if (body.tutorial !== "skip" && body.tutorial !== "restart" && body.tutorial !== "finish") return null
    request.tutorial = body.tutorial
  }
  if (!request.eventIds && !request.tutorial) return null
  return request
}

/** Removes acknowledged events and applies the tutorial choice. Returns how many events were removed. */
export function applyTownAck(userId: string, request: TownAckRequest): { acknowledged: number } {
  const acknowledged = tx(() => {
    const state = readTownState(userId)
    const ids = new Set(request.eventIds ?? [])
    const before = state.pending.length
    state.pending = state.pending.filter((event) => !ids.has(event.id))
    if (request.tutorial === "skip") state.tutorial = { skipped: true, finished: state.tutorial.finished }
    else if (request.tutorial === "finish") state.tutorial = { skipped: false, finished: true }
    else if (request.tutorial === "restart") state.tutorial = { skipped: false, finished: false }
    writeTownState(userId, state)
    return before - state.pending.length
  })
  invalidateTownProgressCache(userId)
  return { acknowledged }
}
