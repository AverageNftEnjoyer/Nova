import type { NodeOutput } from "../types/index"

function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function cleanLine(value: string): string {
  return normalizeWhitespace(String(value || ""))
    .replace(/\s+[|]\s+.*/g, "")
    .replace(/\b(read more|continue reading|live updates|play-by-play)\b.*$/i, "")
    .trim()
}

function candidateTextsFromOutput(output: NodeOutput): string[] {
  const texts: string[] = []
  const data = output.data && typeof output.data === "object" && !Array.isArray(output.data)
    ? output.data as Record<string, unknown>
    : null
  if (Array.isArray(data?.results)) {
    for (const row of data!.results as Array<Record<string, unknown>>) {
      const title = cleanLine(String(row.title || ""))
      const snippet = cleanLine(String(row.snippet || ""))
      // pageText is fetched full-page content (up to 10K chars) — richer than
      // the 280-char snippet and essential for quote/score extraction.
      const pageText = normalizeWhitespace(String(row.pageText || ""))
      if (title) texts.push(title)
      if (snippet) texts.push(snippet)
      if (pageText && pageText !== snippet) texts.push(pageText)
    }
  }
  const raw = normalizeWhitespace(String(output.text || ""))
  if (raw) texts.push(raw)
  return texts
}

function normalizeTeamName(value: string): string {
  return cleanLine(value)
    .replace(/\b(final|ot|2ot|3ot|f\/ot)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

// Team name segment: may start with a digit (e.g. "76ers") but must not
// match mid-word — the negative lookbehind (?<![A-Za-z0-9]) anchors to a
// word boundary without consuming any preceding character.
const TEAM_SEG = "(?<![A-Za-z0-9])([A-Z0-9][A-Za-z0-9.'\\- ]{1,29})"

// Compiled once — each covers a different score-line format
const RE_SCORE_HYPHEN = new RegExp(
  `${TEAM_SEG}\\s+(\\d{2,3})\\s*[-]\\s*(\\d{2,3})\\s+${TEAM_SEG}(?:\\s*\\(?\\b(?:final|ot|2ot|3ot)\\b\\)?)?`,
  "i",
)
const RE_SCORE_CSV = new RegExp(
  `${TEAM_SEG}\\s+(\\d{2,3})\\s*,\\s*${TEAM_SEG}\\s+(\\d{2,3})(?:\\s*\\bfinal\\b)?`,
  "i",
)
const RE_SCORE_SPACED = new RegExp(
  `${TEAM_SEG}\\s+(\\d{2,3})\\s+${TEAM_SEG}\\s+(\\d{2,3})(?:\\s*\\bfinal\\b)?`,
  "i",
)

function parseScoreLine(line: string): string | null {
  const cleaned = cleanLine(line)
  if (!cleaned) return null

  const hyphen = RE_SCORE_HYPHEN.exec(cleaned)
  if (hyphen) {
    const teamA = normalizeTeamName(hyphen[1])
    const a = Number(hyphen[2])
    const b = Number(hyphen[3])
    const teamB = normalizeTeamName(hyphen[4])
    if (a >= 70 && a <= 180 && b >= 70 && b <= 180 && teamA && teamB) {
      return `${teamA} ${a} - ${b} ${teamB}`
    }
  }

  const csv = RE_SCORE_CSV.exec(cleaned)
  if (csv) {
    const teamA = normalizeTeamName(csv[1])
    const a = Number(csv[2])
    const teamB = normalizeTeamName(csv[3])
    const b = Number(csv[4])
    if (a >= 70 && a <= 180 && b >= 70 && b <= 180 && teamA && teamB) {
      return `${teamA} ${a} - ${b} ${teamB}`
    }
  }

  const spaced = RE_SCORE_SPACED.exec(cleaned)
  if (spaced) {
    const teamA = normalizeTeamName(spaced[1])
    const a = Number(spaced[2])
    const teamB = normalizeTeamName(spaced[3])
    const b = Number(spaced[4])
    if (a >= 70 && a <= 180 && b >= 70 && b <= 180 && teamA && teamB) {
      return `${teamA} ${a} - ${b} ${teamB}`
    }
  }

  return null
}

export function extractNbaFinalScores(output: NodeOutput, maxGames = 3): string[] {
  const candidates = candidateTextsFromOutput(output)
  const lines: string[] = []
  for (const chunk of candidates) {
    const split = chunk.split(/\n|[|]|•/g).map((row) => row.trim()).filter(Boolean)
    for (const row of split) lines.push(row)
  }
  const unique = new Set<string>()
  const scores: string[] = []
  for (const line of lines) {
    const score = parseScoreLine(line)
    if (!score || unique.has(score)) continue
    unique.add(score)
    scores.push(score)
    if (scores.length >= Math.max(1, maxGames)) break
  }
  return scores
}

function isLikelyHeadlineOrListicle(text: string): boolean {
  const normalized = String(text || "").toLowerCase()
  if (!normalized) return true
  if (/https?:\/\//.test(normalized)) return true
  // Listicle / navigation-page patterns — strong signal of non-quote content
  if (/\b(top\s+\d+|best\s+\d+|quotes?\s+for|listicle|headlines?|read more)\b/.test(normalized)) return true
  // "article" and "blog" are weak signals on their own — only reject when they
  // appear without any quotation marks in the text (raw site metadata)
  if (/\b(article|blog)\b/.test(normalized) && !/["\u201c\u201d'']/.test(normalized)) return true
  // "news", "update", "story" alone are NOT reliable indicators — they appear
  // frequently on quote-aggregator sites alongside real quotes. Removed.
  return false
}

export function isValidInspirationalQuote(quote: string, author: string): boolean {
  const q = cleanLine(quote)
  const a = cleanLine(author)
  if (!q || !a) return false
  if (q.length < 20 || q.length > 240) return false
  if (a.length < 2 || a.length > 80) return false
  if (isLikelyHeadlineOrListicle(q) || isLikelyHeadlineOrListicle(a)) return false
  if (/^\d+/.test(a)) return false
  return true
}

export function extractInspirationalQuote(output: NodeOutput): { quote: string; author: string } | null {
  const candidates = candidateTextsFromOutput(output)
  const quotePatterns = [
    /["\u201c]([^"\u201d\n]{20,240})["\u201d]\s*[-\u2014]\s*([A-Za-z][A-Za-z .'\-]{1,80})/,
    /["\u201c]([^"\u201d\n]{20,240})["\u201d]\s*\(([^)\n]{2,80})\)/,
  ]
  for (const candidate of candidates) {
    const compact = normalizeWhitespace(candidate)
    for (const pattern of quotePatterns) {
      const match = pattern.exec(compact)
      if (!match) continue
      const quote = cleanLine(match[1])
      const author = cleanLine(match[2])
      if (isValidInspirationalQuote(quote, author)) {
        return { quote, author }
      }
    }
  }
  return null
}

export function clampSectionText(input: string, maxChars: number): string {
  const text = normalizeWhitespace(String(input || ""))
  if (!text) return ""
  const limit = Math.max(40, Math.floor(maxChars))
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(20, limit - 1)).trimEnd()}…`
}
