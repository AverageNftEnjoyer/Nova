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
 * Generate a short mission title (3 words) from a longer description.
 */
export function generateShortTitle(description: string): string {
  const text = cleanText(description).toLowerCase()
  if (!text) return "Mission Report"

  const normalized = text
    .replace(/\bwake[\s-]+up\b/g, "wakeup")
    .replace(/\bstudent loans?\b/g, "student loan")
    .replace(/\bhey\s+nova\b/g, " ")
    .replace(/\bnova\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "with", "by",
    "i", "me", "my", "you", "your", "we", "our",
    "hey", "please", "need", "want", "build", "create", "make", "set", "setup", "mission",
    "send", "sends", "that", "this", "every", "daily", "morning", "night", "pm", "am", "est", "edt", "pst", "pdt",
    "telegram", "discord", "novachat", "chat", "workflow", "task", "report",
  ])

  // Common topic keywords to extract
  const topics: Array<{ pattern: RegExp; title: string }> = [
    { pattern: /\b(ai|artificial intelligence)\b.*\b(news|update|summary|report)/i, title: "AI Daily Report" },
    { pattern: /\b(ai|artificial intelligence)\b/i, title: "AI Task Update" },
    { pattern: /\bnba\b.*\b(score|recap|game)/i, title: "NBA Score Recap" },
    { pattern: /\bnfl\b.*\b(score|recap|game)/i, title: "NFL Score Recap" },
    { pattern: /\bmlb\b.*\b(score|recap|game)/i, title: "MLB Score Recap" },
    { pattern: /\b(crypto|bitcoin|ethereum)\b.*\b(price|alert|monitor)/i, title: "Crypto Price Monitor" },
    { pattern: /\b(stock|market)\b.*\b(price|alert|monitor|update)/i, title: "Market Price Update" },
    { pattern: /\bweather\b/i, title: "Daily Weather Update" },
    { pattern: /\bnews\b.*\b(summary|digest|update)/i, title: "Daily News Digest" },
    { pattern: /\btech\b.*\b(news|update)/i, title: "Daily Tech News" },
    { pattern: /\b(morning|daily)\b.*\b(brief|summary|report)/i, title: "Daily Briefing Report" },
    { pattern: /\bremind(?:er)?\b.*\b(student|loan)\b/i, title: "Student Loan Reminder" },
    { pattern: /\b(motivational|inspirational)\b.*\b(quote)\b/i, title: "Daily Quote Reminder" },
    { pattern: /\b(motivational|inspirational)\b.*\b(speech)\b/i, title: "Wakeup Speech Reminder" },
    { pattern: /\b(wakeup|wake up)\b.*\b(speech|quote|reminder)\b/i, title: "Wakeup Speech Reminder" },
  ]

  for (const { pattern, title } of topics) {
    if (pattern.test(normalized)) return title
  }

  // Fallback: Extract first few meaningful words and keep title to exactly 3 words.
  const words = normalized
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w))
    .filter((w, idx, arr) => arr.indexOf(w) === idx)
    .slice(0, 3)

  const seeded = [...words]
  const fallbacks = ["Mission", "Task", "Update"]
  while (seeded.length < 3) {
    const next = fallbacks[seeded.length] || "Update"
    seeded.push(next.toLowerCase())
  }

  const title = seeded
    .slice(0, 3)
    .map((w) => (w.toLowerCase() === "ai" ? "AI" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")

  return title.length > 35 ? title.slice(0, 35).trim() : title
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
