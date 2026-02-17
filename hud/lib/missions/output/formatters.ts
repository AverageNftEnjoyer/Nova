/**
 * Output Formatters
 *
 * Functions for formatting mission output for display.
 */

import { cleanText, parseJsonObject, normalizeSnippetText, normalizeSourceSnippet } from "../text/cleaning"
import { extractFactSentences } from "../text/formatting"
import { toNumberSafe } from "../utils/paths"
import { uniqueSourceUrls, formatSourceButtons, collectSourceUrlsFromContextData, normalizeMissionSourcePresentation } from "./sources"
import type { AiDetailLevel } from "../types"

/**
 * Format structured mission output (JSON response).
 */
export function formatStructuredMissionOutput(raw: string): string {
  const text = String(raw || "").trim()
  if (!text) return text
  const parsed = parseJsonObject(text)
  if (!parsed) return text

  const summary = typeof parsed.summary === "string" ? cleanText(parsed.summary) : ""
  const credibleSourceCount = toNumberSafe(parsed.credibleSourceCount)
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets.map((item) => cleanText(String(item || ""))).filter(Boolean)
    : []
  const sources = Array.isArray(parsed.sources)
    ? uniqueSourceUrls(
        parsed.sources.flatMap((item) => {
          if (typeof item === "string") {
            const matches = String(item || "").match(/https?:\/\/[^\s)]+/gi) || []
            return matches.map((raw) => raw.trim().replace(/[),.;]+$/g, "")).filter(Boolean)
          }
          if (item && typeof item === "object") {
            const row = item as Record<string, unknown>
            const urlMatches = String(row.url || "").match(/https?:\/\/[^\s)]+/gi) || []
            return urlMatches.map((raw) => raw.trim().replace(/[),.;]+$/g, "")).filter(Boolean)
          }
          return []
        }),
        2,
      )
    : []

  if (!summary && bullets.length === 0 && sources.length === 0 && credibleSourceCount === null) {
    return text
  }

  const lines: string[] = []
  if (summary) lines.push(summary)
  if (credibleSourceCount !== null) {
    lines.push(`${credibleSourceCount} credible source${credibleSourceCount === 1 ? "" : "s"} found.`)
  }
  if (bullets.length > 0) {
    if (lines.length > 0) lines.push("")
    for (const bullet of bullets.slice(0, 12)) {
      lines.push(`- ${bullet}`)
    }
  }
  if (sources.length > 0) {
    lines.push("")
    lines.push(`Sources: ${formatSourceButtons(sources)}`)
  }
  return lines.join("\n").trim() || text
}

/**
 * Format web search object output.
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
  const lines: string[] = []

  if (answer) {
    lines.push(answer)
  }

  const bullets = top
    .map((row) => {
      const title = cleanText(String(row.title || row.pageTitle || ""))
      const url = cleanText(String(row.url || ""))
      const pageText = String(row.pageText || row.content || "")
      const rawSnippet = String(row.snippet || "")
      const factLines = extractFactSentences(pageText || rawSnippet, detailLevel === "concise" ? 1 : detailLevel === "detailed" ? 3 : 2)
      const snippet = normalizeSnippetText(normalizeSourceSnippet(title, rawSnippet || pageText), snippetLimit)
      if (!title && !snippet && factLines.length === 0) return null
      const heading = title || (() => {
        if (!url) return "Source"
        try {
          return new URL(url).hostname
        } catch {
          return "Source"
        }
      })()
      const description = factLines.length > 0
        ? factLines.join(" ")
        : snippet
      return {
        text: description
          ? `- ${description}`
          : `- ${heading}`,
        url,
      }
    })
    .filter((row): row is { text: string; url: string } => Boolean(row))

  if (bullets.length === 0) return null
  if (lines.length > 0) lines.push("")
  bullets.forEach((row, idx) => {
    lines.push(row.text)
    if (idx < bullets.length - 1) lines.push("")
  })

  const urls = uniqueSourceUrls(bullets.map((row) => row.url).filter(Boolean), 2)
  if (includeSources && urls.length > 0) {
    lines.push("")
    lines.push(`Sources: ${formatSourceButtons(urls)}`)
  }

  return lines.join("\n").trim() || null
}

/**
 * Humanize mission output text.
 */
export function humanizeMissionOutputText(
  raw: string,
  contextData?: unknown,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): string {
  const text = String(raw || "").trim()
  const formatted = formatStructuredMissionOutput(text)
  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const parsed = parseJsonObject(formatted)
  if (parsed) {
    const webFormatted = formatWebSearchObjectOutput(parsed, { includeSources, detailLevel })
    if (webFormatted) {
      return normalizeMissionSourcePresentation(webFormatted, collectSourceUrlsFromContextData(contextData), includeSources)
    }
  }

  if (contextData && typeof contextData === "object") {
    const contextRecord = contextData as Record<string, unknown>
    if (String(contextRecord.mode || "") === "web-search") {
      const fromContext = formatWebSearchObjectOutput(contextRecord, { includeSources, detailLevel })
      if (fromContext) {
        return normalizeMissionSourcePresentation(fromContext, collectSourceUrlsFromContextData(contextData), includeSources)
      }
    }
  }

  return normalizeMissionSourcePresentation(formatted || text, collectSourceUrlsFromContextData(contextData), includeSources)
}
