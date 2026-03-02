"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { INTEGRATIONS_UPDATED_EVENT } from "@/lib/integrations/store/client-store"
import { getRuntimeTimezone, resolveTimezone } from "@/lib/shared/timezone"
import type { Mission as NativeMission, MissionNode } from "@/lib/missions/types"

interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  description?: string
  priority?: "low" | "medium" | "high" | "critical"
  time: string
  times?: string[]
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

function normalizePriority(value: string | undefined): "low" | "medium" | "high" | "critical" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized
  return "medium"
}

function isScheduleTriggerNode(node: MissionNode): node is Extract<MissionNode, { type: "schedule-trigger" }> {
  return node.type === "schedule-trigger"
}

function toMissionRecord(value: unknown): NativeMission | null {
  if (!value || typeof value !== "object") return null
  const row = value as Partial<NativeMission>
  if (typeof row.id !== "string" || !row.id.trim()) return null
  if (!Array.isArray(row.nodes) || !Array.isArray(row.connections)) return null
  if (typeof row.label !== "string") return null
  return row as NativeMission
}

function missionToNotificationSchedule(mission: NativeMission): NotificationSchedule {
  const scheduleNodes = mission.nodes.filter(isScheduleTriggerNode)
  const times = Array.from(
    new Set(
      scheduleNodes
        .map((node) => String(node.triggerTime || "").trim())
        .filter((value) => /^\d{2}:\d{2}$/.test(value)),
    ),
  ).sort((left, right) => left.localeCompare(right))
  const firstTriggerTimezone = scheduleNodes.find((node) => String(node.triggerTimezone || "").trim())?.triggerTimezone
  const timezone = resolveTimezone(firstTriggerTimezone, mission.settings?.timezone, getRuntimeTimezone())
  const description = String(mission.description || "").trim()
  return {
    id: mission.id,
    integration: String(mission.integration || "telegram").trim().toLowerCase() || "telegram",
    label: String(mission.label || "Untitled mission").trim() || "Untitled mission",
    message: description,
    description,
    priority: normalizePriority(undefined),
    time: times[0] || "09:00",
    times,
    timezone,
    enabled: mission.status === "active",
    chatIds: Array.isArray(mission.chatIds) ? mission.chatIds : [],
    updatedAt: String(mission.updatedAt || mission.createdAt || ""),
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
    void fetch("/api/missions?limit=500", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/chat")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const missions: unknown[] = Array.isArray(data?.missions) ? data.missions : []
        const schedules = missions
          .map((row: unknown) => toMissionRecord(row))
          .filter((row: NativeMission | null): row is NativeMission => row !== null)
          .map((row: NativeMission) => missionToNotificationSchedule(row))
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
    return [...notificationSchedules]
      .sort((left, right) => {
        const activeDelta = Number(right.enabled) - Number(left.enabled)
        if (activeDelta !== 0) return activeDelta
        const updatedDelta = (Date.parse(String(right.updatedAt || "")) || 0) - (Date.parse(String(left.updatedAt || "")) || 0)
        if (updatedDelta !== 0) return updatedDelta
        return String(left.label || "").localeCompare(String(right.label || ""))
      })
      .map((schedule) => ({
        id: schedule.id,
        integration: schedule.integration?.trim().toLowerCase() || "unknown",
        title: schedule.label?.trim() || "Untitled mission",
        description: String(schedule.description || schedule.message || "").trim(),
        priority: normalizePriority(schedule.priority),
        enabledCount: schedule.enabled ? 1 : 0,
        totalCount: 1,
        times: (Array.isArray(schedule.times) && schedule.times.length > 0 ? schedule.times : [schedule.time]).sort((a, b) => a.localeCompare(b)),
        timezone: resolveTimezone(schedule.timezone, getRuntimeTimezone()),
      }))
  }, [notificationSchedules])

  return {
    missions,
    notificationSchedules,
    refreshNotificationSchedules,
  }
}
