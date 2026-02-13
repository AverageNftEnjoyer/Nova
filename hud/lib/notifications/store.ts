import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  createdAt: string
  updatedAt: string
  lastSentLocalDate?: string
  runCount: number
  successCount: number
  failureCount: number
  lastRunAt?: string
}

function normalizeIntegration(value: unknown, raw?: Partial<NotificationSchedule>): string {
  const integration = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (integration && /^[a-z0-9_-]+$/.test(integration)) return integration

  // Legacy records may not have an integration field. Use conservative inference.
  const chatIds = Array.isArray(raw?.chatIds) ? raw.chatIds.map((v) => String(v).toLowerCase()) : []
  if (chatIds.some((id) => id.includes("discord.com/api/webhooks") || id.includes("discordapp.com/api/webhooks"))) {
    return "discord"
  }

  const label = typeof raw?.label === "string" ? raw.label.toLowerCase() : ""
  const message = typeof raw?.message === "string" ? raw.message.toLowerCase() : ""
  if (label.includes("discord") || message.includes("discord") || label.includes("discor") || message.includes("discor")) {
    return "discord"
  }
  if (label.includes("telegram") || message.includes("telegram")) {
    return "telegram"
  }

  return "telegram"
}

const DATA_DIR = path.join(process.cwd(), "data")
const DATA_FILE = path.join(DATA_DIR, "notification-schedules.json")

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(DATA_FILE, "utf8")
  } catch {
    await writeFile(DATA_FILE, "[]", "utf8")
  }
}

function normalizeRecord(raw: Partial<NotificationSchedule>): NotificationSchedule | null {
  if (!raw.id || !raw.message || !raw.time || !raw.timezone || !raw.createdAt || !raw.updatedAt) {
    return null
  }

  const runCount = Number.isFinite(Number(raw.runCount)) ? Math.max(0, Number(raw.runCount)) : 0
  const successCount = Number.isFinite(Number(raw.successCount)) ? Math.max(0, Number(raw.successCount)) : 0
  const failureCount = Number.isFinite(Number(raw.failureCount)) ? Math.max(0, Number(raw.failureCount)) : 0

  return {
    id: raw.id,
    integration: normalizeIntegration(raw.integration, raw),
    label: raw.label?.trim() || "Scheduled notification",
    message: raw.message,
    time: raw.time,
    timezone: raw.timezone,
    enabled: raw.enabled ?? true,
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((c) => String(c).trim()).filter(Boolean) : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastSentLocalDate: raw.lastSentLocalDate,
    runCount,
    successCount,
    failureCount,
    lastRunAt: raw.lastRunAt,
  }
}

export async function loadSchedules(): Promise<NotificationSchedule[]> {
  await ensureDataFile()

  try {
    const raw = await readFile(DATA_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const normalized = parsed
      .map((row) => normalizeRecord(row as Partial<NotificationSchedule>))
      .filter((row): row is NotificationSchedule => row !== null)

    const shouldRewrite =
      normalized.length !== parsed.length ||
      parsed.some((row) => {
        if (!row || typeof row !== "object") return true
        const maybe = row as { integration?: unknown }
        return typeof maybe.integration !== "string"
      })

    if (shouldRewrite) {
      await saveSchedules(normalized)
    }

    return normalized
  } catch {
    return []
  }
}

export async function saveSchedules(schedules: NotificationSchedule[]): Promise<void> {
  await ensureDataFile()
  const normalized = schedules
    .map((row) => normalizeRecord(row))
    .filter((row): row is NotificationSchedule => row !== null)
  await writeFile(DATA_FILE, JSON.stringify(normalized, null, 2), "utf8")
}

export function parseDailyTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return { hour, minute }
}

export function buildSchedule(input: {
  integration?: string
  label?: string
  message: string
  time: string
  timezone?: string
  enabled?: boolean
  chatIds?: string[]
}): NotificationSchedule {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    integration: normalizeIntegration(input.integration),
    label: input.label?.trim() || "Scheduled notification",
    message: input.message.trim(),
    time: input.time,
    timezone: input.timezone || "America/New_York",
    enabled: input.enabled ?? true,
    chatIds: (input.chatIds ?? []).map((c) => c.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRunAt: undefined,
  }
}
