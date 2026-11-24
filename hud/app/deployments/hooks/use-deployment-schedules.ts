"use client"

import { useCallback, useEffect, useState } from "react"

import type { CalendarEvent } from "@/lib/calendar/types"
import type { Mission, MissionNode } from "@/lib/missions/types"

/** How far ahead the next scheduled run is looked up (the calendar API allows up to 90 days). */
const LOOKAHEAD_DAYS = 30

export interface DeploymentSchedules {
  /** Mission definitions by id (an automation deployment's `missionId`). */
  missions: Map<string, Mission>
  /** Next scheduled start (ISO) per mission id, from the calendar aggregator. */
  nextRunAt: Map<string, string>
  loading: boolean
  refresh: () => Promise<void>
  /** Saves the mission with a new status (pausing or resuming its schedule). */
  setMissionStatus: (mission: Mission, status: Mission["status"]) => Promise<{ ok: true } | { ok: false; error: string }>
}

const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }

function clockLabel(time: string | undefined): string {
  const match = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null
  if (!match) return ""
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function intervalLabel(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "On an interval"
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`
  return `Every ${minutes} min`
}

function triggerLabel(node: MissionNode): string | null {
  switch (node.type) {
    case "schedule-trigger": {
      const at = clockLabel(node.triggerTime)
      const suffix = at ? ` at ${at}` : ""
      if (node.triggerMode === "interval") return intervalLabel(node.triggerIntervalMinutes)
      if (node.triggerMode === "once") return `Once${suffix}`
      if (node.triggerMode === "weekly") {
        const keys = new Set((node.triggerDays ?? []).map((day) => day.toLowerCase()))
        const weekdays = ["mon", "tue", "wed", "thu", "fri"].every((day) => keys.has(day))
        if (keys.size === 7) return `Daily${suffix}`
        if (keys.size === 5 && weekdays) return `Weekdays${suffix}`
        const days = (node.triggerDays ?? []).map((day) => DAY_LABEL[day.toLowerCase()] ?? day)
        return `${days.length > 0 ? days.join(", ") : "Weekly"}${suffix}`
      }
      return `Daily${suffix}`
    }
    case "webhook-trigger":
      return "On webhook"
    case "event-trigger":
      return node.eventName ? `On event ${node.eventName}` : "On an event"
    case "polymarket-price-trigger":
      return "On market price"
    case "manual-trigger":
      return "Manual"
    default:
      return null
  }
}

/** Human-readable trigger of an automation ("Daily at 8:00 AM", "Mon, Wed at 9:00 AM", "On webhook"). */
export function missionScheduleLabel(mission: Mission | undefined): string {
  if (!mission) return "Manual"
  const labels = mission.nodes.filter((node) => !node.disabled).map(triggerLabel).filter((label): label is string => Boolean(label))
  return labels.length > 0 ? labels.join("; ") : "Manual"
}

/** Mission definitions and next scheduled starts behind automation deployments. */
export function useDeploymentSchedules(): DeploymentSchedules {
  const [missions, setMissions] = useState<Map<string, Mission>>(new Map())
  const [nextRunAt, setNextRunAt] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const start = new Date()
    const end = new Date(start.getTime() + LOOKAHEAD_DAYS * 86_400_000)
    const [missionsResult, eventsResult] = await Promise.allSettled([
      fetch("/api/missions", { cache: "no-store" }).then((response) => response.json() as Promise<{ missions?: Mission[] }>),
      fetch(`/api/calendar/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, {
        cache: "no-store",
      }).then((response) => response.json() as Promise<{ events?: CalendarEvent[] }>),
    ])
    if (missionsResult.status === "fulfilled" && Array.isArray(missionsResult.value.missions)) {
      setMissions(new Map(missionsResult.value.missions.map((mission) => [mission.id, mission])))
    }
    if (eventsResult.status === "fulfilled" && Array.isArray(eventsResult.value.events)) {
      const next = new Map<string, string>()
      const nowMs = start.getTime()
      for (const event of eventsResult.value.events) {
        if (event.kind !== "mission" || event.status !== "scheduled" || Date.parse(event.startAt) < nowMs) continue
        const current = next.get(event.missionId)
        if (!current || event.startAt < current) next.set(event.missionId, event.startAt)
      }
      setNextRunAt(next)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const setMissionStatus = useCallback(
    async (mission: Mission, status: Mission["status"]) => {
      try {
        const response = await fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mission: { ...mission, status } }),
        })
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!response.ok || !data.ok) throw new Error(data.error || "The automation schedule could not be updated.")
        await refresh()
        return { ok: true as const }
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The automation schedule could not be updated." }
      }
    },
    [refresh],
  )

  return { missions, nextRunAt, loading, refresh, setMissionStatus }
}
