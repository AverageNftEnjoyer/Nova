/**
 * Output Dispatch
 *
 * Functions for sending mission output to various channels.
 */

import { dispatchNotification, type NotificationIntegration } from "@/lib/notifications/dispatcher"
import type { NotificationSchedule } from "@/lib/notifications/store"
import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { addPendingMessage } from "@/lib/novachat/pending-messages"
import { fetchWithSsrfGuard } from "../web/safe-fetch"
import type { OutputResult } from "../types"
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
      return await dispatchNotification({
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
    } catch (error) {
      return [{
        ok: false,
        error: `channel_unavailable:${channel}:${error instanceof Error ? error.message : "unknown_error"}`,
      }]
    }
  }

  if (channel === "novachat") {
    // NovaChat: Store the message for the chat UI to pick up
    const userId = String(schedule.userId || "").trim()
    if (!userId) {
      return [{ ok: false, error: "NovaChat output requires a user ID." }]
    }
    try {
      const missionRunId = String(metadata?.missionRunId || "").trim()
      const runKey = String(metadata?.runKey || "").trim()
      const nodeId = String(metadata?.nodeId || "output").trim() || "output"
      const outputIndex = Number.isFinite(Number(metadata?.outputIndex))
        ? Math.max(0, Number(metadata?.outputIndex))
        : 0
      const deliveryKey = String(metadata?.deliveryKey || "").trim()
        || `${String(schedule.id || "mission").trim()}:${missionRunId || runKey || "run"}:${nodeId}:${outputIndex}:${channel}`
      await addPendingMessage({
        userId,
        title: schedule.label || "Mission Report",
        content: safeText,
        missionId: schedule.id,
        missionLabel: schedule.label,
        metadata: {
          missionRunId: missionRunId || undefined,
          runKey: runKey || undefined,
          attempt: metadata?.attempt,
          source: metadata?.source,
          outputChannel: "novachat",
          deliveryKey,
        },
      })
      return [{ ok: true }]
    } catch (error) {
      return [{ ok: false, error: error instanceof Error ? error.message : "Failed to queue NovaChat message" }]
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
    return results
  }

  return [{ ok: false, error: `Unsupported output channel: ${channel}` }]
}
