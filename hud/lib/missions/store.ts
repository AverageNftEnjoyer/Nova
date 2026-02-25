/**
 * Mission Store — V.26 Enterprise Overhaul
 *
 * Persistence layer for the new Mission format. Stores missions.json per user.
 * Auto-migrates legacy NotificationSchedule records on first load.
 */

import "server-only"

import { mkdir, readdir, readFile, rename, writeFile, copyFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import type { NotificationSchedule } from "@/lib/notifications/store"
import type {
  Mission,
  MissionNode,
  MissionConnection,
  MissionCategory,
  MissionSettings,
} from "./types"
import { defaultMissionSettings } from "./types"
import { parseMissionWorkflow } from "./workflow/parsing"
import { normalizeWorkflowStep } from "./utils/config"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MISSIONS_FILE_NAME = "missions.json"
const MISSIONS_SCHEMA_VERSION = 1
const writesByPath = new Map<string, Promise<void>>()
// Per-user lock for read-modify-write operations (upsert/delete) — prevents lost updates
// under concurrent requests for the same user.
const upsertLocksByUserId = new Map<string, Promise<void>>()

// ─────────────────────────────────────────────────────────────────────────────
// Path Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveUserContextRoot(): string {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context")
}

function sanitizeUserId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

function resolveMissionsFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, MISSIONS_FILE_NAME)
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Write
// ─────────────────────────────────────────────────────────────────────────────

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true })
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      const body = `${JSON.stringify(payload, null, 2)}\n`
      await writeFile(tmpPath, body, "utf8")
      // Backup the current file BEFORE overwriting it, so .bak is never stale
      try {
        await copyFile(resolved, `${resolved}.bak`)
      } catch {
        // Best-effort — file may not exist yet on first write.
      }
      await rename(tmpPath, resolved)
    })
  writesByPath.set(resolved, next)
  await next
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: NotificationSchedule → Mission
// ─────────────────────────────────────────────────────────────────────────────

function guessCategory(label: string, tags: string[]): MissionCategory {
  const text = `${label} ${tags.join(" ")}`.toLowerCase()
  if (/crypto|bitcoin|eth|coinbase|portfolio|pnl|defi|token/.test(text)) return "finance"
  if (/stock|market|trading|equity|option|forex|fund/.test(text)) return "finance"
  if (/deploy|uptime|ci|cd|alert|error|log|monitor|devops|infra/.test(text)) return "devops"
  if (/seo|lead|ad|campaign|funnel|marketing|growth/.test(text)) return "marketing"
  if (/research|brief|news|digest|summary|headline|article/.test(text)) return "research"
  if (/ecommerce|order|product|shop|inventory|cart/.test(text)) return "ecommerce"
  if (/hr|employee|onboard|leave|payroll|talent/.test(text)) return "hr"
  if (/security|threat|vuln|breach|scan|pentest/.test(text)) return "security"
  if (/content|blog|post|social|tweet|youtube|tiktok/.test(text)) return "content"
  if (/weather|remind|habit|travel|personal|morning|evening/.test(text)) return "personal"
  return "research"
}

function legacyStepToNode(step: ReturnType<typeof normalizeWorkflowStep>, index: number): MissionNode {
  const id = String(step.id || `node-${index + 1}`)
  const label = String(step.title || step.type || "Node")
  const position = { x: 200 + index * 220, y: 200 }
  const type = String(step.type || "output")

  if (type === "trigger") {
    const mode = String(step.triggerMode || "daily") as "once" | "daily" | "weekly" | "interval"
    return {
      id,
      type: "schedule-trigger",
      label,
      position,
      triggerMode: mode,
      triggerTime: typeof step.triggerTime === "string" ? step.triggerTime : undefined,
      triggerTimezone: typeof step.triggerTimezone === "string" ? step.triggerTimezone : undefined,
      triggerDays: Array.isArray(step.triggerDays) ? step.triggerDays : undefined,
      triggerIntervalMinutes: step.triggerIntervalMinutes ? Number(step.triggerIntervalMinutes) : undefined,
    }
  }

  if (type === "coinbase") {
    return {
      id,
      type: "coinbase",
      label,
      position,
      intent: (step.coinbaseIntent as "status" | "price" | "portfolio" | "transactions" | "report") || "report",
      assets: step.coinbaseParams?.assets,
      quoteCurrency: step.coinbaseParams?.quoteCurrency,
      thresholdPct: step.coinbaseParams?.thresholdPct,
      cadence: step.coinbaseParams?.cadence,
      transactionLimit: step.coinbaseParams?.transactionLimit,
      includePreviousArtifactContext: step.coinbaseParams?.includePreviousArtifactContext,
      format: step.coinbaseFormat
        ? { style: step.coinbaseFormat.style as "concise" | "standard" | "detailed" | undefined, includeRawMetadata: step.coinbaseFormat.includeRawMetadata }
        : undefined,
    }
  }

  if (type === "fetch") {
    const src = String(step.fetchSource || "web")
    if (src === "web" || src === "crypto") {
      return {
        id,
        type: "web-search",
        label,
        position,
        query: String(step.fetchQuery || ""),
        includeSources: step.fetchIncludeSources === true,
        fetchContent: true,
      }
    }
    if (src === "rss") {
      return {
        id,
        type: "rss-feed",
        label,
        position,
        url: String(step.fetchUrl || ""),
      }
    }
    // api / database / calendar → http-request
    return {
      id,
      type: "http-request",
      label,
      position,
      method: (step.fetchMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE") || "GET",
      url: String(step.fetchUrl || ""),
      selector: typeof step.fetchSelector === "string" ? step.fetchSelector : undefined,
    }
  }

  if (type === "ai") {
    return {
      id,
      type: "ai-summarize",
      label,
      position,
      prompt: String(step.aiPrompt || "Summarize the input."),
      integration: (step.aiIntegration as "openai" | "claude" | "grok" | "gemini") || "claude",
      model: typeof step.aiModel === "string" ? step.aiModel : undefined,
      detailLevel: (step.aiDetailLevel as "concise" | "standard" | "detailed") || "standard",
    }
  }

  if (type === "transform") {
    const action = String(step.transformAction || "format")
    if (action === "dedupe") {
      return { id, type: "dedupe", label, position, field: "text" }
    }
    if (action === "normalize" || action === "aggregate") {
      return {
        id,
        type: "code",
        label,
        position,
        language: "javascript",
        code: `// ${action} transform\nreturn $input;`,
      }
    }
    return {
      id,
      type: "format",
      label,
      position,
      template: String(step.transformInstruction || "{{$nodes.previous.output.text}}"),
      outputFormat: (step.transformFormat as "text" | "markdown" | "json" | "html") || "text",
    }
  }

  if (type === "condition") {
    return {
      id,
      type: "condition",
      label,
      position,
      rules: [
        {
          field: String(step.conditionField || "{{$nodes.previous.output.text}}"),
          operator: (step.conditionOperator as "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | "not_exists") || "exists",
          value: typeof step.conditionValue === "string" ? step.conditionValue : undefined,
        },
      ],
      logic: (step.conditionLogic as "all" | "any") || "all",
    }
  }

  if (type === "output") {
    const channel = String(step.outputChannel || "novachat")
    const msgTemplate = typeof step.outputTemplate === "string" && step.outputTemplate.trim()
      ? step.outputTemplate
      : undefined

    // Parse outputRecipients string → typed array for each channel's node field
    const rawRecipients = typeof step.outputRecipients === "string" ? step.outputRecipients.trim() : ""
    const recipientList = rawRecipients ? rawRecipients.split(",").map((r) => r.trim()).filter(Boolean) : undefined

    if (channel === "telegram") {
      return { id, type: "telegram-output", label, position, messageTemplate: msgTemplate, ...(recipientList ? { chatIds: recipientList } : {}) }
    }
    if (channel === "discord") {
      return { id, type: "discord-output", label, position, messageTemplate: msgTemplate, ...(recipientList ? { webhookUrls: recipientList } : {}) }
    }
    if (channel === "email") {
      return { id, type: "email-output", label, position, messageTemplate: msgTemplate, ...(recipientList ? { recipients: recipientList } : {}) }
    }
    if (channel === "webhook") {
      const webhookUrl = recipientList?.[0] || ""
      return { id, type: "webhook-output", label, position, url: webhookUrl }
    }
    if (channel === "slack") {
      return { id, type: "slack-output", label, position, messageTemplate: msgTemplate }
    }
    return { id, type: "novachat-output", label, position, messageTemplate: msgTemplate }
  }

  // Fallback
  return { id, type: "novachat-output", label, position }
}

/**
 * Convert a legacy NotificationSchedule to a Mission.
 * Parses embedded workflow JSON from the message field.
 */
export function migrateLegacyScheduleToMission(schedule: NotificationSchedule): Mission {
  const parsed = parseMissionWorkflow(schedule.message)
  const rawSteps = Array.isArray(parsed.summary?.workflowSteps) ? parsed.summary!.workflowSteps : []
  const steps = rawSteps.map((s, i) => normalizeWorkflowStep(s, i))

  const nodes: MissionNode[] = steps.map((s, i) => legacyStepToNode(s, i))

  // Build linear connections: each node connects "main" → next node "main"
  const connections: MissionConnection[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const source = nodes[i]
    connections.push({
      id: `conn-${i}`,
      sourceNodeId: source.id,
      sourcePort: source.type === "condition" ? "true" : "main",
      targetNodeId: nodes[i + 1].id,
      targetPort: "main",
    })
  }

  const tags = Array.isArray(parsed.summary?.tags) ? parsed.summary!.tags.map((t) => String(t)) : []
  const category = guessCategory(schedule.label, tags)

  const settings: MissionSettings = {
    ...defaultMissionSettings(),
    timezone: schedule.timezone || "America/New_York",
  }

  // If no workflow steps found, create a simple trigger → novachat-output from the message text
  if (nodes.length === 0) {
    const triggerId = "node-1"
    const outputId = "node-2"
    nodes.push(
      {
        id: triggerId,
        type: "schedule-trigger",
        label: "Schedule Trigger",
        position: { x: 200, y: 200 },
        triggerMode: "daily",
        triggerTime: schedule.time,
        triggerTimezone: schedule.timezone,
      },
      {
        id: outputId,
        type: "novachat-output",
        label: "Send to Nova",
        position: { x: 420, y: 200 },
        messageTemplate: schedule.message,
      },
    )
    connections.push({
      id: "conn-0",
      sourceNodeId: triggerId,
      sourcePort: "main",
      targetNodeId: outputId,
      targetPort: "main",
    })
  }

  return {
    id: schedule.id,
    userId: String(schedule.userId || ""),
    label: schedule.label,
    description: parsed.description || schedule.label,
    category,
    tags,
    status: schedule.enabled ? "active" : "paused",
    version: 1,
    nodes,
    connections,
    variables: [],
    settings,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    lastRunAt: schedule.lastRunAt,
    lastSentLocalDate: schedule.lastSentLocalDate,
    runCount: schedule.runCount ?? 0,
    successCount: schedule.successCount ?? 0,
    failureCount: schedule.failureCount ?? 0,
    lastRunStatus: schedule.lastRunStatus,
    integration: schedule.integration,
    chatIds: Array.isArray(schedule.chatIds) ? schedule.chatIds : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store File Format
// ─────────────────────────────────────────────────────────────────────────────

interface MissionsStoreFile {
  version: number
  missions: Mission[]
  deletedIds?: string[]
  updatedAt: string
  migratedAt?: string
}

function defaultStorePayload(): MissionsStoreFile {
  return {
    version: MISSIONS_SCHEMA_VERSION,
    missions: [],
    updatedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeMission(raw: Partial<Mission>): Mission | null {
  if (!raw.id || !raw.createdAt || !raw.updatedAt) return null
  const settings: MissionSettings = {
    ...defaultMissionSettings(),
    ...(typeof raw.settings === "object" && raw.settings !== null ? raw.settings : {}),
  }
  return {
    id: raw.id,
    userId: String(raw.userId || ""),
    label: String(raw.label || "Untitled Mission"),
    description: String(raw.description || ""),
    category: (raw.category as MissionCategory) || "research",
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)).filter(Boolean) : [],
    status: (raw.status as Mission["status"]) || "active",
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
    nodes: Array.isArray(raw.nodes) ? (raw.nodes as MissionNode[]) : [],
    connections: Array.isArray(raw.connections) ? (raw.connections as MissionConnection[]) : [],
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    settings,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastRunAt: raw.lastRunAt,
    lastSentLocalDate: raw.lastSentLocalDate,
    runCount: Number.isFinite(Number(raw.runCount)) ? Math.max(0, Number(raw.runCount)) : 0,
    successCount: Number.isFinite(Number(raw.successCount)) ? Math.max(0, Number(raw.successCount)) : 0,
    failureCount: Number.isFinite(Number(raw.failureCount)) ? Math.max(0, Number(raw.failureCount)) : 0,
    lastRunStatus: raw.lastRunStatus,
    integration: String(raw.integration || "telegram"),
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((c) => String(c).trim()).filter(Boolean) : [],
  }
}

function sortMissions(rows: Mission[]): Mission[] {
  return [...rows].sort((a, b) => {
    const byCreated = String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    if (byCreated !== 0) return byCreated
    return String(a.id || "").localeCompare(String(b.id || ""))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped Load / Save
// ─────────────────────────────────────────────────────────────────────────────

async function ensureMissionsFile(userId: string): Promise<void> {
  const file = resolveMissionsFile(userId)
  await mkdir(path.dirname(file), { recursive: true })
  try {
    await readFile(file, "utf8")
  } catch {
    await atomicWriteJson(file, defaultStorePayload())
  }
}

async function readRawStoreFile(userId: string): Promise<MissionsStoreFile | null> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return null
  const file = resolveMissionsFile(sanitized)
  try {
    const raw = await readFile(file, "utf8")
    return JSON.parse(raw) as MissionsStoreFile
  } catch {
    return null
  }
}

async function loadScopedMissions(userId: string): Promise<Mission[]> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return []
  await ensureMissionsFile(sanitized)
  const file = resolveMissionsFile(sanitized)
  try {
    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw) as MissionsStoreFile
    return (Array.isArray(parsed.missions) ? parsed.missions : [])
      .map((m) => normalizeMission(m as Partial<Mission>))
      .filter((m): m is Mission => m !== null)
      .map((m) => ({ ...m, userId: sanitized }))
  } catch {
    try {
      const backupRaw = await readFile(`${file}.bak`, "utf8")
      const parsed = JSON.parse(backupRaw) as MissionsStoreFile
      return (Array.isArray(parsed.missions) ? parsed.missions : [])
        .map((m) => normalizeMission(m as Partial<Mission>))
        .filter((m): m is Mission => m !== null)
        .map((m) => ({ ...m, userId: sanitized }))
    } catch {
      await atomicWriteJson(file, defaultStorePayload())
      return []
    }
  }
}

async function saveScopedMissions(userId: string, missions: Mission[], deletedIds?: string[]): Promise<void> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return
  const file = resolveMissionsFile(sanitized)
  const normalized = sortMissions(
    missions
      .map((m) => normalizeMission(m))
      .filter((m): m is Mission => m !== null)
      .map((m) => ({ ...m, userId: sanitized })),
  )
  // If no deletedIds provided, preserve existing ones from disk so they survive all writes.
  let finalDeletedIds = deletedIds
  if (finalDeletedIds === undefined) {
    const raw = await readRawStoreFile(sanitized)
    finalDeletedIds = Array.isArray(raw?.deletedIds) ? raw.deletedIds : []
  }
  const payload: MissionsStoreFile = {
    version: MISSIONS_SCHEMA_VERSION,
    missions: normalized,
    updatedAt: new Date().toISOString(),
  }
  if (finalDeletedIds.length > 0) {
    payload.deletedIds = finalDeletedIds
  }
  await atomicWriteJson(file, payload)
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration Guard (run once per user per startup)
// ─────────────────────────────────────────────────────────────────────────────

const migratedUsers = new Set<string>()

async function migrateFromLegacyIfNeeded(userId: string): Promise<void> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized || migratedUsers.has(sanitized)) return
  migratedUsers.add(sanitized)

  // Dynamically import legacy store to avoid circular dep
  const { loadSchedules } = await import("@/lib/notifications/store")
  const legacySchedules = await loadSchedules({ userId: sanitized })
  if (legacySchedules.length === 0) return

  const existing = await loadScopedMissions(sanitized)
  const existingIds = new Set(existing.map((m) => m.id))

  // Load explicitly-deleted IDs so we never re-import missions the user deleted.
  const rawStore = await readRawStoreFile(sanitized)
  const deletedIds = new Set(Array.isArray(rawStore?.deletedIds) ? rawStore.deletedIds : [])

  const toImport = legacySchedules.filter((s) => !existingIds.has(s.id) && !deletedIds.has(s.id))
  if (toImport.length === 0) return

  const migrated = toImport.map((s) => migrateLegacyScheduleToMission(s))
  await saveScopedMissions(sanitized, [...existing, ...migrated], Array.from(deletedIds))
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function loadMissions(options?: { userId?: string | null; allUsers?: boolean }): Promise<Mission[]> {
  if (options?.allUsers) {
    const userContextRoot = resolveUserContextRoot()
    let userIds: string[] = []
    try {
      const entries = await readdir(userContextRoot, { withFileTypes: true })
      userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((n) => /^[a-z0-9_-]+$/.test(n))
    } catch {
      return []
    }
    const all: Mission[] = []
    for (const uid of userIds) {
      await migrateFromLegacyIfNeeded(uid)
      all.push(...(await loadScopedMissions(uid)))
    }
    return all
  }

  const userId = sanitizeUserId(options?.userId || "")
  if (!userId) return []
  await migrateFromLegacyIfNeeded(userId)
  return loadScopedMissions(userId)
}

export async function saveMissions(
  missions: Mission[],
  options?: { userId?: string | null },
): Promise<void> {
  if (!options?.userId) {
    // Group by userId
    const byUser = new Map<string, Mission[]>()
    for (const m of missions) {
      const uid = sanitizeUserId(m.userId || "")
      if (!uid) continue
      if (!byUser.has(uid)) byUser.set(uid, [])
      byUser.get(uid)!.push(m)
    }
    for (const [uid, userMissions] of byUser.entries()) {
      await saveScopedMissions(uid, userMissions)
    }
    return
  }
  const uid = sanitizeUserId(options.userId)
  if (!uid) return
  await saveScopedMissions(uid, missions.map((m) => ({ ...m, userId: uid })))
}

export async function upsertMission(mission: Mission, userId: string): Promise<void> {
  const uid = sanitizeUserId(userId)
  if (!uid) return
  // Serialize all upserts per user to prevent read-modify-write races
  const prev = upsertLocksByUserId.get(uid) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const existing = await loadScopedMissions(uid)
    const idx = existing.findIndex((m) => m.id === mission.id)
    if (idx >= 0) {
      // Preserve existing execution metadata (lastRunAt, lastRunStatus, etc.) unless the
      // incoming mission explicitly overwrites them.
      existing[idx] = { ...existing[idx], ...mission, userId: uid, updatedAt: new Date().toISOString() }
    } else {
      existing.push({ ...mission, userId: uid })
    }
    await saveScopedMissions(uid, existing)
  })
  upsertLocksByUserId.set(uid, next)
  await next
}

export interface MissionDeleteResult {
  ok: boolean
  deleted: boolean
  reason: "deleted" | "invalid_user" | "not_found"
}

export async function deleteMission(missionId: string, userId: string): Promise<MissionDeleteResult> {
  const uid = sanitizeUserId(userId)
  if (!uid) return { ok: false, deleted: false, reason: "invalid_user" }
  const targetMissionId = String(missionId || "").trim()
  if (!targetMissionId) return { ok: true, deleted: false, reason: "not_found" }

  let result: MissionDeleteResult = { ok: true, deleted: false, reason: "not_found" }
  // Serialize with upserts to prevent concurrent read-modify-write races
  const prev = upsertLocksByUserId.get(uid) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const existing = await loadScopedMissions(uid)
    const filtered = existing.filter((m) => m.id !== targetMissionId)
    if (filtered.length === existing.length) return
    const rawStore = await readRawStoreFile(uid)
    const existingDeletedIds = Array.isArray(rawStore?.deletedIds) ? rawStore.deletedIds : []
    const updatedDeletedIds = [...new Set([...existingDeletedIds, targetMissionId])]
    await saveScopedMissions(uid, filtered, updatedDeletedIds)
    result = { ok: true, deleted: true, reason: "deleted" }
  })
  upsertLocksByUserId.set(uid, next)
  await next
  return result
}

export function buildMission(input: {
  userId?: string
  label?: string
  description?: string
  category?: MissionCategory
  tags?: string[]
  nodes?: MissionNode[]
  connections?: MissionConnection[]
  integration?: string
  chatIds?: string[]
}): Mission {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId: String(input.userId || ""),
    label: input.label?.trim() || "New Mission",
    description: input.description?.trim() || "",
    category: input.category || "research",
    tags: input.tags || [],
    status: "draft",
    version: 1,
    nodes: input.nodes || [],
    connections: input.connections || [],
    variables: [],
    settings: defaultMissionSettings(),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: input.integration || "telegram",
    chatIds: input.chatIds || [],
  }
}
