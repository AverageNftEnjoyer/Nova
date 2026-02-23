import type { Mission, MissionNode, NodeOutput } from "../types"
import {
  clampSectionText,
  extractInspirationalQuote,
  extractNbaFinalScores,
} from "./briefing-quality"

interface NodeOutputEntry {
  node: MissionNode
  output: NodeOutput
}

const SECTION_BUDGETS = {
  nba: 680,
  quote: 380,
  crypto: 260,
  tech: 560,
}
const TOTAL_BUDGET = 3000

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textFromOutput(output: NodeOutput): string {
  return String(output.text || "").trim()
}

function includesToken(node: MissionNode, regex: RegExp): boolean {
  const label = String(node.label || "").trim()
  if (regex.test(label)) return true
  if (node.type === "web-search") return regex.test(String(node.query || ""))
  return false
}

function pickEntry(entries: NodeOutputEntry[], match: (entry: NodeOutputEntry) => boolean): NodeOutputEntry | null {
  for (const entry of entries) {
    if (match(entry)) return entry
  }
  return null
}

function formatUsd(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "unavailable"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 2 : 4,
  }).format(n)
}

function formatEtTime(iso: string): string {
  const parsed = new Date(String(iso || ""))
  if (Number.isNaN(parsed.getTime())) return "unavailable"
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    hour12: true,
  }).format(parsed)
}

function extractTechStory(output: NodeOutput): { headline: string; why: string } {
  const data = asRecord(output.data)
  const results = Array.isArray(data?.results) ? data!.results as Array<Record<string, unknown>> : []
  if (results.length > 0) {
    const first = results[0] || {}
    const headline = String(first.title || "").trim()
    if (headline) {
      // Prefer full page text over the 280-char search snippet for "why it matters"
      const pageText = String(first.pageText || "").trim()
      const snippet = String(first.snippet || "").trim()
      const rawWhy = (pageText.length > snippet.length ? pageText : snippet)
        .replace(/^\s*why it matters:\s*/i, "")
      // Cap to two sentences max to keep the section tight
      const sentences = rawWhy.match(/[^.!?]+[.!?]+/g) || []
      const why = sentences.slice(0, 2).join(" ").trim() || rawWhy.slice(0, 200).trim()
      return { headline, why }
    }
  }
  const text = textFromOutput(output)
  const lines = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const headline = String(lines[0] || "")
  const why = String(lines[1] || "").replace(/^\s*why it matters:\s*/i, "")
  return { headline, why }
}

function extractCoinbasePrices(output: NodeOutput): {
  eth: string
  sui: string
  checkedEt: string
} {
  const data = asRecord(output.data)
  const prices = Array.isArray(data?.prices) ? data!.prices as Array<Record<string, unknown>> : []
  const byAsset = new Map<string, Record<string, unknown>>()
  for (const row of prices) {
    const asset = String(row.baseAsset || row.asset || row.symbol || "").trim().toUpperCase()
    if (asset) byAsset.set(asset, row)
  }
  const eth = byAsset.has("ETH") ? formatUsd(byAsset.get("ETH")?.price) : "unavailable"
  const sui = byAsset.has("SUI") ? formatUsd(byAsset.get("SUI")?.price) : "unavailable"
  const checkedEt = formatEtTime(String(data?.checkedAtIso || ""))
  return { eth, sui, checkedEt }
}

function missionLooksLikeMorningBriefing(entries: NodeOutputEntry[]): boolean {
  if (entries.length === 0) return false
  const hasCoinbase = entries.some((entry) => entry.node.type === "coinbase")
  const hasSports = entries.some((entry) => includesToken(entry.node, /\b(nba|basketball|sports)\b/i))
  const hasQuote = entries.some((entry) => includesToken(entry.node, /\b(quote|inspirational|motivational)\b/i))
  const hasTech = entries.some((entry) => includesToken(entry.node, /\b(tech|technology|ai news)\b/i))
  const matched = [hasCoinbase, hasSports, hasQuote, hasTech].filter(Boolean).length
  return matched >= 2 && (hasSports || hasQuote || hasTech)
}

function collectNodeOutputEntries(mission: Mission | undefined, nodeOutputs: Map<string, NodeOutput>): NodeOutputEntry[] {
  if (!mission) return []
  const entries: NodeOutputEntry[] = []
  for (const node of mission.nodes) {
    const output = nodeOutputs.get(node.id)
    // Include failed nodes so section pickers can find them — section renderers
    // handle missing/empty data gracefully. Nodes that never ran (no output)
    // are still excluded.
    if (!output) continue
    if (node.type.endsWith("-trigger") || node.type.endsWith("-output")) continue
    entries.push({ node, output })
  }
  return entries
}

function withTotalBudget(sections: string[]): string[] {
  const output: string[] = []
  let used = 0
  for (const section of sections) {
    const block = String(section || "").trim()
    if (!block) continue
    if (used + block.length + 2 <= TOTAL_BUDGET) {
      output.push(block)
      used += block.length + 2
      continue
    }
    const remaining = Math.max(40, TOTAL_BUDGET - used - 2)
    if (remaining <= 40) break
    output.push(clampSectionText(block, remaining))
    break
  }
  return output
}

function renderNbaSection(entry: NodeOutputEntry | null): string {
  const fallback = "No clean final NBA scores available from current sources."
  if (!entry) return `**NBA RECAP**\n${fallback}`
  const scores = extractNbaFinalScores(entry.output, 3)
  if (scores.length === 0) return `**NBA RECAP**\n${fallback}`
  const body = scores.map((row) => `- ${row}`).join("\n")
  return clampSectionText(`**NBA RECAP**\n${body}`, SECTION_BUDGETS.nba)
}

function renderQuoteSection(entry: NodeOutputEntry | null): string {
  const fallback = "No verified inspirational quote available from current sources."
  if (!entry) return `**INSPIRATIONAL QUOTE**\n${fallback}`
  const quote = extractInspirationalQuote(entry.output)
  if (!quote) return `**INSPIRATIONAL QUOTE**\n${fallback}`
  return clampSectionText(`**INSPIRATIONAL QUOTE**\n"${quote.quote}" - ${quote.author}`, SECTION_BUDGETS.quote)
}

function renderCryptoSection(entry: NodeOutputEntry | null): string {
  const fallback = "ETH: unavailable | SUI: unavailable"
  if (!entry) return `**CRYPTO PRICES (USD)**\n${fallback}`
  const prices = extractCoinbasePrices(entry.output)
  const body = `ETH: ${prices.eth} | SUI: ${prices.sui}\nUpdated: ${prices.checkedEt} ET`
  return clampSectionText(`**CRYPTO PRICES (USD)**\n${body}`, SECTION_BUDGETS.crypto)
}

function renderTechSection(entry: NodeOutputEntry | null): string {
  if (!entry) return `**TOP TECH STORY**\nNo top tech story available from current sources.`
  const story = extractTechStory(entry.output)
  if (!story.headline) return `**TOP TECH STORY**\nNo top tech story available from current sources.`
  const lines = [`Headline: ${story.headline}`]
  if (story.why) lines.push(`Why it matters: ${story.why}`)
  return clampSectionText(`**TOP TECH STORY**\n${lines.join("\n")}`, SECTION_BUDGETS.tech)
}

export function buildDeterministicMorningBriefing(input: {
  mission?: Mission
  nodeOutputs: Map<string, NodeOutput>
}): string | null {
  const mission = input.mission
  if (!mission) return null
  const entries = collectNodeOutputEntries(mission, input.nodeOutputs)
  if (!missionLooksLikeMorningBriefing(entries)) return null

  const sportsEntry = pickEntry(entries, (entry) => includesToken(entry.node, /\b(nba|basketball)\b/i))
  const quoteEntry = pickEntry(entries, (entry) => includesToken(entry.node, /\b(quote|inspirational|motivational)\b/i))
  const techEntry = pickEntry(entries, (entry) => includesToken(entry.node, /\b(tech|technology|ai news)\b/i))
  const coinbaseEntry = pickEntry(entries, (entry) => entry.node.type === "coinbase")

  const sections = withTotalBudget([
    renderNbaSection(sportsEntry),
    renderQuoteSection(quoteEntry),
    renderCryptoSection(coinbaseEntry),
    renderTechSection(techEntry),
  ])
  return sections.join("\n\n").trim()
}

export function aggregateUpstreamNodeText(input: {
  mission?: Mission
  nodeOutputs: Map<string, NodeOutput>
  maxChars?: number
  perNodeMaxChars?: number
}): string {
  const maxChars = Number.isFinite(Number(input.maxChars)) ? Math.max(200, Number(input.maxChars)) : 12000
  const perNodeMaxChars = Number.isFinite(Number(input.perNodeMaxChars)) ? Math.max(80, Number(input.perNodeMaxChars)) : 480
  const mission = input.mission
  if (!mission) {
    return [...input.nodeOutputs.values()]
      .map((row) => clampSectionText(String(row.text || "").trim(), perNodeMaxChars))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, maxChars)
  }

  const lines: string[] = []
  for (const node of mission.nodes) {
    const output = input.nodeOutputs.get(node.id)
    if (!output || !output.ok) continue
    if (node.type.endsWith("-trigger") || node.type.endsWith("-output")) continue
    const text = String(output.text || "").trim()
    if (!text) continue
    lines.push(`[${String(node.label || node.type)}]\n${clampSectionText(text, perNodeMaxChars)}`)
  }
  const joined = lines.join("\n\n").trim()
  return joined.slice(0, maxChars)
}
