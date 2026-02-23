import { MISSION_TELEMETRY_POLICY } from "./config"

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const BEARER_REGEX = /\bbearer\s+[a-z0-9._-]+\b/i
const URL_CREDENTIAL_REGEX = /https?:\/\/[^/\s:@]+:[^@\s]+@/i
const CREDENTIAL_PARAM_REGEX = /(?:api[_-]?key|token|secret|password|passphrase)=([^&\s]+)/i
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/
const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]*PRIVATE KEY-----/i
const SECRET_PREFIX_REGEX = /\b(sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z\-_]{20,})\b/
const SENSITIVE_KEY_REGEX = /(token|secret|password|passphrase|api[_-]?key|authorization|cookie|session|credential|webhook)/i

function sanitizeString(value: string): string {
  let text = String(value || "")
  if (text.length > MISSION_TELEMETRY_POLICY.maxStringLength) {
    text = `${text.slice(0, MISSION_TELEMETRY_POLICY.maxStringLength)}...`
  }
  if (EMAIL_REGEX.test(text)) return "[redacted:email]"
  if (BEARER_REGEX.test(text)) return "[redacted:token]"
  if (URL_CREDENTIAL_REGEX.test(text)) return "[redacted:url-credentials]"
  if (CREDENTIAL_PARAM_REGEX.test(text)) return "[redacted:credential-param]"
  if (JWT_REGEX.test(text)) return "[redacted:jwt]"
  if (PRIVATE_KEY_REGEX.test(text)) return "[redacted:private-key]"
  if (SECRET_PREFIX_REGEX.test(text)) return "[redacted:secret]"
  return text
}

function sanitizeRecursive(value: unknown, depth: number): unknown {
  if (depth <= 0) return "[truncated]"
  if (typeof value === "string") return sanitizeString(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeRecursive(item, depth - 1))
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = String(key).slice(0, 128)
      if (SENSITIVE_KEY_REGEX.test(normalizedKey)) {
        out[normalizedKey] = "[redacted:sensitive-key]"
        continue
      }
      out[normalizedKey] = sanitizeRecursive(item, depth - 1)
    }
    return out
  }
  return String(value)
}

export function sanitizeMissionTelemetryMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeRecursive(value, MISSION_TELEMETRY_POLICY.maxMetadataDepth)
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {}
  return sanitized as Record<string, unknown>
}
