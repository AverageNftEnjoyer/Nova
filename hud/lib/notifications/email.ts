import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { sendGmailMessage } from "@/lib/integrations/gmail"

export interface EmailSendInput {
  text: string
  recipients?: string[]
  subject?: string
  accountId?: string
  threadId?: string
  inReplyTo?: string
  references?: string[]
  idempotencyKey?: string
  timeoutMs?: number
  signal?: AbortSignal
}

interface EmailSendResult {
  recipient: string
  ok: boolean
  status: number
  error?: string
}

function sanitizeRecipient(value: string): string {
  return String(value || "").trim().toLowerCase()
}

function resolveRecipients(config: Awaited<ReturnType<typeof loadIntegrationsConfig>>, recipients?: string[]): string[] {
  const fromInput = Array.isArray(recipients) ? recipients.map((value) => sanitizeRecipient(value)).filter(Boolean) : []
  if (fromInput.length > 0) return fromInput
  const fallback = String(config.gmail.email || "").trim().toLowerCase()
  return fallback ? [fallback] : []
}

export async function sendEmailMessage(input: EmailSendInput, scope?: IntegrationsStoreScope): Promise<EmailSendResult[]> {
  const config = await loadIntegrationsConfig(scope)
  if (!config.gmail.connected) {
    throw new Error("Email delivery is unavailable because Gmail integration is disabled.")
  }
  if (!String(input.text || "").trim()) {
    throw new Error("Notification text is required")
  }
  const recipients = resolveRecipients(config, input.recipients)
  if (recipients.length === 0) {
    throw new Error("Email delivery is unavailable because no recipient is configured.")
  }
  const subject = String(input.subject || "Nova Coinbase Report").trim() || "Nova Coinbase Report"

  const results = await Promise.all(recipients.map(async (recipient): Promise<EmailSendResult> => {
    try {
      await sendGmailMessage({
        to: recipient,
        subject,
        text: input.text,
        accountId: input.accountId,
        threadId: input.threadId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${recipient}` : undefined,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        scope,
      })
      return {
        recipient,
        ok: true,
        status: 200,
      }
    } catch (error) {
      return {
        recipient,
        ok: false,
        status: error instanceof Error && "status" in error && Number.isFinite(Number((error as { status?: number }).status))
          ? Number((error as { status?: number }).status)
          : 0,
        error: error instanceof Error ? error.message : "Unknown Gmail send error",
      }
    }
  }))
  return results
}
