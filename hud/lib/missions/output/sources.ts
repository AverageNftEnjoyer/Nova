/**
 * Source URL Utilities
 *
 * Functions for collecting and formatting source URLs.
 */

import { extractUrlsFromText } from "../text/formatting"

/**
 * Deduplicate and normalize source URLs.
 */
export function uniqueSourceUrls(urls: string[], limit = 20): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const candidate of urls) {
    const raw = String(candidate || "").trim()
    if (!raw) continue
    let normalized = raw
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
      normalized = parsed.toString()
    } catch {
      continue
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Format source URLs as markdown buttons (inline).
 */
export function formatSourceButtons(urls: string[]): string {
  return uniqueSourceUrls(urls, 3)
    .map((url, idx) => `[Source ${idx + 1}](${url})`)
    .join(" ")
}

/**
 * Format source URLs as stacked list (one per line).
 */
export function formatSourcesStacked(urls: string[]): string {
  return uniqueSourceUrls(urls, 3)
    .map((url, idx) => `[Source ${idx + 1}](${url})`)
    .join("\n")
}

/**
 * Collect source URLs from context data.
 */
export function collectSourceUrlsFromContextData(contextData?: unknown): string[] {
  if (!contextData || typeof contextData !== "object") return []
  const record = contextData as Record<string, unknown>
  const urls: string[] = []

  const fetchResults = record.fetchResults
  if (Array.isArray(fetchResults)) {
    const perFetchUrls: string[] = []
    for (const item of fetchResults) {
      if (!item || typeof item !== "object") continue
      const row = item as Record<string, unknown>
      const nestedData = row.data
      if (!nestedData || typeof nestedData !== "object") continue
      const nestedUrls = collectSourceUrlsFromContextData(nestedData)
      if (nestedUrls.length > 0) perFetchUrls.push(nestedUrls[0])
    }
    if (perFetchUrls.length > 0) {
      return uniqueSourceUrls(perFetchUrls, perFetchUrls.length)
    }
  }

  const direct = record.sourceUrls
  if (Array.isArray(direct)) {
    urls.push(...direct.map((item) => String(item || "")))
  }
  const payload = record.payload
  if (payload && typeof payload === "object") {
    const payloadRecord = payload as Record<string, unknown>
    if (Array.isArray(payloadRecord.sourceUrls)) {
      urls.push(...payloadRecord.sourceUrls.map((item) => String(item || "")))
    }
    if (Array.isArray(payloadRecord.results)) {
      urls.push(
        ...payloadRecord.results
          .map((row) => (row && typeof row === "object" ? String((row as Record<string, unknown>).url || "") : ""))
          .filter(Boolean),
      )
    }
  }
  return uniqueSourceUrls(urls, Math.max(3, urls.length))
}

/**
 * Normalize mission source presentation, adding source links.
 */
export function normalizeMissionSourcePresentation(raw: string, fallbackUrls?: string[], includeSources = true): string {
  const text = String(raw || "").trim()
  if (!text) return text
  const extracted = extractUrlsFromText(text)
  const urls = uniqueSourceUrls([...(fallbackUrls || []), ...extracted], 3)
  let body = text
  // Remove existing "Sources:" section
  body = body.replace(/\n{0,2}sources:\s*[\s\S]*$/i, "").trim()
  body = body
    .split("\n")
    .filter((line) => !/^https?:\/\/\S+$/i.test(line.trim()))
    .join("\n")
    .trim()
  if (!includeSources || urls.length === 0) return body || text
  const sourceSection = `Sources: ${formatSourceButtons(urls)}`
  return `${body}\n\n${sourceSection}`.trim()
}
