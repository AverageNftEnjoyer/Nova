import type { Conversation } from "@/lib/chat/conversations"
import type { ThemeBackgroundType, OrbColor } from "@/lib/settings/userSettings"
import { getActiveUserId } from "@/lib/auth/active-user"

const MISSION_SCHEDULES_STORAGE_KEY_PREFIX = "nova_shell_ui_mission_schedules"
const MISSION_SCHEDULES_TTL_MS = 5 * 60 * 1000
const DEV_TOOLS_METRICS_STORAGE_KEY_PREFIX = "nova_shell_ui_dev_tools_metrics"
const DEV_TOOLS_METRICS_TTL_MS = 5 * 60 * 1000

interface ShellUiCache {
  conversations: Conversation[] | null
  orbColor: OrbColor | null
  background: ThemeBackgroundType | null
  backgroundVideoUrl: string | null
  spotlightEnabled: boolean | null
  missionSchedules: MissionScheduleCacheItem[] | null
  devToolsMetrics: DevToolsMetricsCacheItem | null
}

export interface MissionScheduleCacheItem {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  updatedAt: string
  runCount?: number
  successCount?: number
  failureCount?: number
  lastRunAt?: string
}

interface PersistedMissionSchedules {
  updatedAt: number
  schedules: MissionScheduleCacheItem[]
}

export interface DevToolsMetricsCacheItem {
  totalTraces: number
  totalTokens: number
  errors: number
  warnings: number
  avgLatencyMs: number
  avgQuality: number
}

interface PersistedDevToolsMetrics {
  updatedAt: number
  metrics: DevToolsMetricsCacheItem
}

const cache: ShellUiCache = {
  conversations: null,
  orbColor: null,
  background: null,
  backgroundVideoUrl: null,
  spotlightEnabled: null,
  missionSchedules: null,
  devToolsMetrics: null,
}
let cacheUserId: string | null = null

function storageKeyForUser(userId: string | null): string | null {
  if (!userId) return null
  return `${MISSION_SCHEDULES_STORAGE_KEY_PREFIX}:${userId}`
}

function clearPersistedMissionSchedules(userId: string | null): void {
  if (typeof window === "undefined") return
  const key = storageKeyForUser(userId)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    // no-op
  }
}

function devToolsMetricsStorageKeyForUser(userId: string | null): string | null {
  if (!userId) return null
  return `${DEV_TOOLS_METRICS_STORAGE_KEY_PREFIX}:${userId}`
}

function clearPersistedDevToolsMetrics(userId: string | null): void {
  if (typeof window === "undefined") return
  const key = devToolsMetricsStorageKeyForUser(userId)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    // no-op
  }
}

function readPersistedMissionSchedules(userId: string | null): MissionScheduleCacheItem[] | null {
  if (typeof window === "undefined") return null
  const key = storageKeyForUser(userId)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedMissionSchedules
    if (!parsed || typeof parsed !== "object") {
      localStorage.removeItem(key)
      return null
    }
    const updatedAt = Number(parsed.updatedAt)
    const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY
    if (ageMs > MISSION_SCHEDULES_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    if (!Array.isArray(parsed.schedules)) {
      localStorage.removeItem(key)
      return null
    }
    return [...parsed.schedules]
  } catch {
    clearPersistedMissionSchedules(userId)
    return null
  }
}

function readPersistedDevToolsMetrics(userId: string | null): DevToolsMetricsCacheItem | null {
  if (typeof window === "undefined") return null
  const key = devToolsMetricsStorageKeyForUser(userId)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedDevToolsMetrics
    if (!parsed || typeof parsed !== "object" || !parsed.metrics || typeof parsed.metrics !== "object") {
      localStorage.removeItem(key)
      return null
    }
    const updatedAt = Number(parsed.updatedAt)
    const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY
    if (ageMs > DEV_TOOLS_METRICS_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    const metrics = parsed.metrics
    return {
      totalTraces: Number(metrics.totalTraces || 0),
      totalTokens: Number(metrics.totalTokens || 0),
      errors: Number(metrics.errors || 0),
      warnings: Number(metrics.warnings || 0),
      avgLatencyMs: Number(metrics.avgLatencyMs || 0),
      avgQuality: Number(metrics.avgQuality || 0),
    }
  } catch {
    clearPersistedDevToolsMetrics(userId)
    return null
  }
}

function writePersistedMissionSchedules(
  userId: string | null,
  schedules: MissionScheduleCacheItem[] | null,
): void {
  if (typeof window === "undefined") return
  const key = storageKeyForUser(userId)
  if (!key) return
  try {
    if (!schedules || schedules.length === 0) {
      localStorage.removeItem(key)
      return
    }
    const payload: PersistedMissionSchedules = {
      updatedAt: Date.now(),
      schedules: [...schedules],
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // no-op
  }
}

function writePersistedDevToolsMetrics(userId: string | null, metrics: DevToolsMetricsCacheItem | null): void {
  if (typeof window === "undefined") return
  const key = devToolsMetricsStorageKeyForUser(userId)
  if (!key) return
  try {
    if (!metrics) {
      localStorage.removeItem(key)
      return
    }
    const payload: PersistedDevToolsMetrics = {
      updatedAt: Date.now(),
      metrics: {
        totalTraces: Number(metrics.totalTraces || 0),
        totalTokens: Number(metrics.totalTokens || 0),
        errors: Number(metrics.errors || 0),
        warnings: Number(metrics.warnings || 0),
        avgLatencyMs: Number(metrics.avgLatencyMs || 0),
        avgQuality: Number(metrics.avgQuality || 0),
      },
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // no-op
  }
}

function ensureScopedCacheUser(): void {
  const currentUserId = getActiveUserId() || null
  if (cacheUserId === currentUserId) return
  if (cacheUserId && cacheUserId !== currentUserId) {
    clearPersistedMissionSchedules(cacheUserId)
    clearPersistedDevToolsMetrics(cacheUserId)
  }
  cache.conversations = null
  cache.orbColor = null
  cache.background = null
  cache.backgroundVideoUrl = null
  cache.spotlightEnabled = null
  cache.missionSchedules = readPersistedMissionSchedules(currentUserId)
  cache.devToolsMetrics = readPersistedDevToolsMetrics(currentUserId)
  cacheUserId = currentUserId
}

export function readShellUiCache(): Readonly<ShellUiCache> {
  ensureScopedCacheUser()
  return cache
}

export function writeShellUiCache(next: Partial<ShellUiCache>): void {
  ensureScopedCacheUser()
  if (Object.prototype.hasOwnProperty.call(next, "conversations")) {
    cache.conversations = next.conversations ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "orbColor")) {
    cache.orbColor = next.orbColor ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "background")) {
    cache.background = next.background ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "backgroundVideoUrl")) {
    cache.backgroundVideoUrl = next.backgroundVideoUrl ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "spotlightEnabled")) {
    cache.spotlightEnabled = next.spotlightEnabled ?? null
  }
  if (Object.prototype.hasOwnProperty.call(next, "missionSchedules")) {
    cache.missionSchedules = next.missionSchedules ? [...next.missionSchedules] : null
    writePersistedMissionSchedules(cacheUserId, cache.missionSchedules)
  }
  if (Object.prototype.hasOwnProperty.call(next, "devToolsMetrics")) {
    cache.devToolsMetrics = next.devToolsMetrics
      ? {
        totalTraces: Number(next.devToolsMetrics.totalTraces || 0),
        totalTokens: Number(next.devToolsMetrics.totalTokens || 0),
        errors: Number(next.devToolsMetrics.errors || 0),
        warnings: Number(next.devToolsMetrics.warnings || 0),
        avgLatencyMs: Number(next.devToolsMetrics.avgLatencyMs || 0),
        avgQuality: Number(next.devToolsMetrics.avgQuality || 0),
      }
      : null
    writePersistedDevToolsMetrics(cacheUserId, cache.devToolsMetrics)
  }
}
