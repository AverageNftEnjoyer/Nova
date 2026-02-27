import { assertGmailOk, gmailFetchWithRetry } from "./client.ts"
import { gmailError } from "./errors.ts"
import { getValidGmailAccessToken } from "./tokens.ts"
import { GMAIL_API_BASE, type GmailSendMessageInput, type GmailSendMessageResult } from "./types.ts"

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000
const completedIdempotency = new Map<string, { expiresAt: number; result: GmailSendMessageResult }>()
const inFlightByIdempotency = new Map<string, Promise<GmailSendMessageResult>>()

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function trimExpiredIdempotencyEntries(now = Date.now()): void {
  for (const [key, value] of completedIdempotency.entries()) {
    if (value.expiresAt <= now) completedIdempotency.delete(key)
  }
}

function normalizeHeaderValue(value: string): string {
  return String(value || "").replace(/\r?\n/g, " ").trim()
}

function buildRawMessage(input: GmailSendMessageInput): string {
  const headers = [
    `To: ${normalizeHeaderValue(input.to)}`,
    `Subject: ${normalizeHeaderValue(input.subject)}`,
    "Content-Type: text/plain; charset=utf-8",
  ]
  if (input.inReplyTo) headers.push(`In-Reply-To: ${normalizeHeaderValue(input.inReplyTo)}`)
  if (Array.isArray(input.references) && input.references.length > 0) {
    headers.push(`References: ${input.references.map((value) => normalizeHeaderValue(value)).filter(Boolean).join(" ")}`)
  }
  return [...headers, "", input.text].join("\r\n")
}

async function sendCore(input: GmailSendMessageInput): Promise<GmailSendMessageResult> {
  const to = String(input.to || "").trim().toLowerCase()
  if (!to) throw gmailError("gmail.no_recipients", "Missing recipient for Gmail send.", { status: 400 })
  const subject = String(input.subject || "").trim() || "Nova Mission Report"
  const text = String(input.text || "").trim()
  if (!text) throw gmailError("gmail.invalid_request", "Notification text is required.", { status: 400 })

  let token = await getValidGmailAccessToken(input.accountId, false, input.scope)
  const payload: Record<string, unknown> = {
    raw: toBase64Url(buildRawMessage({ ...input, to, subject, text })),
  }
  if (input.threadId) payload.threadId = String(input.threadId).trim()

  let response = await gmailFetchWithRetry(
    `${GMAIL_API_BASE}/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    {
      operation: "gmail_send_message",
      timeoutMs: input.timeoutMs ?? 12_000,
      signal: input.signal,
      maxAttempts: 3,
    },
  )
  if (response.status === 401 || response.status === 403) {
    token = await getValidGmailAccessToken(input.accountId, true, input.scope)
    response = await gmailFetchWithRetry(
      `${GMAIL_API_BASE}/users/me/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      {
        operation: "gmail_send_message_retry_auth",
        timeoutMs: input.timeoutMs ?? 12_000,
        signal: input.signal,
        maxAttempts: 2,
      },
    )
  }
  await assertGmailOk(response, "Failed to send Gmail message.")
  const data = await response.json().catch(() => ({})) as { id?: string; threadId?: string }
  const id = String(data.id || "").trim()
  if (!id) throw gmailError("gmail.internal", "Gmail send returned an empty message id.", { status: 502 })
  return {
    id,
    threadId: String(data.threadId || input.threadId || "").trim(),
    deduplicated: false,
  }
}

export async function sendGmailMessage(input: GmailSendMessageInput): Promise<GmailSendMessageResult> {
  const dedupeKey = String(input.idempotencyKey || "").trim()
  if (!dedupeKey) return sendCore(input)

  trimExpiredIdempotencyEntries()
  const cached = completedIdempotency.get(dedupeKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, deduplicated: true }
  }
  const inFlight = inFlightByIdempotency.get(dedupeKey)
  if (inFlight) return inFlight

  const pending = sendCore(input)
    .then((result) => {
      completedIdempotency.set(dedupeKey, {
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        result,
      })
      return result
    })
    .finally(() => {
      inFlightByIdempotency.delete(dedupeKey)
    })
  inFlightByIdempotency.set(dedupeKey, pending)
  return pending
}
