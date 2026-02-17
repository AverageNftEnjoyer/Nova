/**
 * LLM Prompt Building
 *
 * Functions for building prompts for mission AI steps.
 */

import { cleanText, normalizeSnippetText, normalizeSourceSnippet, isRawTableData, extractReadableSentences, cleanScrapedText } from "../text/cleaning"
import { extractFactSentences } from "../text/formatting"
import { getByPath, toNumberSafe } from "../utils/paths"
import type { AiDetailLevel } from "../types"

/**
 * Build web evidence context for AI prompts.
 * Filters out raw table data and junk before sending to AI.
 */
export function buildWebEvidenceContext(
  contextData: unknown,
  detailLevel: AiDetailLevel,
): string | null {
  if (!contextData || typeof contextData !== "object") return null
  const record = contextData as Record<string, unknown>
  if (String(record.mode || "") !== "web-search") return null
  const payload = record.payload
  if (!payload || typeof payload !== "object") return null
  const results = Array.isArray((payload as Record<string, unknown>).results)
    ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
    : []
  if (results.length === 0) return null
  const maxSources = detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 5 : 4
  const lines: string[] = []
  lines.push("Web evidence (readable content only - raw data tables have been filtered):")
  lines.push("")
  const top = results.slice(0, maxSources)
  let validSourceCount = 0
  top.forEach((row, index) => {
    const title = cleanText(String(row.title || row.pageTitle || `Source ${index + 1}`))
    const url = cleanText(String(row.url || ""))
    const rawText = String(row.pageText || row.snippet || "")

    // Skip sources that are mostly raw table data
    if (isRawTableData(rawText)) {
      return
    }

    // Extract readable sentences, not raw data
    const readableSentences = extractReadableSentences(rawText)
    const facts = readableSentences.length > 0
      ? readableSentences.slice(0, detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 6 : 4)
      : extractFactSentences(cleanScrapedText(rawText), detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 6 : 4)

    // Skip if no readable content
    if (facts.length === 0) {
      return
    }

    validSourceCount++
    lines.push(`${validSourceCount}. ${title}`)
    for (const fact of facts) {
      // Double-check each fact isn't raw data
      if (!isRawTableData(fact) && fact.length > 20) {
        lines.push(`- ${fact}`)
      }
    }
    if (url) lines.push(`URL: ${url}`)
    lines.push("")
  })

  if (validSourceCount === 0) {
    return "No readable article content found. Sources contained only raw data tables or navigation."
  }

  return lines.join("\n").trim() || null
}

/**
 * Build a forced web summary prompt when initial response was NO_DATA.
 */
export function buildForcedWebSummaryPrompt(
  contextData: unknown,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): string {
  const payload = contextData && typeof contextData === "object"
    ? (contextData as Record<string, unknown>).payload
    : null
  const results = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).results)
    ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
    : []
  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const isProseFormat = detailLevel === "detailed"
  const detailInstruction = detailLevel === "concise"
    ? "Keep the response brief and skimmable (about 4-6 bullets)."
    : detailLevel === "detailed"
      ? "Write a comprehensive multi-paragraph report (10-12 sentences across 3-4 paragraphs). Use flowing prose, not bullet points."
      : "Provide a readable medium-detail summary (about 6-8 bullets)."

  // Filter and clean sources before building prompt
  const sourceLines = results
    .slice(0, 5)
    .map((item, idx) => {
      const title = String(item.title || "Untitled")
      const url = String(item.url || "")
      const raw = String(item.pageText || item.snippet || "")

      // Skip sources that are mostly raw table data
      if (isRawTableData(raw)) {
        return null
      }

      // Extract only readable sentences
      const readableSentences = extractReadableSentences(raw)
      const facts = readableSentences.length > 0
        ? readableSentences.slice(0, detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 8 : 5)
        : extractFactSentences(cleanScrapedText(raw), detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 8 : 5)

      if (facts.length === 0) {
        return null
      }

      const factBlock = facts
        .filter(fact => !isRawTableData(fact) && fact.length > 20)
        .map((fact) => `- ${fact}`)
        .join("\n")

      if (!factBlock) return null

      return `${idx + 1}. ${title}\nURL: ${url}\nKey points:\n${factBlock}`
    })
    .filter(Boolean)
    .join("\n\n")

  const criticalRules = [
    "CRITICAL - DO NOT:",
    "- Copy raw numbers/percentages without context (like '49,501-1.2%3.0%')",
    "- Include stock ticker data or price tables",
    "- Paste spreadsheet-like data (YTD, MTD columns)",
    "- Use article headlines verbatim",
    "- Include navigation text, photo credits, or 'Read more' links",
    "",
  ]

  const formatRules = isProseFormat
    ? [
        "FORMAT RULES FOR DETAILED SUMMARY:",
        "- Write in YOUR OWN WORDS - do not copy text from sources",
        "- Write 10-12 complete sentences in flowing paragraphs",
        "- Synthesize insights from multiple sources into one narrative",
        "- Explain WHAT is happening and WHY it matters",
        "- If discussing markets: describe trends, not raw numbers",
        "- Use phrases like 'Markets experienced...', 'Analysts suggest...', 'The trend indicates...'",
        "- Each paragraph should cover a distinct theme or topic",
      ]
    : [
        "FORMAT RULES:",
        "- Write complete, standalone sentences in YOUR OWN WORDS",
        "- Each bullet should explain ONE fact with context",
        "- Start each bullet with a dash (-) followed by a space",
        "- Don't just list numbers - explain what they mean",
        "- Example good bullet: '- The S&P 500 declined 1.4% this week amid tariff concerns'",
        "- Example bad bullet: '- S&P 500 Index6,836-1.4%-0.1%'",
      ]

  const lines = [
    "Create a human-readable summary. You are a journalist writing for a general audience.",
    "",
    ...criticalRules,
    ...formatRules,
    "",
    detailInstruction,
    "",
    "If the source data is mostly raw tables or unusable, say: 'Unable to extract meaningful insights from the available sources.'",
    "",
    "CLEANED SOURCE CONTENT:",
    sourceLines || "No readable content available from sources.",
  ]
  if (includeSources) {
    lines.push("")
    lines.push("END: Add sources as [Source 1](url) [Source 2](url)")
  }
  return lines.join("\n")
}

/**
 * Derive credible source count from context.
 */
export function deriveCredibleSourceCountFromContext(context: Record<string, unknown>): number {
  const fromTopLevel = toNumberSafe(getByPath(context, "data.credibleSourceCount"))
  if (fromTopLevel !== null) return Math.max(0, Math.floor(fromTopLevel))

  const fromPayload = toNumberSafe(getByPath(context, "data.payload.credibleSourceCount"))
  if (fromPayload !== null) return Math.max(0, Math.floor(fromPayload))

  const sourceUrls = getByPath(context, "data.sourceUrls")
  if (Array.isArray(sourceUrls)) return sourceUrls.filter(Boolean).length

  const payloadSourceUrls = getByPath(context, "data.payload.sourceUrls")
  if (Array.isArray(payloadSourceUrls)) return payloadSourceUrls.filter(Boolean).length

  const payloadLinks = getByPath(context, "data.payload.links")
  if (Array.isArray(payloadLinks)) return payloadLinks.filter(Boolean).length

  return 0
}
