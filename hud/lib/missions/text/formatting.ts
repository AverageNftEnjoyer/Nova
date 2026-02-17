/**
 * Text Formatting Utilities
 *
 * Functions for formatting text for output (notifications, etc.).
 */

import { cleanText, cleanScrapedText, stripNavigationNoise } from "./cleaning"
import { extractImportantFacts } from "@/lib/missions/content/extraction"

/**
 * Format text for Telegram/Discord notification output.
 * - Converts markdown bold (**text**) to HTML bold (<b>text</b>)
 * - Converts <strong> tags to <b> tags
 * - Decodes HTML entities (&#x27; -> ', etc.)
 * - Cleans up formatting issues
 */
export function formatNotificationText(text: string): string {
  if (!text) return ""
  let output = text
    // Decode HTML entities
    .replace(/&#x27;/gi, "'")
    .replace(/&#x22;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    // Convert markdown headings to bold lines for channels that do not render markdown headings
    .replace(/^#{1,6}\s+(.+)$/gim, "<b>$1</b>")
    // Remove navigation junk
    .replace(/Image Credits?:?\s*[A-Za-z0-9\s,./]+(?:Getty|Reuters|AP|Images?)/gi, "")
    .replace(/By\s+Credit[A-Za-z\s]+/gi, "")
    .replace(/\(Getty Images?\)/gi, "")
    .replace(/\bRead (more|full story|article)\b[→\s]*/gi, "")
    .replace(/\bContinue reading\b[→\s]*/gi, "")
    // Fix concatenated headlines (add line break)
    .replace(/([a-z])([A-Z][a-z]+\s+[A-Z])/g, "$1\n\n- $2")
    // Convert <strong> to <b> for Telegram HTML mode
    .replace(/<strong>/gi, "<b>")
    .replace(/<\/strong>/gi, "</b>")
    // Convert markdown bold **text** to HTML bold <b>text</b>
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    // Clean up any remaining HTML tags that Telegram doesn't support
    .replace(/<(?!\/?(?:b|i|u|s|a|code|pre)\b)[^>]+>/gi, "")

  // Ensure each bullet point is on its own line
  output = output
    .split(/(?=^- |\n- )/m)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n")

  // Final cleanup
  return output
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/gm, "")
    .trim()
}

/**
 * Generate a short mission title (2-5 words) from a longer description.
 */
export function generateShortTitle(description: string): string {
  const text = cleanText(description).toLowerCase()
  if (!text) return "Mission Report"

  // Common topic keywords to extract
  const topics: Array<{ pattern: RegExp; title: string }> = [
    { pattern: /\b(ai|artificial intelligence)\b.*\b(news|update|summary|report)/i, title: "AI Daily Report" },
    { pattern: /\b(ai|artificial intelligence)\b/i, title: "AI Update" },
    { pattern: /\bnba\b.*\b(score|recap|game)/i, title: "NBA Scores" },
    { pattern: /\bnfl\b.*\b(score|recap|game)/i, title: "NFL Scores" },
    { pattern: /\bmlb\b.*\b(score|recap|game)/i, title: "MLB Scores" },
    { pattern: /\b(crypto|bitcoin|ethereum)\b.*\b(price|alert|monitor)/i, title: "Crypto Monitor" },
    { pattern: /\b(stock|market)\b.*\b(price|alert|monitor|update)/i, title: "Market Watch" },
    { pattern: /\bweather\b/i, title: "Weather Update" },
    { pattern: /\bnews\b.*\b(summary|digest|update)/i, title: "News Digest" },
    { pattern: /\btech\b.*\b(news|update)/i, title: "Tech News" },
    { pattern: /\b(morning|daily)\b.*\b(brief|summary|report)/i, title: "Daily Brief" },
  ]

  for (const { pattern, title } of topics) {
    if (pattern.test(text)) return title
  }

  // Fallback: Extract first few meaningful words
  const words = text
    .replace(/\b(give|get|send|me|a|an|the|and|or|of|for|with|my|daily|latest|please|i want|i need)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)

  if (words.length === 0) return "Mission Report"

  // Capitalize each word
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  return title.length > 30 ? title.slice(0, 30).trim() : title
}

/**
 * Extract fact sentences from text.
 */
export function extractFactSentences(value: string, limit = 3): string[] {
  const text = cleanScrapedText(stripNavigationNoise(value))
  if (!text) return []

  const facts = extractImportantFacts(text, limit)
  return facts.map((f) => cleanScrapedText(f.sentence))
}

/**
 * Extract URLs from text.
 */
export function extractUrlsFromText(value: string): string[] {
  const matches = String(value || "").match(/https?:\/\/[^\s)]+/gi) || []
  return matches
    .map((raw) => raw.trim().replace(/[),.;]+$/g, ""))
    .filter(Boolean)
}
