export interface GmailSummaryEmail {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface GmailSummaryApiResponse {
  ok: boolean
  summary?: string
  emails?: GmailSummaryEmail[]
  error?: string
}

type CommunicationStyle = "formal" | "casual" | "friendly" | "professional" | string
type ResponseTone = "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed" | string

const EMAIL_INTENT_RE =
  /\b(email|e-mail|gmail|inbox|messages?)\b/i
const EMAIL_ACTION_RE =
  /\b(check|scan|summarize|summary|show|read|what(?:'s| is)?|any|urgent|important|latest|recent)\b/i
const EMAIL_EXCLUSION_RE =
  /\b(mission|workflow|automation|schedule|scheduled|remind|reminder)\b/i

export function isEmailAssistantIntent(prompt: string): boolean {
  const text = String(prompt || "").trim()
  if (!text) return false
  if (EMAIL_EXCLUSION_RE.test(text) && /\b(send|deliver|report)\b/i.test(text)) return false
  return EMAIL_INTENT_RE.test(text) && EMAIL_ACTION_RE.test(text)
}

export function extractEmailSummaryMaxResults(prompt: string, fallback = 6): number {
  const text = String(prompt || "")
  const direct = text.match(/\b(?:last|recent|latest|top)\s+(\d{1,2})\b/i)
  const parsed = Number(direct?.[1] || "")
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(25, Math.floor(parsed)))
  return Math.max(1, Math.min(25, Math.floor(fallback)))
}

function firstNameOrFallback(nickname: string): string {
  const normalized = String(nickname || "").trim()
  if (!normalized) return "you"
  return normalized.split(/\s+/g)[0] || "you"
}

export function buildEmailAssistantReply(input: {
  prompt: string
  nickname?: string
  assistantName?: string
  communicationStyle?: CommunicationStyle
  tone?: ResponseTone
  characteristics?: string
  customInstructions?: string
  summary: string
  emails: GmailSummaryEmail[]
}): string {
  const name = firstNameOrFallback(input.nickname || "")
  const style = String(input.communicationStyle || "").toLowerCase()
  const tone = String(input.tone || "").toLowerCase()
  const personaText = `${String(input.characteristics || "")} ${String(input.customInstructions || "")}`.toLowerCase()
  const sarcastic = /\b(sarcas|sarcastic|snark|snarky|dry humor|dry-humor)\b/.test(personaText)
  const quippy = sarcastic || style === "casual" || style === "friendly" || tone === "relaxed" || tone === "enthusiastic"
  const direct = style === "professional" || style === "formal" || tone === "direct"
  const emails = Array.isArray(input.emails) ? input.emails : []
  if (emails.length === 0) {
    if (quippy) return `${name}, inbox sweep complete. Absolutely nothing dramatic right now.`
    return `${name}, I checked your inbox and there are no recent emails right now.`
  }
  const preview = emails
    .slice(0, 3)
    .map((email, idx) => `${idx + 1}. ${email.subject || "(No subject)"} — ${email.from || "Unknown sender"}`)
    .join("\n")
  const summary = String(input.summary || "").trim() || "I reviewed your recent emails and grouped what needs attention first."
  if (direct) return `${name}, inbox update:\n${summary}\n\nTop emails:\n${preview}`
  if (quippy) return `${name}, I did an inbox pass.\n\n${summary}\n\nTop emails worth your attention:\n${preview}`
  return `${name}, I checked your inbox.\n\n${summary}\n\nTop emails:\n${preview}`
}

export function buildEmailAssistantFailureReply(input: {
  nickname?: string
  communicationStyle?: CommunicationStyle
  tone?: ResponseTone
  characteristics?: string
  customInstructions?: string
  reason: "unauthorized" | "temporary"
}): string {
  const name = firstNameOrFallback(input.nickname || "")
  const style = String(input.communicationStyle || "").toLowerCase()
  const tone = String(input.tone || "").toLowerCase()
  const personaText = `${String(input.characteristics || "")} ${String(input.customInstructions || "")}`.toLowerCase()
  const sarcastic = /\b(sarcas|sarcastic|snark|snarky|dry humor|dry-humor)\b/.test(personaText)
  const quippy = sarcastic || style === "casual" || style === "friendly" || tone === "relaxed" || tone === "enthusiastic"
  if (input.reason === "unauthorized") {
    if (quippy) return `${name}, I’m locked out of inbox access right now. Reconnect Gmail in Integrations and I’ll jump back in.`
    return `${name}, I need your Nova session re-authenticated before I can read your inbox. Open Integrations and reconnect Gmail once.`
  }
  if (quippy) return `${name}, inbox check hit turbulence. Give me a second and try again.`
  return `${name}, I could not read your inbox right now. Try again in a moment.`
}
