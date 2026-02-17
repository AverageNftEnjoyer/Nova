/**
 * Text Cleaning Utilities
 *
 * Functions for cleaning and sanitizing text from various sources.
 */

/**
 * Clean text by normalizing whitespace.
 */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Strip navigation noise from scraped web text.
 */
export function stripNavigationNoise(value: string): string {
  let text = String(value || "")
  text = text
    .replace(/\b(skip navigation|navigation toggle|all-star home|home tickets|open menu|close menu|sign in to continue|submit search)\b/gi, " ")
    .replace(/\b(news|scores|highlights|stats|standings|rumors)\b\s*(\||-)\s*\b(bleacher report|nbc sports|nba)\b/gi, " ")
    .replace(/\b(mlb|nfl|nhl|ncaa|premier league|horse racing|nascar)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
  return cleanText(text)
}

/**
 * Aggressively clean scraped web text before fact extraction.
 * Removes navigation junk, photo credits, timestamps without context, etc.
 */
export function cleanScrapedText(text: string): string {
  if (!text) return ""
  return text
    // Remove photo/image credits
    .replace(/\b(Image|Photo|Video|Credit)[s]?:?\s*[A-Za-z0-9\s,./]+(?:Getty|Reuters|AP|AFP|Images?|Photos?)\b/gi, "")
    .replace(/By\s+Credit[A-Za-z\s]+/gi, "")
    .replace(/\(Getty Images?\)/gi, "")
    .replace(/\(Reuters\)/gi, "")
    .replace(/\(AP Photo[^)]*\)/gi, "")
    // Remove "Read more", "Continue reading", etc.
    .replace(/\bRead (more|full story|article)\b[→\s]*/gi, "")
    .replace(/\bContinue reading\b[→\s]*/gi, "")
    .replace(/\bSee (more|also)\b[→\s]*/gi, "")
    .replace(/\bLearn more\b[→\s]*/gi, "")
    .replace(/\bClick here\b[→\s]*/gi, "")
    // Remove standalone timestamps
    .replace(/^\s*(\d{1,2}\s*(hours?|minutes?|days?)\s*ago|Today|Yesterday)\s*$/gmi, "")
    // Remove malformed dates at start of lines
    .replace(/^\s*\d{1,2},\s*\d{4}\s*/gm, "")
    // Remove navigation patterns
    .replace(/\b(Home|About|Contact|Subscribe|Sign up|Log in|Menu)\s*[|>→]/gi, "")
    // Remove social sharing prompts
    .replace(/\b(Share|Tweet|Pin|Email) (this|on|via)\b[^.]*\.?/gi, "")
    // Remove newsletter prompts
    .replace(/\b(Subscribe to|Sign up for|Get) (our|the)? ?newsletter\b[^.]*\.?/gi, "")
    // Fix concatenated table data (e.g., "49,501-1.2%3.0%" -> remove as junk)
    .replace(/[\d,]+\.?\d*[-+]?\d+\.?\d*%[-+]?\d+\.?\d*%/g, "")
    // Fix concatenated numbers with percentages (e.g., "6,836-1.4%-0.1%")
    .replace(/\d{1,3}(,\d{3})*[-+]\d+\.\d+%[-+]?\d+\.\d+%/g, "")
    // Remove raw stock ticker data patterns (AAPL123.45+1.2%)
    .replace(/\b[A-Z]{1,5}\d+\.?\d*[+-]\d+\.?\d*%/g, "")
    // Remove YTD/MTD style headers concatenated with data
    .replace(/\b(YTD|MTD|QTD|1Y|5Y|10Y)[A-Z][a-z]+/g, " ")
    // Add space between word and number when concatenated (e.g., "Average49,501")
    .replace(/([a-zA-Z])(\d{1,3}(?:,\d{3})+)/g, "$1 $2")
    // Add space between number and word (e.g., "49,501Dow")
    .replace(/(\d)([A-Z][a-z])/g, "$1 $2")
    // Clean up concatenated headlines
    .replace(/([a-z])([A-Z])/g, "$1. $2")
    .replace(/(\.)([A-Z])/g, "$1 $2")
    // Remove excessive punctuation
    .replace(/\.{2,}/g, ".")
    .replace(/\s*\.\s*\./g, ".")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim()
}

/**
 * Detect if text is mostly raw table/spreadsheet data (not readable prose).
 * Returns true if text appears to be junk data that shouldn't go to AI.
 */
export function isRawTableData(text: string): boolean {
  if (!text || text.length < 20) return false
  const cleaned = text.trim()

  // Count percentage signs - tables have many
  const percentCount = (cleaned.match(/%/g) || []).length
  const wordCount = cleaned.split(/\s+/).length
  if (percentCount > wordCount * 0.3) return true

  // Check for concatenated number patterns
  const concatenatedNumbers = cleaned.match(/\d{1,3}(,\d{3})*[-+]\d/g) || []
  if (concatenatedNumbers.length > 3) return true

  // Check for ticker-like patterns (all caps followed by numbers)
  const tickerPatterns = cleaned.match(/\b[A-Z]{2,5}\d/g) || []
  if (tickerPatterns.length > 3) return true

  // Check ratio of numbers to text - tables are number-heavy
  const numbers = cleaned.match(/\d+/g) || []
  const letters = cleaned.match(/[a-zA-Z]+/g) || []
  if (numbers.length > letters.length * 2) return true

  return false
}

/**
 * Extract readable sentences from text, filtering out junk.
 * Returns only sentences that look like actual prose content.
 */
export function extractReadableSentences(text: string): string[] {
  if (!text) return []

  // First clean the text
  const cleaned = cleanScrapedText(text)
  if (isRawTableData(cleaned)) return []

  // Split into sentences
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => {
      // Must be at least 30 chars
      if (s.length < 30) return false
      // Must have more letters than numbers
      const letters = (s.match(/[a-zA-Z]/g) || []).length
      const numbers = (s.match(/\d/g) || []).length
      if (numbers > letters) return false
      // Must have at least 4 words
      const words = s.split(/\s+/).length
      if (words < 4) return false
      // Must not be mostly percentages
      const percents = (s.match(/%/g) || []).length
      if (percents > 2) return false
      return true
    })

  return sentences
}

/**
 * Strip HTML tags and convert to plain text.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return ""
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
  return cleanText(text)
}

/**
 * Strip JSON code fences from text.
 */
export function stripCodeFences(raw: string): string {
  const text = raw.trim()
  const block = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return block ? block[1].trim() : text
}

/**
 * Parse a JSON object from raw text, handling code fences.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripCodeFences(raw)
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Normalize a snippet title and text combination.
 */
export function normalizeSourceSnippet(title: string, snippet: string): string {
  const normalizedTitle = cleanText(title)
  const normalizedSnippet = stripNavigationNoise(snippet)
  if (!normalizedSnippet) return ""
  if (!normalizedTitle) return normalizedSnippet
  const lowerTitle = normalizedTitle.toLowerCase()
  const lowerSnippet = normalizedSnippet.toLowerCase()
  if (lowerSnippet.startsWith(lowerTitle)) {
    return cleanText(normalizedSnippet.slice(normalizedTitle.length))
  }
  return normalizedSnippet
}

/**
 * Normalize snippet text with length limit.
 */
export function normalizeSnippetText(value: string, limit = 220): string {
  const cleaned = cleanText(
    String(value || "")
      .replace(/\|/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/\[\s*\.\.\.\s*\]/g, " ")
      .trim(),
  )
  if (!cleaned) return ""
  return truncateAtWordBoundary(cleaned, limit)
}

/**
 * Truncate text at word boundary with ellipsis.
 */
export function truncateAtWordBoundary(value: string, limit: number): string {
  const text = cleanText(String(value || ""))
  if (!text || text.length <= limit) return text
  const softSlice = text.slice(0, Math.max(limit + 1, 1))
  const punctuationCut = Math.max(
    softSlice.lastIndexOf(". "),
    softSlice.lastIndexOf("; "),
    softSlice.lastIndexOf(", "),
    softSlice.lastIndexOf(" "),
  )
  const cut = punctuationCut >= Math.floor(limit * 0.6) ? punctuationCut : limit
  return `${softSlice.slice(0, cut).trim()}...`
}

/**
 * Truncate text for model input.
 */
export function truncateForModel(text: string, limit = 8000): string {
  const normalized = cleanText(text)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

/**
 * Extract title from HTML.
 */
export function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? cleanText(match[1]) : ""
}
