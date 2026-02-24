import { assertGmailOk, gmailFetchWithRetry } from "./client"
import { getValidGmailAccessToken } from "./tokens"
import { GMAIL_API_BASE, type GmailMessageSummary, type GmailScope } from "./types"

function decodeBodyData(data: string | undefined): string {
  const raw = String(data || "")
  if (!raw) return ""
  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  } catch {
    return ""
  }
}

function pickHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  if (!Array.isArray(headers)) return ""
  const hit = headers.find((h) => String(h?.name || "").toLowerCase() === name.toLowerCase())
  return String(hit?.value || "").trim()
}

function extractPlainText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return ""
  const mimeType = String(payload.mimeType || "")
  const body = payload.body as { data?: string } | undefined
  if (mimeType === "text/plain") return decodeBodyData(body?.data)
  if (mimeType === "text/html") {
    const html = decodeBodyData(body?.data)
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  }
  const parts = Array.isArray(payload.parts) ? (payload.parts as Array<Record<string, unknown>>) : []
  for (const part of parts) {
    const text = extractPlainText(part)
    if (text) return text
  }
  return ""
}

export async function listRecentGmailMessages(
  maxResults = 10,
  accountId?: string,
  scope?: GmailScope,
): Promise<GmailMessageSummary[]> {
  let token = await getValidGmailAccessToken(accountId, false, scope)
  const listParams = new URLSearchParams({
    maxResults: String(Math.max(1, Math.min(25, maxResults))),
    q: "in:inbox -category:promotions",
  })
  let listRes = await gmailFetchWithRetry(
    `${GMAIL_API_BASE}/users/me/messages?${listParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { operation: "gmail_list_messages", timeoutMs: 12_000, maxAttempts: 3 },
  )
  if (listRes.status === 401 || listRes.status === 403) {
    token = await getValidGmailAccessToken(accountId, true, scope)
    listRes = await gmailFetchWithRetry(
      `${GMAIL_API_BASE}/users/me/messages?${listParams.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { operation: "gmail_list_messages_retry_auth", timeoutMs: 12_000, maxAttempts: 2 },
    )
  }
  await assertGmailOk(listRes, "Failed to list Gmail messages.")
  const listData = await listRes.json().catch(() => null)
  const rawMessages = Array.isArray((listData as { messages?: Array<{ id?: string; threadId?: string }> })?.messages)
    ? (listData as { messages: Array<{ id?: string; threadId?: string }> }).messages
    : []

  const details = await Promise.all(rawMessages.map(async (message) => {
    const id = String(message.id || "").trim()
    if (!id) return null
    const detailRes = await gmailFetchWithRetry(
      `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } },
      { operation: "gmail_read_message", timeoutMs: 12_000, maxAttempts: 3 },
    )
    if (!detailRes.ok) return null
    const detailData = await detailRes.json().catch(() => null)
    if (!detailData || typeof detailData !== "object") return null
    const payload = (detailData as { payload?: Record<string, unknown> }).payload
    const headers = Array.isArray(payload?.headers)
      ? (payload!.headers as Array<{ name?: string; value?: string }>)
      : []
    const subject = pickHeader(headers, "subject")
    const from = pickHeader(headers, "from")
    const date = pickHeader(headers, "date")
    const snippet = String((detailData as { snippet?: string }).snippet || "").trim()
    const plain = extractPlainText(payload)
    return {
      id,
      threadId: String((detailData as { threadId?: string }).threadId || message.threadId || ""),
      from,
      subject,
      date,
      snippet: (snippet || plain || "").slice(0, 500),
    } satisfies GmailMessageSummary
  }))

  return details.filter((item): item is GmailMessageSummary => Boolean(item))
}
