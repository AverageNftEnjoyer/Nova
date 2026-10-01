/**
 * Nova City wardrobe: which cosmetics a user owns and how each resident is dressed.
 *
 * Ownership derives from quest completion (state.ts `quests`, the persisted first-completion time, never removed), so an
 * item is never revoked. kv_state namespace "town-wardrobe", key "state", per user, additionally keeps the time each item
 * was first seen unlocked (used to emit its once-only `item-unlock` event) plus resident looks (custom names and what
 * they wear). Pure apart from the kv helpers, and free of `server-only` / `@/` runtime imports so the town smoke can
 * run it in plain Node.
 */

import { kvGet, kvSet, tx } from "../../../src/db/index.js"
import { isIntegrationSetupKey } from "../integrations/navigation"
import { COSMETIC_CATALOG, QUEST_ITEM_REWARDS, getCosmetic, itemRewardFor } from "./cosmetics"
import { readTownState } from "./state"
import type {
  CosmeticItem,
  CosmeticSlot,
  OwnedCosmetic,
  ResidentId,
  ResidentLook,
  TownWardrobe,
  WardrobeUpdateRequest,
} from "./wardrobe-types"

export const TOWN_WARDROBE_NAMESPACE = "town-wardrobe"
export const TOWN_WARDROBE_KEY = "state"
export const TOWN_WARDROBE_VERSION = 1
/** Resident looks kept per user; beyond this an update that would add another is refused (409), nothing is pruned. */
export const MAX_RESIDENT_LOOKS = 200
export const MAX_RESIDENT_NAME_LENGTH = 24
const MAX_RESIDENT_ID_LENGTH = 120
const SLOTS: readonly CosmeticSlot[] = ["outfit", "hat"]

export interface WardrobePersistedState {
  version: number
  /** Item id -> time it was first seen unlocked. */
  unlocked: Record<string, string>
  residents: Record<string, ResidentLook>
}

export function emptyWardrobeState(): WardrobePersistedState {
  return { version: TOWN_WARDROBE_VERSION, unlocked: {}, residents: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function isResidentId(value: unknown): value is ResidentId {
  if (typeof value !== "string" || value.length > MAX_RESIDENT_ID_LENGTH) return false
  if (value.startsWith("agent:")) {
    const id = value.slice("agent:".length)
    return id.trim().length > 0 && !/\p{Cc}/u.test(id)
  }
  if (value.startsWith("integration:")) return isIntegrationSetupKey(value.slice("integration:".length))
  return false
}

function isSlot(value: unknown): value is CosmeticSlot {
  return value === "outfit" || value === "hat"
}

function readLook(key: string, value: unknown): ResidentLook | null {
  if (!isResidentId(key) || !isRecord(value)) return null
  const equipped: ResidentLook["equipped"] = {}
  if (isRecord(value.equipped)) {
    for (const slot of SLOTS) {
      const id = value.equipped[slot]
      const item = typeof id === "string" ? getCosmetic(id) : undefined
      if (item && item.slot === slot) equipped[slot] = item.id
    }
  }
  const name = typeof value.name === "string" ? cleanName(value.name) : ""
  const look: ResidentLook = { residentId: key, ...(name ? { name } : {}), equipped }
  return isEmptyLook(look) ? null : look
}

function isEmptyLook(look: ResidentLook): boolean {
  return !look.name && Object.keys(look.equipped).length === 0
}

/** Parses a stored value defensively; anything unreadable is dropped. */
export function normalizeWardrobeState(raw: unknown): WardrobePersistedState {
  const base = emptyWardrobeState()
  if (!isRecord(raw)) return base
  if (isRecord(raw.unlocked)) {
    for (const [id, at] of Object.entries(raw.unlocked)) if (getCosmetic(id) && typeof at === "string" && at) base.unlocked[id] = at
  }
  if (isRecord(raw.residents)) {
    for (const [key, value] of Object.entries(raw.residents)) {
      const look = readLook(key, value)
      if (look) base.residents[key] = look
    }
  }
  return base
}

export function readWardrobeState(userId: string): WardrobePersistedState {
  return normalizeWardrobeState(kvGet(userId, TOWN_WARDROBE_NAMESPACE, TOWN_WARDROBE_KEY))
}

export function writeWardrobeState(userId: string, state: WardrobePersistedState): void {
  kvSet(userId, TOWN_WARDROBE_NAMESPACE, TOWN_WARDROBE_KEY, state)
}

/** The unlock time of an item: the earlier of what was recorded and the quest's persisted completion; undefined = locked. */
function unlockTime(
  item: CosmeticItem,
  wardrobe: WardrobePersistedState,
  questsCompletedAt: Readonly<Record<string, string>>,
): string | undefined {
  if (item.source.kind === "starter") return undefined
  const fromQuest = questsCompletedAt[item.source.questId]
  const recorded = wardrobe.unlocked[item.id]
  if (recorded && fromQuest) return recorded < fromQuest ? recorded : fromQuest
  return recorded ?? fromQuest
}

function isUnlocked(item: CosmeticItem, wardrobe: WardrobePersistedState, questsCompletedAt: Readonly<Record<string, string>>): boolean {
  return item.source.kind === "starter" || unlockTime(item, wardrobe, questsCompletedAt) !== undefined
}

/**
 * Records items whose quest is completed but that are not yet in `wardrobe.unlocked` (mutates it) and returns them,
 * so the caller can emit one `item-unlock` event each. Items never leave `unlocked`.
 */
export function recordItemUnlocks(
  wardrobe: WardrobePersistedState,
  questsCompletedAt: Readonly<Record<string, string>>,
): Array<{ item: CosmeticItem; at: string }> {
  const added: Array<{ item: CosmeticItem; at: string }> = []
  for (const questId of Object.keys(QUEST_ITEM_REWARDS)) {
    const at = questsCompletedAt[questId]
    const item = itemRewardFor(questId)
    if (!at || !item || wardrobe.unlocked[item.id]) continue
    wardrobe.unlocked[item.id] = at
    added.push({ item, at })
  }
  return added
}

export function buildWardrobe(wardrobe: WardrobePersistedState, questsCompletedAt: Readonly<Record<string, string>>): TownWardrobe {
  const items: OwnedCosmetic[] = COSMETIC_CATALOG.map((item) => {
    const unlockedAt = unlockTime(item, wardrobe, questsCompletedAt)
    return { ...item, unlocked: isUnlocked(item, wardrobe, questsCompletedAt), ...(unlockedAt ? { unlockedAt } : {}) }
  })
  return { items, residents: { ...wardrobe.residents } }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type WardrobeUpdateParse =
  | { ok: true; update: WardrobeUpdateRequest }
  | { ok: false; status: 400; error: string }

/** Control characters out, whitespace trimmed. */
export function cleanName(value: string): string {
  return value.replace(/\p{Cc}/gu, "").trim()
}

/** Validates an untrusted POST body's shape (not ownership). `name: ""`/whitespace/null normalise to null = clear. */
export function parseWardrobeUpdate(raw: unknown): WardrobeUpdateParse {
  const bad = (error: string): WardrobeUpdateParse => ({ ok: false, status: 400, error })
  if (!isRecord(raw)) return bad("Request body must be a JSON object.")
  if (!isResidentId(raw.residentId)) return bad("residentId must be agent:<id> or integration:<integration key>.")
  const update: WardrobeUpdateRequest = { residentId: raw.residentId }
  if (raw.name !== undefined) {
    if (raw.name === null) update.name = null
    else if (typeof raw.name === "string") {
      const name = cleanName(raw.name)
      if ([...name].length > MAX_RESIDENT_NAME_LENGTH) return bad(`name must be at most ${MAX_RESIDENT_NAME_LENGTH} characters.`)
      update.name = name === "" ? null : name
    } else return bad("name must be a string or null.")
  }
  if (raw.equipped !== undefined) {
    if (!isRecord(raw.equipped)) return bad("equipped must be an object.")
    const equipped: NonNullable<WardrobeUpdateRequest["equipped"]> = {}
    for (const [slot, id] of Object.entries(raw.equipped)) {
      if (!isSlot(slot)) return bad(`Unknown slot "${slot.slice(0, 40)}"; use outfit or hat.`)
      if (id !== null && (typeof id !== "string" || id.length === 0 || id.length > 80)) return bad(`equipped.${slot} must be an item id or null.`)
      equipped[slot] = id
    }
    update.equipped = equipped
  }
  if (update.name === undefined && update.equipped === undefined) return bad("Provide name and/or equipped.")
  return { ok: true, update }
}

export type WardrobeApplyResult =
  | { ok: true; state: WardrobePersistedState }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string }

/** Applies a parsed update against ownership. Pure: returns a new state, never mutates `current`. */
export function applyWardrobeUpdate(
  current: WardrobePersistedState,
  questsCompletedAt: Readonly<Record<string, string>>,
  update: WardrobeUpdateRequest,
): WardrobeApplyResult {
  const previous = current.residents[update.residentId]
  const look: ResidentLook = {
    residentId: update.residentId,
    ...(previous?.name ? { name: previous.name } : {}),
    equipped: { ...(previous?.equipped ?? {}) },
  }
  if (update.name !== undefined) {
    if (update.name === null || update.name === "") delete look.name
    else look.name = update.name
  }
  for (const slot of SLOTS) {
    const id = update.equipped?.[slot]
    if (id === undefined) continue
    if (id === null) {
      delete look.equipped[slot]
      continue
    }
    const item = getCosmetic(id)
    if (!item) return { ok: false, status: 404, error: `Unknown item "${id.slice(0, 40)}".` }
    if (item.slot !== slot) return { ok: false, status: 422, error: `${item.name} is a ${item.slot} and cannot be worn in the ${slot} slot.` }
    if (!isUnlocked(item, current, questsCompletedAt)) return { ok: false, status: 403, error: `${item.name} is still locked. Complete "${item.source.kind === "quest" ? item.source.questTitle : "its quest"}" to unlock it.` }
    look.equipped[slot] = id
  }
  const residents = { ...current.residents }
  if (isEmptyLook(look)) delete residents[update.residentId]
  else {
    if (!residents[update.residentId] && Object.keys(residents).length >= MAX_RESIDENT_LOOKS) {
      return { ok: false, status: 409, error: `Too many customised residents (limit ${MAX_RESIDENT_LOOKS}).` }
    }
    residents[update.residentId] = look
  }
  return { ok: true, state: { ...current, residents } }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function loadWardrobe(userId: string): TownWardrobe {
  return buildWardrobe(readWardrobeState(userId), readTownState(userId).quests)
}

export type WardrobeUpdateOutcome = { ok: true; wardrobe: TownWardrobe } | { ok: false; status: number; error: string }

export function updateWardrobe(userId: string, update: WardrobeUpdateRequest): WardrobeUpdateOutcome {
  return tx(() => {
    const quests = readTownState(userId).quests
    const current = readWardrobeState(userId)
    const result = applyWardrobeUpdate(current, quests, update)
    if (!result.ok) return result
    writeWardrobeState(userId, result.state)
    return { ok: true as const, wardrobe: buildWardrobe(result.state, quests) }
  })
}
