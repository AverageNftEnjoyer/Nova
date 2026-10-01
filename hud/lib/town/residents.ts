/**
 * Nova City residents: the contract between the server (`GET/POST /api/town/residents`) and Home's resident card.
 * A resident is an agent task or a connected integration worker; the only thing a user can change is its display
 * name (1-24 characters). A resident without a stored name keeps its default one.
 *
 * Names live in kv_state namespace "town-residents", key "names", per user. Pure apart from the kv helpers and free of
 * `server-only` / `@/` runtime imports so the town smoke can run it in plain Node.
 */

import { kvGet, kvSet, tx } from "../../../src/db/index.js"
import { isIntegrationSetupKey } from "../integrations/navigation"
import type { IntegrationSetupKey } from "../integrations/navigation"

export type ResidentId = `agent:${string}` | `integration:${IntegrationSetupKey}`
/** Resident id -> chosen display name. */
export type ResidentNames = Record<string, string>
export interface ResidentRenameRequest {
  residentId: ResidentId
  /** null (or empty after trimming) clears the custom name. */
  name: string | null
}

export const TOWN_RESIDENTS_NAMESPACE = "town-residents"
export const TOWN_RESIDENTS_KEY = "names"
/** Names kept per user; beyond this a rename that would add another is refused (409), nothing is pruned. */
export const MAX_RESIDENT_NAMES = 200
export const MAX_RESIDENT_NAME_LENGTH = 24
const MAX_RESIDENT_ID_LENGTH = 120

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

/** Control characters out, whitespace trimmed. */
export function cleanName(value: string): string {
  return value.replace(/\p{Cc}/gu, "").trim()
}

/** Parses a stored value defensively; anything unreadable or over-long is dropped. */
export function normalizeResidentNames(raw: unknown): ResidentNames {
  const names: ResidentNames = {}
  if (!isRecord(raw)) return names
  for (const [key, value] of Object.entries(raw)) {
    if (!isResidentId(key) || typeof value !== "string") continue
    const name = cleanName(value)
    if (name && [...name].length <= MAX_RESIDENT_NAME_LENGTH) names[key] = name
  }
  return names
}

export type ResidentRenameParse =
  | { ok: true; request: ResidentRenameRequest }
  | { ok: false; status: 400; error: string }

/** Validates an untrusted POST body. `name: ""`/whitespace/null normalise to null = clear. */
export function parseResidentRename(raw: unknown): ResidentRenameParse {
  const bad = (error: string): ResidentRenameParse => ({ ok: false, status: 400, error })
  if (!isRecord(raw)) return bad("Request body must be a JSON object.")
  if (!isResidentId(raw.residentId)) return bad("residentId must be agent:<id> or integration:<integration key>.")
  if (raw.name === null) return { ok: true, request: { residentId: raw.residentId, name: null } }
  if (typeof raw.name !== "string") return bad("name must be a string or null.")
  const name = cleanName(raw.name)
  if ([...name].length > MAX_RESIDENT_NAME_LENGTH) return bad(`name must be at most ${MAX_RESIDENT_NAME_LENGTH} characters.`)
  return { ok: true, request: { residentId: raw.residentId, name: name === "" ? null : name } }
}

export type ResidentRenameResult = { ok: true; names: ResidentNames } | { ok: false; status: 409; error: string }

/** Applies a parsed rename. Pure: returns a new map, never mutates `current`. */
export function applyResidentRename(current: ResidentNames, request: ResidentRenameRequest): ResidentRenameResult {
  const names = { ...current }
  if (request.name === null || request.name === "") {
    delete names[request.residentId]
    return { ok: true, names }
  }
  if (!(request.residentId in names) && Object.keys(names).length >= MAX_RESIDENT_NAMES) {
    return { ok: false, status: 409, error: `Too many renamed residents (limit ${MAX_RESIDENT_NAMES}).` }
  }
  names[request.residentId] = request.name
  return { ok: true, names }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function loadResidentNames(userId: string): ResidentNames {
  return normalizeResidentNames(kvGet(userId, TOWN_RESIDENTS_NAMESPACE, TOWN_RESIDENTS_KEY))
}

export type ResidentRenameOutcome = { ok: true; names: ResidentNames } | { ok: false; status: number; error: string }

export function renameResident(userId: string, request: ResidentRenameRequest): ResidentRenameOutcome {
  return tx(() => {
    const result = applyResidentRename(loadResidentNames(userId), request)
    if (!result.ok) return result
    kvSet(userId, TOWN_RESIDENTS_NAMESPACE, TOWN_RESIDENTS_KEY, result.names)
    return { ok: true as const, names: result.names }
  })
}
