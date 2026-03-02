/**
 * Web Fetch Utilities
 *
 * Functions for fetching and processing web documents.
 */

import { fetchAndExtractContent } from "@/lib/missions/content/extraction"
import { cleanText, stripHtmlToText } from "../text/cleaning"
import type { WebDocumentResult } from "../types/index"

/**
 * Fetch a web document and extract content using Readability.
 */
export async function fetchWebDocument(
  url: string,
  headers: Record<string, string>,
): Promise<WebDocumentResult> {
  const result = await fetchAndExtractContent(url, { headers, timeout: 15000 })
  return {
    ok: result.ok,
    status: result.status,
    finalUrl: result.finalUrl,
    title: result.title,
    text: result.text,
    links: result.links,
    error: result.error,
  }
}

/**
 * Normalize an extracted href to an absolute URL.
 */
export function normalizeExtractedHref(href: string, baseUrl: string): string {
  const raw = String(href || "").trim()
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return ""
  try {
    const base = new URL(baseUrl)
    const resolved = new URL(raw, base).toString()
    const parsed = new URL(resolved)

    // Handle DuckDuckGo redirect URLs
    if (parsed.hostname.toLowerCase().includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const uddg = (parsed.searchParams.get("uddg") || "").trim()
      if (uddg) {
        try {
          return new URL(uddg).toString()
        } catch {
          return uddg
        }
      }
    }

    // Handle Google redirect URLs
    if (parsed.hostname.toLowerCase().includes("google.") && parsed.pathname === "/url") {
      const q = (parsed.searchParams.get("q") || "").trim()
      if (q) return q
    }

    return resolved
  } catch {
    return ""
  }
}

/**
 * Extract links from HTML.
 */
export function extractHtmlLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const results: Array<{ href: string; text: string }> = []
  const seen = new Set<string>()
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const href = normalizeExtractedHref(match[1], baseUrl)
    if (!href || seen.has(href)) continue
    const text = stripHtmlToText(match[2] || "")
    if (!text) continue
    seen.add(href)
    results.push({ href, text })
    if (results.length >= 30) break
  }
  return results
}

/**
 * Extract search query from URL.
 */
export function extractSearchQueryFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const q = String(parsed.searchParams.get("q") || "").trim()
    return q
  } catch {
    return ""
  }
}

/**
 * Normalize a web search request URL.
 */
export function normalizeWebSearchRequestUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const q = (parsed.searchParams.get("q") || "").trim()
    if (!q) return rawUrl
    if ((host.includes("google.") || host.includes("bing.com")) && parsed.pathname.toLowerCase() === "/search") {
      return `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
    }
  } catch {
    return rawUrl
  }
  return rawUrl
}

/**
 * Derive a web search query from various inputs.
 */
export function deriveWebSearchQuery(input: {
  explicitQuery: string
  url: string
  stepTitle?: string
  workflowDescription?: string
  missionLabel?: string
}): string {
  const direct = String(input.explicitQuery || "").trim()
  if (direct) return direct

  const fromUrl = extractSearchQueryFromUrl(String(input.url || "").trim())
  if (fromUrl) return fromUrl

  const fromStep = cleanText(String(input.stepTitle || "").trim())
  if (fromStep && !/^fetch data$/i.test(fromStep)) return fromStep

  const fromDescription = cleanText(String(input.workflowDescription || "").trim())
  if (fromDescription) return fromDescription.length > 180 ? fromDescription.slice(0, 180) : fromDescription

  const fromLabel = cleanText(String(input.missionLabel || "").trim())
  return fromLabel
}

/**
 * Get the web search provider preference.
 */
export function getWebSearchProviderPreference(): "brave" {
  return "brave"
}
