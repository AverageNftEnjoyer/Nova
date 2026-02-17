/**
 * Output Formatters
 *
 * Functions for formatting mission output for display.
 */

import { cleanText, parseJsonObject, normalizeSnippetText, normalizeSourceSnippet, extractSingleQuote } from "../text/cleaning"
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

function normalizeMarkdownHeadings(raw: string): string {
  return String(raw || "").replace(/^#{1,6}\s+(.+)$/gm, "**$1**")
}

function sectionExists(raw: string, section: string): boolean {
  const pattern = new RegExp(`(^|\\n)(\\*\\*)?${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\*\\*)?\\s*(\\n|$)`, "i")
  return pattern.test(raw) || new RegExp(`(^|\\n)#{1,6}\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\n|$)`, "i").test(raw)
}

function replaceSectionBody(raw: string, sectionName: string, replacementLines: string[]): string {
  const lines = String(raw || "").split("\n")
  const startIndex = lines.findIndex((line) => {
    const trimmed = line.trim()
    return new RegExp(`^(\\*\\*)?${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\*\\*)?$`, "i").test(trimmed) ||
      new RegExp(`^#{1,6}\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(trimmed)
  })
  if (startIndex < 0) return raw
  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (/^(\*\*)?[A-Za-z][^:]{2,}(\*\*)?$/.test(trimmed) || /^#{1,6}\s+/.test(trimmed)) {
      endIndex = i
      break
    }
  }
  const next = [
    ...lines.slice(0, startIndex + 1),
    ...replacementLines,
    ...lines.slice(endIndex),
  ]
  return next.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function collectQuoteFromContextData(contextData?: unknown): string | null {
  if (!contextData || typeof contextData !== "object") return null
  const record = contextData as Record<string, unknown>
  const fetchResults = Array.isArray(record.fetchResults) ? record.fetchResults : []
  for (const item of fetchResults) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const stepTitle = String(row.stepTitle || "").toLowerCase()
    if (!/\bquote|motivational|inspirational\b/.test(stepTitle)) continue
    const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null
    const payload = data?.payload && typeof data.payload === "object" ? (data.payload as Record<string, unknown>) : null
    const results = Array.isArray(payload?.results) ? (payload?.results as Array<Record<string, unknown>>) : []
    for (const source of results) {
      const quote = extractSingleQuote(String(source.pageText || "")) || extractSingleQuote(String(source.snippet || ""))
      if (quote) return quote.replace(/\u2014|\u2013/g, "-")
    }
  }
  return null
}

function extractSectionFactFromContextData(section: string, contextData?: unknown): string | null {
  if (!contextData || typeof contextData !== "object") return null
  const record = contextData as Record<string, unknown>
  const fetchResults = Array.isArray(record.fetchResults) ? record.fetchResults : []
  const sectionKey = String(section || "").trim().toLowerCase()
  if (!sectionKey) return null

  for (const item of fetchResults) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const stepTitle = String(row.stepTitle || "").trim().toLowerCase()
    if (!stepTitle) continue
    if (!stepTitle.includes(sectionKey) && !sectionKey.includes(stepTitle.replace(/^fetch\s+/i, "").trim())) continue
    const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null
    const payload = data?.payload && typeof data.payload === "object" ? (data.payload as Record<string, unknown>) : null
    const results = Array.isArray(payload?.results) ? (payload?.results as Array<Record<string, unknown>>) : []
    const combined = results
      .slice(0, 4)
      .map((source) => normalizeSnippetText(String(source.pageText || source.snippet || ""), 280))
      .filter(Boolean)
      .join("\n")
    if (!combined) continue
    const facts = extractFactSentences(combined, 1)
    if (facts.length > 0) return facts[0]
  }
  return null
}

function normalizeReadableSpacing(raw: string): string {
  const text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(\*\*[^*\n]+\*\*)\n{2,}(-\s+)/g, "$1\n$2")
    .replace(/([A-Za-z][^\n:]{2,})\n{2,}(-\s+)/g, "$1\n$2")
    .replace(/\n{2,}(Sources:\s+)/gi, "\n\n$1")
    .replace(/Sources:\s*\*\*/gi, "Sources:")
    .trim()
  return text
}

function enforceContentGuards(raw: string, contextData?: unknown): string {
  let text = normalizeMarkdownHeadings(raw)
  const fetchSections = (() => {
    if (!contextData || typeof contextData !== "object") return [] as string[]
    const record = contextData as Record<string, unknown>
    const fetchResults = Array.isArray(record.fetchResults) ? record.fetchResults : []
    const titles: string[] = []
    for (const item of fetchResults) {
      if (!item || typeof item !== "object") continue
      const row = item as Record<string, unknown>
      const stepTitle = String(row.stepTitle || "").trim()
      if (!stepTitle) continue
      const section = stepTitle.replace(/^Fetch\s+/i, "").trim()
      if (!section) continue
      if (!titles.some((entry) => entry.toLowerCase() === section.toLowerCase())) {
        titles.push(section)
      }
    }
    return titles
  })()
  for (const section of fetchSections) {
    if (sectionExists(text, section)) continue
    if (/quote|motivational|inspirational/i.test(section)) continue
    const extractedFact = extractSectionFactFromContextData(section, contextData)
    const fallbackLine = extractedFact
      ? `- ${extractedFact}`
      : /nba/i.test(section)
        ? "- No NBA games were played last night."
        : "- No reliable data available for this section."
    text = `${text.trim()}\n\n**${section}**\n\n${fallbackLine}`.trim()
  }
  const hasNbaSection = sectionExists(text, "NBA Scores")
  if (hasNbaSection) {
    const noGamesPattern = /\b(no nba games were played last night|no games were played last night)\b/i
    const missingPattern = /\bmissing:|no completed games|no final scores|no data available\b/i
    if (!noGamesPattern.test(text) && missingPattern.test(text)) {
      text = replaceSectionBody(text, "NBA Scores", ["", "- No NBA games were played last night.", ""])
    }
  }

  const wantsQuoteSection = sectionExists(text, "Today's Quote") || sectionExists(text, "Daily Quote") || (() => {
    if (!contextData || typeof contextData !== "object") return false
    const fetchResults = (contextData as Record<string, unknown>).fetchResults
    if (!Array.isArray(fetchResults)) return false
    return fetchResults.some((item) => {
      if (!item || typeof item !== "object") return false
      const stepTitle = String((item as Record<string, unknown>).stepTitle || "").toLowerCase()
      return /\bquote|motivational|inspirational\b/.test(stepTitle)
    })
  })()

  if (wantsQuoteSection) {
    const hasQuote = /"[^"\n]{12,}"\s*[-\u2014\u2013]\s*[A-Za-z][^\n]{1,80}/.test(text)
    if (!hasQuote) {
      const quote = collectQuoteFromContextData(contextData)
      const quoteSection = `**Today's Quote**\n\n- ${quote || "No reliable motivational quote found today."}`
      text = `${text.trim()}\n\n${quoteSection}`.trim()
    }
  }

  return normalizeReadableSpacing(text)
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
  const text = enforceContentGuards(String(raw || "").trim(), contextData)
  const formatted = formatStructuredMissionOutput(text)
  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const parsed = parseJsonObject(formatted)
  if (parsed) {
    const webFormatted = formatWebSearchObjectOutput(parsed, { includeSources, detailLevel })
    if (webFormatted) {
      return normalizeMissionSourcePresentation(enforceContentGuards(webFormatted, contextData), collectSourceUrlsFromContextData(contextData), includeSources)
    }
  }

  if (contextData && typeof contextData === "object") {
    const contextRecord = contextData as Record<string, unknown>
    if (String(contextRecord.mode || "") === "web-search") {
      const fromContext = formatWebSearchObjectOutput(contextRecord, { includeSources, detailLevel })
      if (fromContext) {
        return normalizeMissionSourcePresentation(enforceContentGuards(fromContext, contextData), collectSourceUrlsFromContextData(contextData), includeSources)
      }
    }
  }

  return normalizeMissionSourcePresentation(enforceContentGuards(formatted || text, contextData), collectSourceUrlsFromContextData(contextData), includeSources)
}

