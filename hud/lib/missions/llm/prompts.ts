/**
 * LLM Prompt Building
 *
 * Functions for building prompts for mission AI steps.
 */

import { cleanText, isRawTableData, extractReadableSentences, cleanScrapedText, extractSingleQuote } from "../text/cleaning"
import { extractFactSentences } from "../text/formatting"
import { getByPath, toNumberSafe } from "../utils/paths"
import type { AiDetailLevel } from "../types/index"

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

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Fetch Support
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchResultItem {
  stepTitle: string
  data: Record<string, unknown>
}

/**
 * Check if context has multiple fetch results.
 */
export function hasMultipleFetchResults(context: Record<string, unknown>): boolean {
  const fetchResults = context.fetchResults
  return Array.isArray(fetchResults) && fetchResults.length > 1
}

/**
 * Check if a section title indicates data-heavy content (sports, markets, crypto).
 * These topics need numbers preserved, not filtered.
 */
function isDataHeavySection(sectionTitle: string): boolean {
  const lower = sectionTitle.toLowerCase()
  return /\b(nba|nfl|mlb|nhl|sports?|scores?|market|stock|crypto|bitcoin|weather|forecast)\b/.test(lower)
}

function isQuoteSection(sectionTitle: string): boolean {
  const lower = sectionTitle.toLowerCase()
  return /\b(quote|quotes|motivational|inspirational|wisdom)\b/.test(lower)
}

/**
 * Extract key data points from data-heavy content (sports scores, market data).
 * More lenient than extractReadableSentences - keeps numbers and short facts.
 */
function extractDataPoints(text: string, maxPoints: number): string[] {
  if (!text) return []
  const cleaned = cleanScrapedText(text)
  const points: string[] = []

  // Split by common delimiters and filter for useful content
  const chunks = cleaned.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 15)

  for (const chunk of chunks) {
    if (points.length >= maxPoints) break
    // Keep chunks that have some letters (not pure numbers) and aren't too long
    const letters = (chunk.match(/[a-zA-Z]/g) || []).length
    if (letters >= 5 && chunk.length < 200) {
      points.push(chunk)
    }
  }

  return points
}

/**
 * Build web evidence context for multiple fetch results.
 * Creates sections for each topic's data.
 */
export function buildMultiFetchWebEvidenceContext(
  fetchResults: FetchResultItem[],
  detailLevel: AiDetailLevel,
): string {
  if (!fetchResults || fetchResults.length === 0) return ""

  const sections: string[] = []
  const maxSourcesPerSection = detailLevel === "concise" ? 2 : detailLevel === "detailed" ? 4 : 3

  for (const fetchResult of fetchResults) {
    const sectionTitle = extractSectionTitleFromStepTitle(fetchResult.stepTitle)
    const data = fetchResult.data
    if (!data || typeof data !== "object") continue

    const record = data as Record<string, unknown>
    const payload = record.payload
    if (!payload || typeof payload !== "object") continue

    const results = Array.isArray((payload as Record<string, unknown>).results)
      ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
      : []

    const sectionLines: string[] = []
    sectionLines.push(`=== SECTION: ${sectionTitle.toUpperCase()} ===`)
    sectionLines.push("")

    if (results.length === 0) {
      sectionLines.push("No data retrieved for this section.")
      sectionLines.push("")
      sections.push(sectionLines.join("\n"))
      continue
    }

    // For data-heavy sections (sports, markets), use lenient extraction
    const isDataHeavy = isDataHeavySection(sectionTitle)
    const top = results.slice(0, maxSourcesPerSection)
    let validSourceCount = 0
    const maxFactsPerSource = detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 6 : 4

    for (const row of top) {
      const title = cleanText(String(row.title || row.pageTitle || ""))
      const rawText = String(row.pageText || row.snippet || "")

      // For data-heavy sections, don't filter by isRawTableData - we WANT the numbers
      if (!isDataHeavy && isRawTableData(rawText)) continue

      let facts: string[]
      if (isQuoteSection(sectionTitle)) {
        const quote = extractSingleQuote(rawText) || extractSingleQuote(String(row.snippet || ""))
        facts = quote ? [quote] : []
      } else if (isDataHeavy) {
        // Use lenient extraction for sports/market data
        facts = extractDataPoints(rawText, maxFactsPerSource)
      } else {
        // Use standard extraction for prose content
        const readableSentences = extractReadableSentences(rawText)
        facts = readableSentences.length > 0
          ? readableSentences.slice(0, maxFactsPerSource)
          : extractFactSentences(cleanScrapedText(rawText), maxFactsPerSource)
      }

      if (facts.length === 0) continue

      validSourceCount++
      if (title) sectionLines.push(`Source: ${title}`)
      sectionLines.push("Content:")
      for (const fact of facts) {
        // For data-heavy sections, be lenient with filtering
        const shouldInclude = isDataHeavy
          ? fact.length > 10
          : !isRawTableData(fact) && fact.length > 20
        if (shouldInclude) {
          sectionLines.push(`  - ${fact}`)
        }
      }
      sectionLines.push("")
    }

    if (validSourceCount === 0) {
      // For data-heavy sections that found no content, include raw snippets as fallback
      if (isDataHeavy && results.length > 0) {
        sectionLines.push("Raw data (may need interpretation):")
        for (const row of results.slice(0, 2)) {
          const snippet = cleanText(String(row.snippet || "")).slice(0, 300)
          if (snippet) sectionLines.push(`  - ${snippet}`)
        }
        sectionLines.push("")
      } else {
        sectionLines.push("No readable content extracted for this section.")
        sectionLines.push("")
      }
    }

    sections.push(sectionLines.join("\n"))
  }

  if (sections.length === 0) {
    return "No readable article content found across all topics."
  }

  return [
    "=== MULTI-TOPIC DATA (use this to build your report) ===",
    "",
    ...sections,
    "=== END OF DATA ===",
  ].join("\n").trim()
}

/**
 * Extract a section title from a fetch step title.
 * e.g., "Fetch NBA Scores" -> "NBA Scores"
 */
function extractSectionTitleFromStepTitle(stepTitle: string): string {
  const cleaned = cleanText(stepTitle || "")
  // Remove common prefixes
  const withoutPrefix = cleaned
    .replace(/^Fetch\s+/i, "")
    .replace(/^Get\s+/i, "")
    .replace(/^Search\s+/i, "")
    .replace(/^data$/i, "Results")
  return withoutPrefix || "Results"
}

/**
 * Check if any of the fetch results have usable data.
 */
export function hasUsableMultiFetchData(fetchResults: FetchResultItem[]): boolean {
  if (!fetchResults || fetchResults.length === 0) return false
  return fetchResults.some((item) => {
    const data = item.data
    if (!data || typeof data !== "object") return false
    const record = data as Record<string, unknown>
    return record.ok === true && (record.credibleSourceCount as number) > 0
  })
}

/**
 * Combine source URLs from multiple fetch results.
 */
export function collectSourceUrlsFromMultiFetch(fetchResults: FetchResultItem[]): string[] {
  if (!fetchResults || fetchResults.length === 0) return []
  const urls: string[] = []
  for (const item of fetchResults) {
    const data = item.data
    if (!data || typeof data !== "object") continue
    const record = data as Record<string, unknown>
    const sourceUrls = record.sourceUrls
    if (Array.isArray(sourceUrls)) {
      urls.push(...sourceUrls.filter((url): url is string => typeof url === "string" && url.length > 0))
    }
  }
  return urls
}
