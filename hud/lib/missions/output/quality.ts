/**
 * Output Quality Guardrails
 *
 * Scores mission output quality and provides context-grounded fallbacks
 * when output is too low-signal for delivery.
 */

import { cleanText, normalizeSnippetText } from "../text/cleaning"
import { extractFactSentences } from "../text/formatting"
import { collectSourceUrlsFromContextData, formatSourceButtons, uniqueSourceUrls } from "./sources"
import type { AiDetailLevel } from "../types/index"

const LOW_SIGNAL_PATTERNS: RegExp[] = [
  /\bno reliable (?:fetched )?data\b/i,
  /\bno data (?:available|retrieved|found)\b/i,
  /\bunable to extract meaningful insights\b/i,
  /\binsufficient (?:context|data)\b/i,
  /\bai step failed\b/i,
  /\bunknown error\b/i,
  /\bnot enough information\b/i,
]

const MIN_SCORE = parseNumberEnv("NOVA_MISSION_QUALITY_MIN_SCORE", 46, 0, 100)
const MIN_WORDS = parseNumberEnv("NOVA_MISSION_QUALITY_MIN_WORDS", 24, 3, 200)
const DEBUG = parseBooleanEnv("NOVA_MISSION_QUALITY_DEBUG", false)

export interface MissionOutputQualityReport {
  score: number
  lowSignal: boolean
  reasons: string[]
  metrics: {
    charCount: number
    wordCount: number
    bulletCount: number
    sectionCount: number
    uniqueWordRatio: number
    lowSignalPatternHits: number
    hasSourceSection: boolean
    expectedSectionCount: number
    matchedSectionCount: number
  }
}

export interface MissionOutputGuardrailResult {
  text: string
  applied: boolean
  report: MissionOutputQualityReport
  fallbackReport?: MissionOutputQualityReport
}

function parseNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase()
  if (!raw) return fallback
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return fallback
}

function toWords(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function collectExpectedSections(contextData?: unknown): string[] {
  if (!contextData || typeof contextData !== "object") return []
  const record = contextData as Record<string, unknown>
  const fetchResults = Array.isArray(record.fetchResults) ? record.fetchResults : []
  const names: string[] = []
  for (const item of fetchResults) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const stepTitle = cleanText(String(row.stepTitle || "")).replace(/^fetch\s+/i, "")
    if (!stepTitle) continue
    if (!names.some((existing) => existing.toLowerCase() === stepTitle.toLowerCase())) {
      names.push(stepTitle)
    }
  }
  return names
}

function countMatchedSections(text: string, sections: string[]): number {
  if (!text || sections.length === 0) return 0
  let matches = 0
  for (const section of sections) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`(^|\\n)(\\*\\*)?${escaped}(\\*\\*)?\\s*(\\n|$)`, "i")
    if (pattern.test(text)) matches += 1
  }
  return matches
}

function collectEvidenceRows(contextData?: unknown): Array<{ section: string; text: string; url?: string }> {
  const rows: Array<{ section: string; text: string; url?: string }> = []
  if (!contextData || typeof contextData !== "object") return rows

  const fromRecord = (record: Record<string, unknown>, sectionLabel: string) => {
    const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : null
    const payloadText = normalizeSnippetText(String(payload?.text || record.text || ""), 420)
    if (payloadText) {
      rows.push({ section: sectionLabel, text: payloadText })
    }

    const results = Array.isArray(payload?.results) ? (payload?.results as Array<Record<string, unknown>>) : []
    for (const result of results.slice(0, 4)) {
      const text = String(result.pageText || result.snippet || "").trim()
      if (!text) continue
      rows.push({
        section: sectionLabel,
        text,
        url: String(result.url || "").trim() || undefined,
      })
    }
  }

  const top = contextData as Record<string, unknown>
  const fetchResults = Array.isArray(top.fetchResults) ? top.fetchResults : []
  if (fetchResults.length > 0) {
    for (const item of fetchResults) {
      if (!item || typeof item !== "object") continue
      const row = item as Record<string, unknown>
      const sectionLabel = cleanText(String(row.stepTitle || "").replace(/^fetch\s+/i, "")) || "Update"
      const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null
      if (!data) continue
      fromRecord(data, sectionLabel)
    }
    return rows
  }

  fromRecord(top, "Update")
  return rows
}

function buildFallbackFromContext(
  contextData: unknown,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): string | null {
  const includeSources = options?.includeSources !== false
  const detailLevel = options?.detailLevel || "standard"
  const maxFacts = detailLevel === "concise" ? 3 : detailLevel === "detailed" ? 8 : 5

  const evidence = collectEvidenceRows(contextData)
  if (evidence.length === 0) return null

  const facts: string[] = []
  const sourceCandidates: string[] = []
  for (const row of evidence) {
    if (row.url) sourceCandidates.push(row.url)
    const extracted = extractFactSentences(row.text, detailLevel === "concise" ? 1 : 2)
    for (const fact of extracted) {
      const normalized = normalizeSnippetText(fact, 220)
      if (!normalized) continue
      if (!facts.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        facts.push(normalized)
      }
      if (facts.length >= maxFacts) break
    }
    if (facts.length >= maxFacts) break
  }

  if (facts.length === 0) return null

  const intro = detailLevel === "concise"
    ? "Quick update:"
    : "Here is the latest update:"
  const body = facts.join(" ").trim()
  const lines = [`${intro} ${body}`.trim()]

  if (includeSources) {
    const contextUrls = collectSourceUrlsFromContextData(contextData)
    const urls = uniqueSourceUrls([...sourceCandidates, ...contextUrls], 3)
    if (urls.length > 0) {
      lines.push("")
      lines.push(`Sources: ${formatSourceButtons(urls)}`)
    }
  }
  return lines.join("\n").trim()
}

export function evaluateMissionOutputQuality(
  raw: string,
  contextData?: unknown,
  options?: {
    includeSources?: boolean
  },
): MissionOutputQualityReport {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim()
  const includeSources = options?.includeSources !== false
  const reasons: string[] = []

  const charCount = text.length
  const words = toWords(text)
  const wordCount = words.length
  const bulletCount = (text.match(/(^|\n)\s*-\s+/g) || []).length
  const sectionCount = (text.match(/(^|\n)\s*(\*\*[^*\n]{2,}\*\*|#{1,6}\s+\S+)/g) || []).length
  const uniqueWordRatio = wordCount === 0 ? 0 : new Set(words).size / wordCount
  const lowSignalPatternHits = LOW_SIGNAL_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  )
  const hasSourceSection = /\bsources:\s+/i.test(text) || /\[source\s+\d+\]\(https?:\/\//i.test(text)
  const expectedSections = collectExpectedSections(contextData)
  const expectedSectionCount = expectedSections.length
  const matchedSectionCount = countMatchedSections(text, expectedSections)

  let score = 100
  if (charCount < 90) {
    score -= 28
    reasons.push("too_short")
  }
  if (wordCount < MIN_WORDS) {
    score -= 24
    reasons.push("low_word_count")
  }
  if (uniqueWordRatio < 0.48) {
    score -= 14
    reasons.push("low_lexical_diversity")
  }
  if (/\{\{\s*[^}]+\s*\}\}/.test(text)) {
    score -= 24
    reasons.push("unresolved_template_tokens")
  }
  if (lowSignalPatternHits > 0) {
    score -= Math.min(42, lowSignalPatternHits * 14)
    reasons.push("low_signal_phrases")
  }
  if (/^\s*[\[{].*[\]}]\s*$/s.test(text) && !/^\s*-\s+/m.test(text)) {
    score -= 20
    reasons.push("raw_payload_shape")
  }
  if (includeSources && collectSourceUrlsFromContextData(contextData).length > 0 && !hasSourceSection) {
    score -= 12
    reasons.push("missing_sources")
  }

  score = clamp(score, 0, 100)
  const lowSignal = score < MIN_SCORE

  return {
    score,
    lowSignal,
    reasons,
    metrics: {
      charCount,
      wordCount,
      bulletCount,
      sectionCount,
      uniqueWordRatio,
      lowSignalPatternHits,
      hasSourceSection,
      expectedSectionCount,
      matchedSectionCount,
    },
  }
}

export function applyMissionOutputQualityGuardrails(
  raw: string,
  contextData?: unknown,
  options?: {
    includeSources?: boolean
    detailLevel?: AiDetailLevel
  },
): MissionOutputGuardrailResult {
  const text = String(raw || "").trim()
  const report = evaluateMissionOutputQuality(text, contextData, { includeSources: options?.includeSources })
  if (!report.lowSignal) {
    return { text, applied: false, report }
  }

  const fallback = buildFallbackFromContext(contextData, options)
  if (!fallback) {
    return { text, applied: false, report }
  }

  const fallbackReport = evaluateMissionOutputQuality(fallback, contextData, { includeSources: options?.includeSources })
  const shouldApply = fallbackReport.score >= report.score + 8

  if (DEBUG) {
    const mode = shouldApply ? "applied" : "ignored"
    console.log(
      `[MissionQuality] ${mode} score=${report.score} fallback=${fallbackReport.score} reasons=${report.reasons.join(",") || "none"}`,
    )
  }

  return {
    text: shouldApply ? fallback : text,
    applied: shouldApply,
    report,
    fallbackReport,
  }
}
