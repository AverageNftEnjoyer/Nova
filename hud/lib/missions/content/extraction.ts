/**
 * content-extraction.ts
 *
 * Unified content extraction module using Mozilla Readability for proper
 * article extraction. Replaces the regex-based approach that only captured
 * headlines instead of full article content.
 */

import { Readability } from "@mozilla/readability"
import { JSDOM, VirtualConsole } from "jsdom"
import TurndownService from "turndown"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

function createSilentDom(html: string, url: string): JSDOM {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    const message = String(error?.message || "")
    if (/Could not parse CSS stylesheet/i.test(message)) return
    console.warn(message)
  })
  return new JSDOM(html, { url, virtualConsole })
}

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedContent {
  title: string
  text: string
  markdown: string
  excerpt: string
  byline: string | null
  siteName: string | null
  wordCount: number
  quality: ContentQuality
}

export interface ContentQuality {
  score: number // 0-100
  hasArticleStructure: boolean
  hasSubstantialContent: boolean
  contentType: "article" | "listing" | "navigation" | "unknown"
}

export interface ExtractedFact {
  sentence: string
  relevance: number // 0-1
  type: "statistic" | "quote" | "event" | "claim" | "definition" | "general"
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract article content from HTML using Mozilla Readability.
 * This is the main function that should replace extractPrimaryHtmlText().
 */
export function extractArticleContent(
  html: string,
  sourceUrl?: string
): ExtractedContent {
  if (!html || typeof html !== "string") {
    return createEmptyContent()
  }

  try {
    // Create DOM from HTML
    const dom = createSilentDom(html, sourceUrl || "https://example.com")
    const document = dom.window.document

    // Remove unwanted elements before Readability processes
    removeUnwantedElements(document)

    // Clone document for Readability (it modifies the DOM)
    const documentClone = document.cloneNode(true) as Document

    // Extract with Readability
    const reader = new Readability(documentClone, {
      charThreshold: 100,
      classesToPreserve: ["article", "post", "content", "entry"],
    })
    const article = reader.parse()

    if (article && article.textContent && article.textContent.length > 200) {
      // Successful Readability extraction
      const turndown = new TurndownService({ headingStyle: "atx" })
      const markdown = article.content
        ? turndown.turndown(article.content)
        : article.textContent

      const text = cleanText(article.textContent)
      const quality = assessContentQuality(text, true)

      return {
        title: cleanText(article.title || document.title || ""),
        text,
        markdown: cleanMarkdown(markdown),
        excerpt: cleanText(article.excerpt || ""),
        byline: article.byline || null,
        siteName: article.siteName || null,
        wordCount: countWords(text),
        quality,
      }
    }

    // Fallback: Try extracting from common content containers
    const fallbackText = extractFallbackContent(document)
    const quality = assessContentQuality(fallbackText, false)

    return {
      title: cleanText(document.title || ""),
      text: fallbackText,
      markdown: fallbackText,
      excerpt: fallbackText.slice(0, 300),
      byline: null,
      siteName: null,
      wordCount: countWords(fallbackText),
      quality,
    }
  } catch (error) {
    // Ultimate fallback: basic regex stripping
    const basicText = stripHtmlTags(html)
    return {
      title: "",
      text: basicText,
      markdown: basicText,
      excerpt: basicText.slice(0, 300),
      byline: null,
      siteName: null,
      wordCount: countWords(basicText),
      quality: {
        score: 10,
        hasArticleStructure: false,
        hasSubstantialContent: basicText.length > 500,
        contentType: "unknown",
      },
    }
  }
}

// ============================================================================
// GENERIC FACT EXTRACTION (Not sports-specific)
// ============================================================================

/**
 * Extract important facts/sentences from text content.
 * Works with ANY content type: news, tech, finance, sports, etc.
 */
export function extractImportantFacts(
  text: string,
  limit = 5
): ExtractedFact[] {
  if (!text || typeof text !== "string") return []

  const cleaned = cleanText(text)
  const sentences = splitIntoSentences(cleaned)
  const scored: ExtractedFact[] = []

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length < 30 || trimmed.length > 400) continue

    const { score, type } = scoreSentence(trimmed)
    if (score >= 0.3) {
      scored.push({
        sentence: truncateAtWordBoundary(trimmed, 250),
        relevance: score,
        type,
      })
    }
  }

  // Sort by relevance and return top results
  return scored
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
}

/**
 * Score a sentence for importance/relevance.
 * Returns score (0-1) and detected type.
 */
function scoreSentence(sentence: string): {
  score: number
  type: ExtractedFact["type"]
} {
  let score = 0.3 // Base score
  let type: ExtractedFact["type"] = "general"

  // STATISTICS & NUMBERS (high value)
  // Percentages, currency, measurements, dates with numbers
  if (/\d+%|\$[\d,.]+|\d+\s*(million|billion|thousand|percent)/i.test(sentence)) {
    score += 0.35
    type = "statistic"
  }
  // Specific numeric data (scores, rankings, quantities)
  else if (/\b\d{1,3}[,.]?\d*\s*(points?|goals?|votes?|users?|downloads?|sales?|units?)/i.test(sentence)) {
    score += 0.3
    type = "statistic"
  }
  // Year references with context
  else if (/\b(in|since|by|from)\s+\d{4}\b/i.test(sentence)) {
    score += 0.15
  }

  // QUOTES (high value - attributed statements)
  if (/[""].*[""]/.test(sentence) || /\bsaid\b|\baccording to\b|\bstated\b|\bannounced\b/i.test(sentence)) {
    score += 0.25
    if (type === "general") type = "quote"
  }

  // EVENTS & NEWS (medium-high value)
  const eventPatterns = [
    /\b(announced|launched|released|unveiled|introduced|acquired|merged|filed|reported)\b/i,
    /\b(signed|appointed|resigned|fired|hired|promoted)\b/i,
    /\b(won|lost|beat|defeated|advanced|qualified|eliminated)\b/i,
    /\b(discovered|invented|developed|created|built|designed)\b/i,
    /\b(passed|enacted|signed into law|approved|rejected|vetoed)\b/i,
  ]
  for (const pattern of eventPatterns) {
    if (pattern.test(sentence)) {
      score += 0.2
      if (type === "general") type = "event"
      break
    }
  }

  // CLAIMS & ASSERTIONS (medium value)
  const claimPatterns = [
    /\b(found that|study shows|research indicates|data suggests|evidence shows)\b/i,
    /\b(is expected to|is projected to|will likely|may|could|should)\b/i,
    /\b(the first|the largest|the most|record-breaking|unprecedented)\b/i,
    /\b(increased|decreased|grew|fell|rose|dropped|surged|plunged)\s+by?\s+\d/i,
  ]
  for (const pattern of claimPatterns) {
    if (pattern.test(sentence)) {
      score += 0.15
      if (type === "general") type = "claim"
      break
    }
  }

  // DEFINITIONS & EXPLANATIONS (medium value)
  if (/\b(is defined as|refers to|means that|is known as|is called)\b/i.test(sentence)) {
    score += 0.15
    if (type === "general") type = "definition"
  }

  // ENTITY DENSITY (named entities indicate importance)
  // Capital words that aren't at sentence start
  const capitalWords = sentence.slice(1).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []
  score += Math.min(capitalWords.length * 0.05, 0.15)

  // PENALIZE low-signal patterns
  const lowSignalPatterns = [
    /\b(click here|read more|subscribe|sign up|follow us|share this)\b/i,
    /\b(read full story|view article|continue reading|see more|learn more)\b/i,
    /\b(cookie|privacy policy|terms of service|copyright)\b/i,
    /\b(menu|navigation|sidebar|footer|header|banner)\b/i,
    /^\s*(home|about|contact|search|login|register)\s*$/i,
    /\b(loading|please wait|javascript required)\b/i,
    /^(explore|discover|browse)\s+(the\s+)?(latest|our|more)/i,  // Site taglines
    /\bwith\s+(reuters|ap|cnn|bbc|nyt)\b.*\bfrom\b/i,  // "Explore X with Reuters - from..."
  ]
  for (const pattern of lowSignalPatterns) {
    if (pattern.test(sentence)) {
      score -= 0.4
      break
    }
  }

  // PENALIZE very short or question-only sentences
  if (sentence.length < 50) score -= 0.1
  if (sentence.endsWith("?") && !sentence.includes("said")) score -= 0.15

  return {
    score: Math.max(0, Math.min(1, score)),
    type,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function removeUnwantedElements(document: Document): void {
  const selectorsToRemove = [
    "script",
    "style",
    "iframe",
    "noscript",
    "svg",
    "nav",
    "header",
    "footer",
    "aside",
    ".sidebar",
    ".navigation",
    ".nav",
    ".menu",
    ".footer",
    ".header",
    ".advertisement",
    ".ad",
    ".ads",
    ".social-share",
    ".comments",
    ".related-posts",
    ".cookie-notice",
    ".popup",
    ".modal",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[aria-hidden='true']",
  ]

  for (const selector of selectorsToRemove) {
    try {
      document.querySelectorAll(selector).forEach((el) => el.remove())
    } catch {
      // Ignore invalid selectors
    }
  }
}

function extractFallbackContent(document: Document): string {
  // Try common content containers in order of preference
  const contentSelectors = [
    "article",
    "[role='main']",
    "main",
    ".article-content",
    ".post-content",
    ".entry-content",
    ".content",
    ".story-body",
    "#content",
    "#main",
  ]

  for (const selector of contentSelectors) {
    try {
      const element = document.querySelector(selector)
      if (element) {
        const text = cleanText(element.textContent || "")
        if (text.length > 200) {
          return text
        }
      }
    } catch {
      // Ignore selector errors
    }
  }

  // Ultimate fallback: body text
  const bodyText = cleanText(document.body?.textContent || "")
  return bodyText
}

function assessContentQuality(
  text: string,
  hadArticleStructure: boolean
): ContentQuality {
  const wordCount = countWords(text)
  const hasSubstantialContent = wordCount > 100

  // Detect content type
  let contentType: ContentQuality["contentType"] = "unknown"
  const lower = text.toLowerCase()

  // Navigation pages have lots of short items
  const lines = text.split(/\n/).filter((l) => l.trim())
  const avgLineLength = text.length / Math.max(lines.length, 1)
  if (avgLineLength < 30 && lines.length > 10) {
    contentType = "navigation"
  } else if (hadArticleStructure && wordCount > 200) {
    contentType = "article"
  } else if (/\b(results?|items?|products?|list)\b/i.test(lower.slice(0, 200))) {
    contentType = "listing"
  }

  // Calculate quality score
  let score = 0
  if (hadArticleStructure) score += 30
  if (hasSubstantialContent) score += 20
  if (wordCount > 300) score += 15
  if (wordCount > 500) score += 10
  if (contentType === "article") score += 15
  if (contentType === "navigation") score -= 20
  if (contentType === "listing") score -= 10

  return {
    score: Math.max(0, Math.min(100, score)),
    hasArticleStructure: hadArticleStructure,
    hasSubstantialContent,
    contentType,
  }
}

function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries, handling abbreviations
  return text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function countWords(text: string): number {
  return (text.match(/\b\w+\b/g) || []).length
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim()
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/gm, "")
    .trim()
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(" ")
  return lastSpace > maxLength * 0.7
    ? truncated.slice(0, lastSpace) + "..."
    : truncated + "..."
}

function createEmptyContent(): ExtractedContent {
  return {
    title: "",
    text: "",
    markdown: "",
    excerpt: "",
    byline: null,
    siteName: null,
    wordCount: 0,
    quality: {
      score: 0,
      hasArticleStructure: false,
      hasSubstantialContent: false,
      contentType: "unknown",
    },
  }
}

// ============================================================================
// WEB DOCUMENT FETCHING (replaces fetchWebDocument in runtime.ts)
// ============================================================================

export interface FetchedDocument {
  ok: boolean
  status: number
  finalUrl: string
  title: string
  text: string
  markdown: string
  excerpt: string
  quality: ContentQuality
  links: Array<{ href: string; text: string }>
  error?: string
}

/**
 * Fetch a URL and extract its content using Readability.
 * This should replace fetchWebDocument() in runtime.ts.
 */
export async function fetchAndExtractContent(
  url: string,
  options?: {
    timeout?: number
    headers?: Record<string, string>
  }
): Promise<FetchedDocument> {
  const timeout = options?.timeout || 15000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options?.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    })

    const finalUrl = response.url || url
    const contentType = response.headers.get("content-type") || ""

    // Handle JSON responses
    if (contentType.includes("application/json")) {
      const json = await response.json().catch(() => ({}))
      const text = JSON.stringify(json, null, 2).slice(0, 10000)
      return {
        ok: response.ok,
        status: response.status,
        finalUrl,
        title: finalUrl,
        text,
        markdown: "```json\n" + text + "\n```",
        excerpt: text.slice(0, 300),
        quality: {
          score: 50,
          hasArticleStructure: false,
          hasSubstantialContent: text.length > 200,
          contentType: "unknown",
        },
        links: [],
      }
    }

    // Handle HTML
    const html = await response.text()
    const extracted = extractArticleContent(html, finalUrl)
    const links = extractLinks(html, finalUrl)

    return {
      ok: response.ok,
      status: response.status,
      finalUrl,
      title: extracted.title,
      text: extracted.text.slice(0, 12000),
      markdown: extracted.markdown.slice(0, 12000),
      excerpt: extracted.excerpt,
      quality: extracted.quality,
      links,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      title: url,
      text: "",
      markdown: "",
      excerpt: "",
      quality: {
        score: 0,
        hasArticleStructure: false,
        hasSubstantialContent: false,
        contentType: "unknown",
      },
      links: [],
      error: error instanceof Error ? error.message : "Fetch failed",
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Extract links from HTML.
 */
function extractLinks(
  html: string,
  baseUrl: string
): Array<{ href: string; text: string }> {
  const results: Array<{ href: string; text: string }> = []
  const seen = new Set<string>()

  try {
    const dom = createSilentDom(html, baseUrl)
    const document = dom.window.document

    document.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href")
      if (!href) return

      try {
        const resolved = new URL(href, baseUrl).toString()
        if (seen.has(resolved)) return
        if (!resolved.startsWith("http")) return

        const text = cleanText(anchor.textContent || "").slice(0, 100)
        if (!text) return

        seen.add(resolved)
        results.push({ href: resolved, text })
      } catch {
        // Invalid URL
      }
    })
  } catch {
    // Fallback to regex
    const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = regex.exec(html)) !== null && results.length < 30) {
      try {
        const href = new URL(match[1], baseUrl).toString()
        if (seen.has(href) || !href.startsWith("http")) continue
        const text = cleanText(stripHtmlTags(match[2])).slice(0, 100)
        if (!text) continue
        seen.add(href)
        results.push({ href, text })
      } catch {
        // Invalid URL
      }
    }
  }

  return results.slice(0, 30)
}
