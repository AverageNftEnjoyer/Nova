export const PENDING_CHAT_SESSION_KEY = "nova_pending_chat_message"

export function normalizeHandoffOperationToken(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) return ""
  if (normalized.length > 160) return ""
  return normalized
}

export function generateHandoffOperationToken(): string {
  return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
