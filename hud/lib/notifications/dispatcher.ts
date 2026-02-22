import "server-only"

import { type IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { sendDiscordMessage } from "@/lib/notifications/discord"
import { sendEmailMessage } from "@/lib/notifications/email"
import { sendTelegramMessage } from "@/lib/notifications/telegram"

export type NotificationIntegration = "telegram" | "discord" | "email"

export interface DispatchNotificationInput {
  integration: NotificationIntegration
  text: string
  targets?: string[]
  parseMode?: "Markdown" | "MarkdownV2" | "HTML"
  disableNotification?: boolean
  source?: string
  scheduleId?: string
  label?: string
  scope?: IntegrationsStoreScope
}

export async function dispatchNotification(
  input: DispatchNotificationInput,
): Promise<Array<{ ok: boolean; error?: string; status?: number }>> {
  if (input.integration === "discord") {
    return sendDiscordMessage({
      text: input.text,
      webhookUrls: input.targets,
    }, input.scope)
  }

  if (input.integration === "telegram") {
    return sendTelegramMessage({
      text: input.text,
      chatIds: input.targets,
      parseMode: input.parseMode,
      disableNotification: input.disableNotification,
    }, input.scope)
  }

  if (input.integration === "email") {
    return sendEmailMessage({
      text: input.text,
      recipients: input.targets,
      subject: input.label ? `Nova Mission: ${input.label}` : "Nova Mission Report",
    }, input.scope)
  }

  throw new Error(`Unsupported integration: ${input.integration}`)
}
