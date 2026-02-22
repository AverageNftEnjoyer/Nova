import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { getValidGmailAccessToken } from "@/lib/integrations/gmail"

export interface EmailSendInput {
  text: string
  recipients?: string[]
  subject?: string
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

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function buildRawMessage(params: { to: string; subject: string; text: string }): string {
  return [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    params.text,
  ].join("\r\n")
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
  const accessToken = await getValidGmailAccessToken(undefined, false, scope)
  const subject = String(input.subject || "Nova Coinbase Report").trim() || "Nova Coinbase Report"

  const results = await Promise.all(recipients.map(async (recipient): Promise<EmailSendResult> => {
    try {
      const raw = buildRawMessage({ to: recipient, subject, text: input.text })
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: toBase64Url(raw) }),
        cache: "no-store",
      })
      const payload = await response.json().catch(() => ({}))
      return {
        recipient,
        ok: response.ok,
        status: response.status,
        error: response.ok ? undefined : String((payload as { error?: { message?: string } })?.error?.message || `gmail-send-${response.status}`),
      }
    } catch (error) {
      return {
        recipient,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : "Unknown Gmail send error",
      }
    }
  }))
  return results
}
