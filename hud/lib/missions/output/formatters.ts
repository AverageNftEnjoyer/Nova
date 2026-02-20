/**
 * Output Formatters
 *
 * Generic mission output normalization.
 * Keeps model output style intact and only applies lightweight cleanup.
 */

import { cleanText, normalizeSnippetText, normalizeSourceSnippet, parseJsonObject } from "../text/cleaning"
import { extractFactSentences } from "../text/formatting"
import { toNumberSafe } from "../utils/paths"
import { collectSourceUrlsFromContextData, formatSourceButtons, normalizeMissionSourcePresentation, uniqueSourceUrls } from "./sources"
import type { AiDetailLevel } from "../types"

function normalizeMarkdownHeadings(raw: string): string {
  return String(raw || "").replace(/^#{1,6}\s+(.+)$/gm, "**$1**")
}

function normalizeReadableSpacing(raw: string): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n{2,}(Sources:\s+)/gi, "\n\n$1")
    .replace(/Sources:\s*\*\*/gi, "Sources:")
    .trim()
}

function maybeStripPromptDirectiveEcho(raw: string): string {
  const lines = String(raw || "").split("\n")
  const directivePattern =
    /^(user request|primary user request|instruction|formatting rules|strict formatting rules|output shape|quality rules|cover each requested area|create one combined message|do not include raw urls)\b/i
  const numberedInstructionPattern = /^\s*\d+\)\s+/

  let directiveHits = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (directivePattern.test(trimmed) || numberedInstructionPattern.test(trimmed)) {
      directiveHits += 1
    }
  }
  if (directiveHits < 2) return raw

  return lines
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (directivePattern.test(trimmed)) return false
      if (numberedInstructionPattern.test(trimmed)) return false
      return true
    })
    .join("\n")
    .trim()
}

function cleanupModelOutput(raw: string): string {
  return normalizeReadableSpacing(
    normalizeMarkdownHeadings(
      maybeStripPromptDirectiveEcho(
        String(raw || "").replace(/\{\{\s*[^}]+\s*\}\}/g, " ").trim(),
      ),
    ),
  )
}

/**
 * Format structured mission output when model returns JSON payload.
 */
export function formatStructuredMissionOutput(raw: string): string {
  const text = String(raw || "").trim()
  if (!text) return text
  const parsed = parseJsonObject(text)
  if (!parsed) return text

  const primaryText = [
    String(parsed.message || "").trim(),
    String(parsed.content || "").trim(),
    String(parsed.text || "").trim(),
    String(parsed.summary || "").trim(),
  ]
    .map((item) => cleanText(item))
    .find(Boolean) || ""

  const credibleSourceCount = toNumberSafe(parsed.credibleSourceCount)
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets.map((item) => cleanText(String(item || ""))).filter(Boolean)
    : []
  const sources = Array.isArray(parsed.sources)
    ? uniqueSourceUrls(
        parsed.sources.flatMap((item) => {
          if (typeof item === "string") {
            const matches = String(item || "").match(/https?:\/\/[^\s)]+/gi) || []
            return matches.map((row) => row.trim().replace(/[),.;]+$/g, "")).filter(Boolean)
          }
          if (item && typeof item === "object") {
            const row = item as Record<string, unknown>
            const url = String(row.url || "").trim()
            return url ? [url] : []
          }
          return []
        }),
        2,
      )
    : []

  if (!primaryText && bullets.length === 0 && sources.length === 0 && credibleSourceCount === null) {
    return text
  }

  const lines: string[] = []
  if (primaryText) lines.push(primaryText)
  if (bullets.length > 0) {
    if (lines.length > 0) lines.push("")
    for (const bullet of bullets.slice(0, 10)) {
      lines.push(`- ${bullet}`)
    }
  }
  if (credibleSourceCount !== null && !primaryText) {
    lines.push(`Based on ${credibleSourceCount} source${credibleSourceCount === 1 ? "" : "s"}.`)
  }
  if (sources.length > 0) {
    lines.push("")
    lines.push(`Sources: ${formatSourceButtons(sources)}`)
  }
  return lines.join("\n").trim() || text
}

/**
 * Format web-search shaped JSON into natural mission text.
 */
export function formatWebSearchObjectOutput(
  obj: Record<string, unknown>,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): string | null {
  const directResults = Array.isArray(obj.results) ? (obj.results as Array<Record<string, unknown>>) : []
  const payload = obj.payload && typeof obj.payload === "object" ? (obj.payload as Record<string, unknown>) : null
  const payloadResults = payload && Array.isArray(payload.results) ? (payload.results as Array<Record<string, unknown>>) : []
  const results = (directResults.length > 0 ? directResults : payloadResults).filter((row) => row && typeof row === "object")
  if (results.length === 0) return null

  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const maxSources = detailLevel === "concise" ? 2 : detailLevel === "detailed" ? 4 : 3
  const snippetLimit = detailLevel === "concise" ? 120 : detailLevel === "detailed" ? 240 : 170
  const answer = normalizeSnippetText(
    String(obj.answer || payload?.answer || ""),
    detailLevel === "concise" ? 220 : detailLevel === "detailed" ? 500 : 320,
  )
  const top = results.slice(0, maxSources)

  const factFragments: string[] = []
  const sourceUrls: string[] = []
  for (const row of top) {
    const title = cleanText(String(row.title || row.pageTitle || ""))
    const url = cleanText(String(row.url || ""))
    const pageText = String(row.pageText || row.content || "")
    const rawSnippet = String(row.snippet || "")
    const facts = extractFactSentences(pageText || rawSnippet, detailLevel === "concise" ? 1 : detailLevel === "detailed" ? 3 : 2)
    const fallbackSnippet = normalizeSnippetText(normalizeSourceSnippet(title, rawSnippet || pageText), snippetLimit)
    const picked = facts.length > 0 ? facts.join(" ") : fallbackSnippet
    if (picked) factFragments.push(picked)
    if (url) sourceUrls.push(url)
  }

  const lines: string[] = []
  if (answer) lines.push(answer)
  if (factFragments.length > 0) {
    const joinedFacts = factFragments
      .slice(0, detailLevel === "concise" ? 2 : detailLevel === "detailed" ? 6 : 4)
      .map((fact) => normalizeSnippetText(fact, 220))
      .filter(Boolean)
      .join(" ")
      .trim()
    if (joinedFacts) lines.push(joinedFacts)
  }

  if (lines.length === 0) return null

  if (includeSources) {
    const urls = uniqueSourceUrls(sourceUrls, 2)
    if (urls.length > 0) {
      lines.push(`Sources: ${formatSourceButtons(urls)}`)
    }
  }

  return normalizeReadableSpacing(lines.join("\n\n"))
}

/**
 * Humanize mission output text while preserving requested style.
 */
export function humanizeMissionOutputText(
  raw: string,
  contextData?: unknown,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): string {
  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const rawText = String(raw || "").trim()
  if (!rawText) return rawText

  const structured = formatStructuredMissionOutput(rawText)
  let candidate = structured

  const parsedStructured = parseJsonObject(structured)
  if (parsedStructured) {
    const webFormatted = formatWebSearchObjectOutput(parsedStructured, { includeSources, detailLevel })
    if (webFormatted) candidate = webFormatted
  } else if (contextData && typeof contextData === "object") {
    const contextRecord = contextData as Record<string, unknown>
    if (String(contextRecord.mode || "") === "web-search") {
      const fromContext = formatWebSearchObjectOutput(contextRecord, { includeSources, detailLevel })
      if (fromContext) candidate = fromContext
    }
  }

  const cleaned = cleanupModelOutput(candidate || rawText)
  return normalizeMissionSourcePresentation(cleaned, collectSourceUrlsFromContextData(contextData), includeSources)
}
