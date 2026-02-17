/**
 * Web Search Utilities
 *
 * Functions for searching the web using Brave API.
 */

import { cleanText, truncateForModel } from "../text/cleaning"
import { hasHeader } from "../utils/config"
import { fetchWebDocument, getWebSearchProviderPreference } from "./fetch"
import { isLowSignalNavigationPage, isUsableWebResult } from "./quality"
import type { WebSearchResult, WebSearchResponse } from "../types"

/**
 * Build search query variants for better coverage.
 */
export function buildSearchQueryVariants(query: string): string[] {
  const base = cleanText(query)
  if (!base) return []
  const variants = new Set<string>([base])

  // Add article-targeting variants
  const currentMonth = new Date().toLocaleString("en-US", { month: "long", year: "numeric" })
  variants.add(`${base} ${currentMonth}`)
  variants.add(`${base} article`)

  const noYear = base.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim()
  if (noYear && noYear !== base) {
    variants.add(noYear)
    variants.add(`${noYear} ${currentMonth}`)
  }

  const lower = base.toLowerCase()

  // AI/tech queries
  if (/\b(ai|artificial intelligence|tech|technology)\b/.test(lower) && /\b(news|latest|updates|breakthroughs?)\b/.test(lower)) {
    variants.add(`${base} site:techcrunch.com OR site:theverge.com OR site:arstechnica.com OR site:wired.com`)
    variants.add(`${base} announced OR released OR launched ${currentMonth}`)
  }

  // Sports queries
  if (/\bnba\b/.test(lower) && /\b(last night|recap|scores|games)\b/.test(lower)) {
    variants.add("nba games last night final scores site:nba.com OR site:espn.com OR site:apnews.com OR site:reuters.com")
    variants.add("nba recap last night final score box score")
  }

  return Array.from(variants).filter(Boolean).slice(0, 6)
}

/**
 * Search using Brave API.
 */
export async function searchWithBrave(
  query: string,
  headers: Record<string, string>,
): Promise<WebSearchResponse | null> {
  const apiKey = String(
    process.env.BRAVE_API_KEY || process.env.NOVA_WEB_SEARCH_API_KEY || process.env.MYAGENT_WEB_SEARCH_API_KEY || "",
  ).trim()
  if (!apiKey) return null

  try {
    const searchUrl = new URL("https://api.search.brave.com/res/v1/web/search")
    searchUrl.searchParams.set("q", query)
    searchUrl.searchParams.set("count", "8")
    const res = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      cache: "no-store",
    })

    const payload = await res.json().catch(() => ({})) as {
      web?: {
        results?: Array<{ url?: string; title?: string; description?: string }>
      }
    }
    if (!res.ok || !Array.isArray(payload.web?.results)) return null

    const top: WebSearchResult[] = payload.web.results
      .map((item) => {
        const url = String(item.url || "").trim()
        const title = cleanText(String(item.title || "").trim()) || url
        const snippet = cleanText(String(item.description || "").trim()).slice(0, 280)
        if (!url) return null
        return {
          url,
          title,
          snippet,
          ok: snippet.length > 0,
          status: 200,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 8)

    if (top.length === 0) return null

    // Deepen retrieval: pull direct page content
    const enriched = await Promise.all(top.map(async (item) => {
      const doc = await fetchWebDocument(item.url, {
        ...headers,
        ...(hasHeader(headers, "Accept")
          ? {}
          : { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }),
        ...(hasHeader(headers, "User-Agent")
          ? {}
          : { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" }),
      })
      const mergedText = truncateForModel(
        (String(doc.text || "").length > String(item.snippet || "").length
          ? String(doc.text || "")
          : String(item.snippet || "")),
        10000,
      )
      return {
        ...item,
        snippet: cleanText(mergedText).slice(0, 280),
        ok: item.ok || doc.ok,
        status: doc.status || item.status,
        pageTitle: doc.title || item.pageTitle,
        pageText: mergedText,
        error: doc.error || item.error,
      }
    }))

    const results = enriched
      .filter((item) => !isLowSignalNavigationPage({ title: item.title, url: item.url, text: item.pageText || item.snippet }))
      .slice(0, 6)

    return {
      searchUrl: `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
      query,
      searchTitle: "Brave Search",
      searchText: results.map((item) => `${item.title} ${item.snippet}`).join(" "),
      provider: "brave",
      results,
    }
  } catch {
    return null
  }
}

/**
 * Search web and collect results with multiple query variants.
 */
export async function searchWebAndCollect(
  query: string,
  headers: Record<string, string>,
): Promise<WebSearchResponse> {
  const preferred = getWebSearchProviderPreference()
  const queryVariants = buildSearchQueryVariants(query)

  const collectFromProvider = async (): Promise<WebSearchResponse | null> => {
    const merged: WebSearchResult[] = []
    const seen = new Set<string>()
    let selected: {
      searchUrl: string
      query: string
      searchTitle: string
      searchText: string
      provider: string
    } | null = null

    for (const variant of queryVariants) {
      const found = await searchWithBrave(variant, headers)
      if (!found) continue
      if (!selected) {
        selected = {
          searchUrl: found.searchUrl,
          query: found.query,
          searchTitle: found.searchTitle,
          searchText: found.searchText,
          provider: found.provider,
        }
      }
      for (const row of found.results) {
        const key = String(row.url || "").trim()
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push(row)
        if (merged.length >= 10) break
      }
      const usableCount = merged.filter((item) => isUsableWebResult(item)).length
      if (usableCount >= 4 || merged.length >= 10) break
    }

    if (!selected || merged.length === 0) return null
    return {
      ...selected,
      results: merged,
    }
  }

  if (preferred === "brave") {
    const brave = await collectFromProvider()
    if (brave && brave.results.length > 0) return brave
  }

  // Fallback response
  return {
    searchUrl: `https://search.brave.com/search?q=${encodeURIComponent(queryVariants[0] || query)}`,
    query,
    searchTitle: "Brave Search",
    searchText: "",
    provider: "brave",
    results: [],
  }
}
