"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { INTEGRATIONS_UPDATED_EVENT } from "@/lib/integrations/client-store"
import { resolveTimezone } from "@/lib/shared/timezone"

interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  updatedAt: string
}

export interface Mission {
  id: string
  integration: string
  title: string
  description: string
  priority: "low" | "medium" | "high" | "critical"
  enabledCount: number
  totalCount: number
  times: string[]
  timezone: string
}

function priorityRank(priority: "low" | "medium" | "high" | "critical"): number {
  if (priority === "low") return 0
  if (priority === "medium") return 1
  if (priority === "high") return 2
  return 3
}

function normalizePriority(value: string | undefined): "low" | "medium" | "high" | "critical" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized
  return "medium"
}

function parseMissionWorkflowMeta(message: string | undefined): {
  description: string
  priority: "low" | "medium" | "high" | "critical"
} {
  const raw = typeof message === "string" ? message : ""
  const marker = "[NOVA WORKFLOW]"
  const idx = raw.indexOf(marker)
  const description = (idx < 0 ? raw : raw.slice(0, idx)).trim()
  if (idx < 0) return { description, priority: "medium" }

  const jsonText = raw.slice(idx + marker.length).trim()
  try {
    const parsed = JSON.parse(jsonText) as { priority?: string }
    return { description, priority: normalizePriority(parsed.priority) }
  } catch {
    return { description, priority: "medium" }
  }
}

export function formatDailyTime(time: string, timezone: string): string {
  const parts = /^(\d{2}):(\d{2})$/.exec(time)
  if (!parts) return time
  const hour = Number(parts[1])
  const minute = Number(parts[2])
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: resolveTimezone(timezone),
  }).format(date)
}

export interface UseMissionsReturn {
  missions: Mission[]
  notificationSchedules: NotificationSchedule[]
  refreshNotificationSchedules: () => void
}

export function useMissions(): UseMissionsReturn {
  const router = useRouter()
  const [notificationSchedules, setNotificationSchedules] = useState<NotificationSchedule[]>([])

  const refreshNotificationSchedules = useCallback(() => {
    void fetch("/api/notifications/schedules", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/chat")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const schedules = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
        setNotificationSchedules(schedules)
      })
      .catch(() => {
        setNotificationSchedules([])
      })
  }, [router])

  // Initial load
  useEffect(() => {
    refreshNotificationSchedules()
  }, [refreshNotificationSchedules])

  // Listen for integration updates
  useEffect(() => {
    const onUpdate = () => {
      refreshNotificationSchedules()
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [refreshNotificationSchedules])

  // Transform schedules into missions
  const missions = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string
        integration: string
        title: string
        description: string
        priority: "low" | "medium" | "high" | "critical"
        enabledCount: number
        totalCount: number
        times: string[]
        timezone: string
      }
    >()

    for (const schedule of notificationSchedules) {
      const meta = parseMissionWorkflowMeta(schedule.message)
      const title = schedule.label?.trim() || "Scheduled notification"
      const integration = schedule.integration?.trim().toLowerCase() || "unknown"
      const key = `${integration}:${title.toLowerCase()}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: schedule.id,
          integration,
          title,
          description: meta.description,
          priority: meta.priority,
          enabledCount: schedule.enabled ? 1 : 0,
          totalCount: 1,
          times: [schedule.time],
          timezone: resolveTimezone(schedule.timezone),
        })
        continue
      }
      existing.totalCount += 1
      if (schedule.enabled) existing.enabledCount += 1
      existing.times.push(schedule.time)
      if (!existing.description && meta.description) {
        existing.description = meta.description
      }
      if (priorityRank(meta.priority) > priorityRank(existing.priority)) {
        existing.priority = meta.priority
      }
    }

    return Array.from(grouped.values())
      .map((mission) => ({
        ...mission,
        times: mission.times.sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => {
        const activeDelta = Number(b.enabledCount > 0) - Number(a.enabledCount > 0)
        if (activeDelta !== 0) return activeDelta
        return b.totalCount - a.totalCount
      })
  }, [notificationSchedules])

  return {
    missions,
    notificationSchedules,
    refreshNotificationSchedules,
  }
}
