/**
 * Output Dispatch
 *
 * Functions for sending mission output to various channels.
 */

import { dispatchNotification, type NotificationIntegration } from "@/lib/notifications/dispatcher"
import type { NotificationSchedule } from "@/lib/notifications/store"
import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { addPendingMessage } from "@/lib/novachat/pending-messages"
import { formatNotificationText } from "../text/formatting"
import type { OutputResult } from "../types"

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
  },
): Promise<OutputResult[]> {
  if (channel === "discord" || channel === "telegram" || channel === "email") {
    const formattedText = formatNotificationText(text)
    try {
      return await dispatchNotification({
        integration: channel as NotificationIntegration,
        text: formattedText,
        targets,
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
      await addPendingMessage({
        userId,
        title: schedule.label || "Mission Report",
        content: text,
        missionId: schedule.id,
        missionLabel: schedule.label,
        metadata: {
          missionRunId: metadata?.missionRunId,
          runKey: metadata?.runKey,
          attempt: metadata?.attempt,
          source: metadata?.source,
          outputChannel: "novachat",
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
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            scheduleId: schedule.id,
            label: schedule.label,
            ts: new Date().toISOString(),
          }),
        })
        return { ok: res.ok, status: res.status, error: res.ok ? undefined : `Webhook returned ${res.status}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Webhook send failed" }
      }
    }))
    return results
  }

  return [{ ok: false, error: `Unsupported output channel: ${channel}` }]
}
