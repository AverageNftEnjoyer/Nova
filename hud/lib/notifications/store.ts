import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface NotificationSchedule {
  id: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  createdAt: string
  updatedAt: string
  lastSentLocalDate?: string
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

  return {
    id: raw.id,
    label: raw.label?.trim() || "Scheduled notification",
    message: raw.message,
    time: raw.time,
    timezone: raw.timezone,
    enabled: raw.enabled ?? true,
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((c) => String(c).trim()).filter(Boolean) : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastSentLocalDate: raw.lastSentLocalDate,
  }
}

export async function loadSchedules(): Promise<NotificationSchedule[]> {
  await ensureDataFile()

  try {
    const raw = await readFile(DATA_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((row) => normalizeRecord(row as Partial<NotificationSchedule>))
      .filter((row): row is NotificationSchedule => row !== null)
  } catch {
    return []
  }
}

export async function saveSchedules(schedules: NotificationSchedule[]): Promise<void> {
  await ensureDataFile()
  await writeFile(DATA_FILE, JSON.stringify(schedules, null, 2), "utf8")
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
    label: input.label?.trim() || "Scheduled notification",
    message: input.message.trim(),
    time: input.time,
    timezone: input.timezone || "America/New_York",
    enabled: input.enabled ?? true,
    chatIds: (input.chatIds ?? []).map((c) => c.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  }
}
