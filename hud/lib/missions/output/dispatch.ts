/**
 * Output Dispatch
 *
 * Functions for sending mission output to various channels.
 */

import "server-only"

import { createHash } from "node:crypto"

import { dispatchNotification, type NotificationIntegration } from "@/lib/notifications/dispatcher"
import type { NotificationSchedule } from "@/lib/notifications/store"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { resolveTimezone } from "@/lib/shared/timezone"
import { fetchWithSsrfGuard } from "../web/safe-fetch"
import type { OutputResult } from "../types/index"
import { enforceMissionOutputContract } from "./contract"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const WEBHOOK_TIMEOUT_MS = readIntEnv("NOVA_WORKFLOW_WEBHOOK_TIMEOUT_MS", 15_000, 1_000, 120_000)
const WEBHOOK_MAX_REDIRECTS = readIntEnv("NOVA_WORKFLOW_WEBHOOK_MAX_REDIRECTS", 0, 0, 5)
const EMAIL_TIMEOUT_MS = readIntEnv("NOVA_WORKFLOW_EMAIL_TIMEOUT_MS", 12_000, 1_000, 120_000)
const GCALENDAR_MIRROR_EVENT_DURATION_MS = readIntEnv("NOVA_GCAL_MIRROR_EVENT_DURATION_MS", 30 * 60 * 1000, 5 * 60 * 1000, 8 * 60 * 60 * 1000)
const GCALENDAR_MIRROR_MAX_DESCRIPTION_CHARS = readIntEnv("NOVA_GCAL_MIRROR_MAX_DESCRIPTION_CHARS", 3200, 200, 7000)

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function buildStableCalendarMirrorEventId(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex")
  // Google Calendar event IDs must be base32hex-safe (a-v, 0-9).
  return `nova${digest.slice(0, 56)}`
}

async function mirrorMissionOutputToGoogleCalendar(params: {
  channel: string
  text: string
  userContextId: string
  schedule: NotificationSchedule
  scope?: IntegrationsStoreScope
  metadata?: {
    missionRunId?: string
    runKey?: string
    attempt?: number
    source?: "scheduler" | "trigger"
    nodeId?: string
    outputIndex?: number
    deliveryKey?: string
    occurredAt?: string
  }
}): Promise<void> {
  const { channel, text, userContextId, schedule, scope, metadata } = params
  if (!scope || !userContextId) return

  let config
  try {
    config = await loadIntegrationsConfig(scope)
  } catch (err) {
    console.warn("[dispatchOutput][gcalendar_mirror] Failed to load integrations config:", err instanceof Error ? err.message : String(err))
    return
  }

  if (!config.gcalendar.connected) return
  if (!config.gcalendar.permissions?.allowCreate) return

  const accountId = String(config.gcalendar.activeAccountId || "").trim().toLowerCase()
  const selectedAccount = config.gcalendar.accounts.find((account) => account.id === accountId && account.enabled)
    || config.gcalendar.accounts.find((account) => account.enabled)
  if (!selectedAccount?.id) return

  const occurredAtRaw = String(metadata?.occurredAt || "").trim()
  const startAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date()
  if (Number.isNaN(startAt.getTime())) return
  const endAt = new Date(startAt.getTime() + GCALENDAR_MIRROR_EVENT_DURATION_MS)

  const summary = String(schedule.label || "").trim() || "Nova Automation"
  const lines = [
    `Mission output channel: ${channel}`,
    `Mission id: ${String(schedule.id || "").trim() || "unknown"}`,
    "",
    text.trim(),
  ]
  const description = truncateText(lines.join("\n"), GCALENDAR_MIRROR_MAX_DESCRIPTION_CHARS)

  const dedupeSeed = [
    userContextId,
    String(schedule.id || "").trim(),
    String(metadata?.missionRunId || "").trim(),
    String(metadata?.runKey || "").trim(),
    String(metadata?.nodeId || "").trim(),
    String(metadata?.outputIndex ?? 0),
    channel,
    startAt.toISOString(),
  ].join("|")

  let createCalendarEventFn: ((event: {
    summary: string
    description?: string
    startAt: Date
    endAt: Date
    timeZone?: string
    eventId?: string
  }, options?: {
    accountId?: string
    calendarId?: string
    scope?: IntegrationsStoreScope
  }) => Promise<unknown>) | null = null
  try {
    const mod = await import("../../integrations/google-calendar/service")
    if (typeof mod.createCalendarEvent === "function") {
      createCalendarEventFn = mod.createCalendarEvent
    }
  } catch {
    return
  }
  if (!createCalendarEventFn) return

  await createCalendarEventFn(
    {
      summary,
      description,
      startAt,
      endAt,
      timeZone: resolveTimezone(schedule.timezone),
      eventId: buildStableCalendarMirrorEventId(dedupeSeed),
    },
    {
      accountId: selectedAccount.id,
      scope,
    },
  )
}

/**
 * Dispatch mission output to a channel.
 */
export async function dispatchOutput(
  channel: string,
  text: string,
  targets: string[] | undefined,
  schedule: NotificationSchedule,
  scope?: IntegrationsStoreScope,
  metadata?: {
    missionRunId?: string
    runKey?: string
    attempt?: number
    source?: "scheduler" | "trigger"
    nodeId?: string
    outputIndex?: number
    deliveryKey?: string
    occurredAt?: string
  },
): Promise<OutputResult[]> {
  const userContextId = String(scope?.userId || scope?.user?.id || schedule.userId || "").trim()
  const contracted = enforceMissionOutputContract({
    channel,
    text,
    userContextId,
    missionId: String(schedule.id || "").trim(),
    missionRunId: String(metadata?.missionRunId || "").trim(),
    nodeId: String(metadata?.nodeId || "").trim(),
  })
  const safeText = contracted.text

  if (channel === "discord" || channel === "telegram" || channel === "email") {
    try {
      const missionRunId = String(metadata?.missionRunId || "").trim()
      const runKey = String(metadata?.runKey || "").trim()
      const nodeId = String(metadata?.nodeId || "output").trim() || "output"
      const outputIndex = Number.isFinite(Number(metadata?.outputIndex))
        ? Math.max(0, Number(metadata?.outputIndex))
        : 0
      const deliveryKey = String(metadata?.deliveryKey || "").trim()
        || `${String(schedule.id || "mission").trim()}:${missionRunId || runKey || "run"}:${nodeId}:${outputIndex}:${channel}`
      const channelResults = await dispatchNotification({
        integration: channel as NotificationIntegration,
        text: safeText,
        targets,
        idempotencyKey: deliveryKey,
        timeoutMs: channel === "email" ? EMAIL_TIMEOUT_MS : undefined,
        parseMode: channel === "telegram" ? "HTML" : undefined,
        source: "workflow",
        scheduleId: schedule.id,
        label: schedule.label,
        scope,
      })
      if (channelResults.some((result) => result.ok)) {
        try {
          await mirrorMissionOutputToGoogleCalendar({
            channel,
            text: safeText,
            userContextId,
            schedule,
            scope,
            metadata,
          })
        } catch (error) {
          console.warn("[dispatchOutput][gcalendar_mirror] Mirror failed:", error instanceof Error ? error.message : String(error))
        }
      }
      return channelResults
    } catch (error) {
      return [{
        ok: false,
        error: `channel_unavailable:${channel}:${error instanceof Error ? error.message : "unknown_error"}`,
      }]
    }
  }

  if (channel === "webhook") {
    const urls = (targets || []).map((t) => String(t || "").trim()).filter(Boolean)
    if (!urls.length) {
      return [{ ok: false, error: "Webhook output requires at least one URL in recipients." }]
    }
    const results = await Promise.all(urls.map(async (url) => {
      try {
        const { response } = await fetchWithSsrfGuard({
          url,
          timeoutMs: WEBHOOK_TIMEOUT_MS,
          maxRedirects: WEBHOOK_MAX_REDIRECTS,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: safeText,
              scheduleId: schedule.id,
              label: schedule.label,
              ts: new Date().toISOString(),
            }),
          },
        })
        return { ok: response.ok, status: response.status, error: response.ok ? undefined : `Webhook returned ${response.status}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Webhook send failed" }
      }
    }))
    if (results.some((result) => result.ok)) {
      try {
        await mirrorMissionOutputToGoogleCalendar({
          channel,
          text: safeText,
          userContextId,
          schedule,
          scope,
          metadata,
        })
      } catch (error) {
        console.warn("[dispatchOutput][gcalendar_mirror] Mirror failed:", error instanceof Error ? error.message : String(error))
      }
    }
    return results
  }

  if (channel === "slack") {
    const urls = (targets || []).map((t) => String(t || "").trim()).filter(Boolean)
    if (!urls.length) {
      return [{ ok: false, error: "Slack output requires at least one webhook URL in recipients." }]
    }
    const missionRunId = String(metadata?.missionRunId || "").trim()
    const runKey = String(metadata?.runKey || "").trim()
    const nodeId = String(metadata?.nodeId || "output").trim() || "output"
    const outputIndex = Number.isFinite(Number(metadata?.outputIndex))
      ? Math.max(0, Number(metadata?.outputIndex))
      : 0
    const deliveryKey = String(metadata?.deliveryKey || "").trim()
      || `${String(schedule.id || "mission").trim()}:${missionRunId || runKey || "run"}:${nodeId}:${outputIndex}:${channel}`
    const results = await Promise.all(urls.map(async (url) => {
      try {
        const { response } = await fetchWithSsrfGuard({
          url,
          timeoutMs: WEBHOOK_TIMEOUT_MS,
          maxRedirects: WEBHOOK_MAX_REDIRECTS,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Mission-Delivery-Key": deliveryKey },
            body: JSON.stringify({
              text: safeText,
              scheduleId: schedule.id,
              label: schedule.label,
              ts: new Date().toISOString(),
            }),
          },
        })
        return { ok: response.ok, status: response.status, error: response.ok ? undefined : `Slack webhook returned ${response.status}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Slack webhook send failed" }
      }
    }))
    if (results.some((result) => result.ok)) {
      try {
        await mirrorMissionOutputToGoogleCalendar({
          channel,
          text: safeText,
          userContextId,
          schedule,
          scope,
          metadata,
        })
      } catch (error) {
        console.warn("[dispatchOutput][gcalendar_mirror] Mirror failed:", error instanceof Error ? error.message : String(error))
      }
    }
    return results
  }

  return [{ ok: false, error: `Unsupported output channel: ${channel}` }]
}
