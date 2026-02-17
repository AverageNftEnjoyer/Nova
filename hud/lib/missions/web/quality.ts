/**
 * Web Content Quality Detection
 *
 * Functions for determining if web content is usable for missions.
 */

import { cleanText } from "../text/cleaning"

/**
 * Check if text has signals of a game recap (sports).
 */
export function hasRecapSignal(text: string): boolean {
  const value = String(text || "").toLowerCase()
  if (!value) return false
  return /\b(recap|final|box score|game summary|won|defeated|beat|points|rebounds|assists|scoreboard)\b/.test(value)
    || /\b\d{2,3}\s*[-:]\s*\d{2,3}\b/.test(value)
}

/**
 * Check if a page is low-signal navigation/listing page.
 */
export function isLowSignalNavigationPage(input: { title?: string; url?: string; text?: string }): boolean {
  const combined = `${String(input.title || "")} ${String(input.text || "")}`.toLowerCase()
  const url = String(input.url || "").toLowerCase()
  const navOnly = /\b(watch|video|videos|podcast|highlights|schedule|standings|top stories|newsletter|subscribe)\b/.test(combined)
  const hasGameSignal = hasRecapSignal(combined)
  const obviousListing = /\/watch|\/video|youtube\.com|spotify\.com|rss\.com|wikihoops\.com/.test(url)

  // Detect category/listing/topic pages
  const categoryPage = /\/(topic|category|tag|section|archive|latest|feed|index)s?\//i.test(url)
  const listingPage = /\/(artificial[-_]?intelligence|ai|tech|science|business|politics|computers?[-_]?math)[\d]*\/?$/i.test(url)
  const newsIndexPage = /\/news\/[a-z_-]+\/[a-z_-]+\/?$/i.test(url) && !/\d{4}|\/\d+\//.test(url)

  // Site tagline patterns
  const siteTagline = /^(explore|discover|browse|find|read)\s+(the\s+)?(latest|our|all|more)/i.test(combined.trim())

  // Detect if content is mostly short lines
  const lines = combined.split(/\n/).filter((l) => l.trim().length > 10)
  const avgLineLength = combined.length / Math.max(lines.length, 1)
  const looksLikeList = lines.length > 5 && avgLineLength < 80

  return (navOnly || obviousListing || categoryPage || listingPage || newsIndexPage || siteTagline || looksLikeList) && !hasGameSignal
}

/**
 * Check if a web search result is usable.
 */
export function isUsableWebResult(item: {
  url?: string
  title?: string
  snippet?: string
  pageText?: string
}): boolean {
  const url = String(item.url || "").trim()
  if (!/^https?:\/\//i.test(url)) return false
  const body = cleanText(String(item.pageText || item.snippet || ""))
  if (body.length < 200) return false
  if (isLowSignalNavigationPage({ title: item.title, url, text: body })) return false
  return true
}

/**
 * Check if a URL is a search engine URL.
 */
export function isSearchEngineUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    if (host.includes("google.") && path === "/search") return true
    if (host.includes("bing.com") && path === "/search") return true
    if (host.includes("duckduckgo.com")) return true
    return false
  } catch {
    return false
  }
}

/**
 * Check if a URL looks like a search URL.
 */
export function isSearchLikeUrl(value: string): boolean {
  const raw = String(value || "").trim()
  if (!raw) return false
  if (!/^https?:\/\//i.test(raw)) return false
  if (isSearchEngineUrl(raw)) return true
  return /[?&]q=/i.test(raw)
}

/**
 * Check if web search context has usable sources.
 */
export function hasWebSearchUsableSources(data: unknown): boolean {
  if (!data || typeof data !== "object") return false
  const mode = String((data as Record<string, unknown>).mode || "")
  if (mode !== "web-search") return false
  const payload = (data as Record<string, unknown>).payload
  if (!payload || typeof payload !== "object") return false
  const results = (payload as Record<string, unknown>).results
  if (!Array.isArray(results)) return false
  return results.some((item) => {
    if (!item || typeof item !== "object") return false
    const row = item as Record<string, unknown>
    return isUsableWebResult({
      url: String(row.url || ""),
      title: String(row.title || ""),
      snippet: String(row.snippet || ""),
      pageText: String(row.pageText || ""),
    })
  })
}
