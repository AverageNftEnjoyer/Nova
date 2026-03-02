/**
 * Web Search Utilities
 *
 * Functions for searching the web using Brave API.
 */

import { cleanText, truncateForModel } from "../text/cleaning"
import { hasHeader } from "../utils/config"
import { fetchWebDocument, getWebSearchProviderPreference } from "./fetch"
import { isLowSignalNavigationPage, isUsableWebResult } from "./quality"
import type { WebSearchResult, WebSearchResponse } from "../types/index"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"

/**
 * Build search query variants for better coverage.
 * Enhanced with topic-specific query strategies.
 */
export function buildSearchQueryVariants(query: string): string[] {
  const base = cleanText(query)
  if (!base) return []
  const variants = new Set<string>([base])

  // Get current date info
  const now = new Date()
  const currentMonth = now.toLocaleString("en-US", { month: "long", year: "numeric" })
  const today = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStr = yesterday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  // Add article-targeting variants
  variants.add(`${base} ${currentMonth}`)

  const noYear = base.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim()
  if (noYear && noYear !== base) {
    variants.add(noYear)
    variants.add(`${noYear} ${currentMonth}`)
  }

  const lower = base.toLowerCase()

  // ─────────────────────────────────────────────────────────────────────────
  // Sports-specific queries
  // ─────────────────────────────────────────────────────────────────────────

  // NBA
  if (/\bnba\b/.test(lower)) {
    if (/\b(last night|yesterday)\b/.test(lower)) {
      variants.add(`NBA scores ${yesterdayStr} final results`)
      variants.add(`NBA games ${yesterdayStr} box scores site:espn.com OR site:nba.com`)
    } else {
      variants.add(`NBA scores ${today} final results`)
      variants.add(`NBA games today scores site:espn.com OR site:nba.com`)
    }
    variants.add("NBA scores recap highlights site:espn.com OR site:nba.com OR site:bleacherreport.com")
  }

  // NFL
  if (/\bnfl\b/.test(lower)) {
    variants.add(`NFL scores ${currentMonth} game results`)
    variants.add(`NFL scores recap site:espn.com OR site:nfl.com`)
  }

  // MLB
  if (/\bmlb\b/.test(lower)) {
    variants.add(`MLB scores ${today} game results`)
    variants.add(`MLB scores recap site:espn.com OR site:mlb.com`)
  }

  // Generic sports
  if (/\b(sports?|scores?|games?)\b/.test(lower) && !/\b(nba|nfl|mlb|nhl)\b/.test(lower)) {
    variants.add(`sports scores ${today} site:espn.com OR site:sports.yahoo.com`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Market/Finance queries
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(market|stock|stocks|trading|s&p|dow|nasdaq)\b/.test(lower)) {
    variants.add(`stock market news ${today} S&P 500 Dow Jones`)
    variants.add(`market update ${today} site:reuters.com OR site:bloomberg.com OR site:cnbc.com`)
    variants.add(`stock market recap ${currentMonth} major indexes`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Crypto queries
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(crypto|bitcoin|btc|ethereum|eth|cryptocurrency)\b/.test(lower)) {
    variants.add(`cryptocurrency news ${today} Bitcoin Ethereum prices`)
    variants.add(`crypto market update ${currentMonth} site:coindesk.com OR site:cointelegraph.com`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Motivational quotes
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(motivational?|inspirational?|quote|quotes|wisdom)\b/.test(lower)) {
    variants.add(`motivational quote of the day ${today}`)
    variants.add(`inspirational quote daily site:brainyquote.com OR site:goodreads.com`)
    variants.add(`motivational quotes ${currentMonth}`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tech/AI queries
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(ai|artificial intelligence|tech|technology)\b/.test(lower)) {
    variants.add(`technology news ${today} announcements`)
    variants.add(`AI news ${currentMonth} site:techcrunch.com OR site:theverge.com OR site:wired.com`)
    variants.add(`tech news latest ${currentMonth} breakthroughs`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // News/Headlines queries
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(news|headlines?|current events?|breaking)\b/.test(lower)) {
    variants.add(`top news headlines ${today}`)
    variants.add(`breaking news ${today} site:apnews.com OR site:reuters.com OR site:bbc.com`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Weather queries
  // ─────────────────────────────────────────────────────────────────────────

  if (/\b(weather|forecast|temperature)\b/.test(lower)) {
    // Try to extract city name
    const cityMatch = lower.match(/weather\s+(?:in|for|at)?\s*([a-z\s]+?)(?:\s|$)/i)
    if (cityMatch) {
      const city = cityMatch[1].trim()
      variants.add(`${city} weather forecast today`)
      variants.add(`${city} weather ${today}`)
    } else {
      variants.add(`weather forecast today`)
    }
  }

  return Array.from(variants).filter(Boolean).slice(0, 8)
}

/**
 * Search using Brave API.
 */
export async function searchWithBrave(
  query: string,
  headers: Record<string, string>,
  apiKey: string,
): Promise<WebSearchResponse | null> {
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
  scope?: IntegrationsStoreScope,
): Promise<WebSearchResponse> {
  const preferred = getWebSearchProviderPreference()
  const queryVariants = buildSearchQueryVariants(query)
  let braveApiKey = ""

  if (scope) {
    try {
      const integrations = await loadIntegrationsConfig(scope)
      if (integrations.brave.connected && integrations.brave.apiKey.trim().length > 0) {
        braveApiKey = integrations.brave.apiKey.trim()
      }
    } catch {
      // Keep fallback behavior below.
    }
  }

  if (!braveApiKey) {
    braveApiKey = String(
      process.env.BRAVE_API_KEY || process.env.NOVA_WEB_SEARCH_API_KEY || process.env.MYAGENT_WEB_SEARCH_API_KEY || "",
    ).trim()
  }

  if (!braveApiKey) {
    return {
      searchUrl: `https://search.brave.com/search?q=${encodeURIComponent(queryVariants[0] || query)}`,
      query,
      searchTitle: "Brave Search (API key missing)",
      searchText: "Brave API key is missing. Add one in Integrations to improve web search coverage and reliability.",
      provider: "brave-unconfigured",
      results: [],
    }
  }

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
      const found = await searchWithBrave(variant, headers, braveApiKey)
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

  // Always try Brave when an API key is available regardless of provider
  // preference — the preference is advisory, not a gate. Without this, any
  // non-"brave" preference value silently returns zero results.
  if (preferred === "brave" || braveApiKey) {
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
