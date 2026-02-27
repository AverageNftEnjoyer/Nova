/**
 * Mission Output Contract
 *
 * Enforces safe, bounded, human-readable output for user notification channels.
 */

import { formatNotificationText } from "../text/formatting"
import { formatStructuredMissionOutput, humanizeMissionOutputText } from "./formatters"

const CHANNEL_MAX_CHARS: Record<string, number> = {
  telegram: 3600,
  discord: 3500,
  email: 5000,
  telegram: 6000,
  webhook: 3500,
  slack: 3500,
}

const GENERIC_MAX_CHARS = 3500
const TRUNCATION_MARKER = "\n\n[Message truncated for channel safety]"

function resolveChannelMaxChars(channel: string): number {
  const key = String(channel || "").trim().toLowerCase()
  return CHANNEL_MAX_CHARS[key] || GENERIC_MAX_CHARS
}

function truncateWithMarker(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = String(text || "").trim()
  if (!normalized) return { text: "", truncated: false }
  if (normalized.length <= maxChars) return { text: normalized, truncated: false }
  const hardCap = Math.max(64, maxChars - TRUNCATION_MARKER.length)
  const clipped = normalized.slice(0, hardCap).trimEnd()
  return {
    text: `${clipped}${TRUNCATION_MARKER}`,
    truncated: true,
  }
}

function tryParseJsonContainer(raw: string): unknown | null {
  const text = String(raw || "").trim()
  if (!text) return null
  if (!(text.startsWith("{") || text.startsWith("["))) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isRawJsonLikeText(value: string): boolean {
  const text = String(value || "").trim()
  if (!text) return false
  if (!(text.startsWith("{") || text.startsWith("["))) return false
  return tryParseJsonContainer(text) !== null
}

function buildSafeFallbackSummary(channel: string): string {
  return [
    "Mission update ready.",
    "Some structured data was suppressed for safety.",
    `Channel: ${String(channel || "unknown").trim().toLowerCase() || "unknown"}.`,
  ].join("\n")
}

function stripInternalDiagnostics(text: string): { text: string; removed: boolean } {
  const lines = String(text || "").split(/\r?\n/)
  const blockedPattern =
    /\b(coinbase private account data|requires connected api key|unauthorized|auth=|errorcode|stack trace|traceback|internal error|jwt_bearer|cb_step_|debug)\b/i
  const filtered = lines.filter((line) => !blockedPattern.test(String(line || "")))
  const normalized = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return {
    text: normalized,
    removed: filtered.length !== lines.length,
  }
}

function logGuardWarning(input: {
  reason: string
  channel: string
  userContextId?: string
  missionId?: string
  missionRunId?: string
  nodeId?: string
}): void {
  const payload = {
    event: "mission.output.guard.violation",
    reason: input.reason,
    channel: String(input.channel || "").trim().toLowerCase() || "unknown",
    userContextId: String(input.userContextId || "").trim() || "unknown",
    missionId: String(input.missionId || "").trim() || "unknown",
    missionRunId: String(input.missionRunId || "").trim() || "unknown",
    nodeId: String(input.nodeId || "").trim() || "unknown",
    ts: new Date().toISOString(),
  }
  console.warn("[MissionOutputGuard]", JSON.stringify(payload))
}

export interface EnforceMissionOutputContractInput {
  channel: string
  text: string
  userContextId?: string
  missionId?: string
  missionRunId?: string
  nodeId?: string
}

export interface EnforceMissionOutputContractResult {
  text: string
  truncated: boolean
  guardTriggered: boolean
  violations: string[]
}

export function enforceMissionOutputContract(
  input: EnforceMissionOutputContractInput,
): EnforceMissionOutputContractResult {
  const channel = String(input.channel || "").trim().toLowerCase() || "unknown"
  const violations: string[] = []
  let guardTriggered = false
  let candidate = String(input.text || "").trim()

  const parsedContainer = tryParseJsonContainer(candidate)
  if (parsedContainer !== null) {
    violations.push("raw_json_payload")
    guardTriggered = true
    const structured = formatStructuredMissionOutput(candidate)
    candidate = structured && !isRawJsonLikeText(structured)
      ? structured
      : buildSafeFallbackSummary(channel)
  }

  candidate = humanizeMissionOutputText(candidate, undefined, { includeSources: true, detailLevel: "standard" })
  if (channel === "telegram" || channel === "discord" || channel === "email" || channel === "slack") {
    candidate = formatNotificationText(candidate)
  }

  if (!candidate.trim()) {
    violations.push("empty_payload")
    guardTriggered = true
    candidate = buildSafeFallbackSummary(channel)
  }

  if (isRawJsonLikeText(candidate)) {
    violations.push("json_after_formatting")
    guardTriggered = true
    const asStructured = formatStructuredMissionOutput(candidate)
    candidate = !isRawJsonLikeText(asStructured) ? asStructured : buildSafeFallbackSummary(channel)
  }

  const diagnosticsStripped = stripInternalDiagnostics(candidate)
  if (diagnosticsStripped.removed) {
    violations.push("internal_diagnostics_stripped")
    guardTriggered = true
  }
  candidate = diagnosticsStripped.text
  if (!candidate.trim()) {
    violations.push("empty_after_diagnostics_strip")
    guardTriggered = true
    candidate = buildSafeFallbackSummary(channel)
  }

  const bounded = truncateWithMarker(candidate, resolveChannelMaxChars(channel))
  if (bounded.truncated) {
    violations.push("length_truncated")
    guardTriggered = true
  }

  if (guardTriggered) {
    logGuardWarning({
      reason: violations.join(","),
      channel,
      userContextId: input.userContextId,
      missionId: input.missionId,
      missionRunId: input.missionRunId,
      nodeId: input.nodeId,
    })
  }

  return {
    text: bounded.text,
    truncated: bounded.truncated,
    guardTriggered,
    violations,
  }
}

export function formatCoinbasePriceAlertTextFromObject(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const asText = formatStructuredMissionOutput(JSON.stringify(payload))
  if (!asText || isRawJsonLikeText(asText)) return null
  return asText
}

export function looksLikeRawJsonMessage(text: string): boolean {
  return isRawJsonLikeText(text)
}
