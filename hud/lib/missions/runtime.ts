import "server-only"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import { dispatchNotification, type NotificationIntegration } from "@/lib/notifications/dispatcher"
import type { NotificationSchedule } from "@/lib/notifications/store"

export const WORKFLOW_MARKER = "[NOVA WORKFLOW]"

type Provider = "openai" | "claude" | "grok" | "gemini"

type WorkflowStepType = "trigger" | "fetch" | "ai" | "transform" | "condition" | "output"

export interface WorkflowStep {
  id?: string
  type?: WorkflowStepType | string
  title?: string
  aiPrompt?: string
  aiModel?: string
  aiIntegration?: "openai" | "claude" | "grok" | "gemini" | string
  triggerMode?: "once" | "daily" | "weekly" | "interval" | string
  triggerTime?: string
  triggerTimezone?: string
  triggerDays?: string[]
  triggerIntervalMinutes?: string
  fetchSource?: "api" | "web" | "calendar" | "crypto" | "rss" | "database" | string
  fetchMethod?: "GET" | "POST" | string
  fetchApiIntegrationId?: string
  fetchUrl?: string
  fetchQuery?: string
  fetchHeaders?: string
  fetchSelector?: string
  fetchRefreshMinutes?: string
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich" | string
  transformFormat?: "text" | "json" | "markdown" | "table" | string
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | string
  conditionValue?: string
  conditionLogic?: "all" | "any" | string
  conditionFailureAction?: "skip" | "notify" | "stop" | string
  outputChannel?: "telegram" | "discord" | "email" | "push" | "webhook" | string
  outputTiming?: "immediate" | "scheduled" | "digest" | string
  outputTime?: string
  outputFrequency?: "once" | "multiple" | string
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

export interface WorkflowSummary {
  description?: string
  priority?: string
  schedule?: {
    mode?: string
    days?: string[]
    time?: string
    timezone?: string
  }
  missionActive?: boolean
  tags?: string[]
  apiCalls?: string[]
  workflowSteps?: WorkflowStep[]
}

export interface ParsedWorkflow {
  description: string
  summary: WorkflowSummary | null
}

interface CompletionResult {
  provider: Provider
  model: string
  text: string
}

interface ExecuteMissionWorkflowInput {
  schedule: NotificationSchedule
  source: "scheduler" | "trigger"
  now?: Date
  enforceOutputTime?: boolean
}

interface ExecuteMissionWorkflowResult {
  ok: boolean
  skipped: boolean
  outputs: Array<{ ok: boolean; error?: string; status?: number }>
  reason?: string
  stepTraces: WorkflowStepTrace[]
}

interface WorkflowScheduleGate {
  due: boolean
  dayStamp: string
  mode: string
}

export interface WorkflowStepTrace {
  stepId: string
  type: string
  title: string
  status: "completed" | "failed" | "skipped"
  detail?: string
  startedAt: string
  endedAt: string
}

function toOpenAiLikeBase(url: string, fallback: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return fallback
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

function toClaudeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.anthropic.com"
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed
}

function stripCodeFences(raw: string): string {
  const text = raw.trim()
  const block = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return block ? block[1].trim() : text
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
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

function formatStructuredMissionOutput(raw: string): string {
  const text = String(raw || "").trim()
  if (!text) return text
  const parsed = parseJsonObject(text)
  if (!parsed) return text

  const summary = typeof parsed.summary === "string" ? cleanText(parsed.summary) : ""
  const credibleSourceCount = toNumberSafe(parsed.credibleSourceCount)
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets.map((item) => cleanText(String(item || ""))).filter(Boolean)
    : []
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map((item) => {
          if (typeof item === "string") return cleanText(item)
          if (item && typeof item === "object") {
            const row = item as Record<string, unknown>
            const title = cleanText(String(row.title || ""))
            const url = cleanText(String(row.url || ""))
            if (title && url) return `${title} — ${url}`
            return title || url
          }
          return ""
        })
        .filter(Boolean)
    : []

  if (!summary && bullets.length === 0 && sources.length === 0 && credibleSourceCount === null) {
    return text
  }

  const lines: string[] = []
  if (summary) lines.push(summary)
  if (credibleSourceCount !== null) {
    lines.push(`${credibleSourceCount} credible source${credibleSourceCount === 1 ? "" : "s"} found.`)
  }
  if (bullets.length > 0) {
    if (lines.length > 0) lines.push("")
    for (const bullet of bullets.slice(0, 12)) {
      lines.push(`- ${bullet}`)
    }
  }
  if (sources.length > 0) {
    lines.push("")
    lines.push("Sources:")
    for (const source of sources.slice(0, 8)) {
      lines.push(`- ${source}`)
    }
  }
  return lines.join("\n").trim() || text
}

function normalizeSnippetText(value: string, limit = 220): string {
  const cleaned = cleanText(
    String(value || "")
      .replace(/\|/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/\[\s*\.\.\.\s*\]/g, " ")
      .trim(),
  )
  if (!cleaned) return ""
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned
}

function formatWebSearchObjectOutput(obj: Record<string, unknown>): string | null {
  const directResults = Array.isArray(obj.results) ? (obj.results as Array<Record<string, unknown>>) : []
  const payload = obj.payload && typeof obj.payload === "object" ? (obj.payload as Record<string, unknown>) : null
  const payloadResults = payload && Array.isArray(payload.results) ? (payload.results as Array<Record<string, unknown>>) : []
  const results = (directResults.length > 0 ? directResults : payloadResults).filter((row) => row && typeof row === "object")
  if (results.length === 0) return null

  const query = cleanText(String(obj.query || payload?.query || "web search"))
  const answer = normalizeSnippetText(String(obj.answer || payload?.answer || ""), 360)
  const top = results.slice(0, 6)
  const lines: string[] = []

  if (answer) {
    lines.push(answer)
  } else if (query) {
    lines.push(`Summary for "${query}":`)
  }

  const bullets = top
    .map((row) => {
      const title = cleanText(String(row.title || row.pageTitle || ""))
      const url = cleanText(String(row.url || ""))
      const snippet = normalizeSnippetText(String(row.snippet || row.content || row.pageText || ""))
      if (!title && !snippet) return null
      const heading = title || (() => {
        if (!url) return "Source"
        try {
          return new URL(url).hostname
        } catch {
          return "Source"
        }
      })()
      return {
        text: `- ${heading}${snippet ? `: ${snippet}` : ""}`,
        url,
      }
    })
    .filter((row): row is { text: string; url: string } => Boolean(row))

  if (bullets.length === 0) return null
  if (lines.length > 0) lines.push("")
  lines.push(...bullets.map((row) => row.text))

  const urls = Array.from(new Set(bullets.map((row) => row.url).filter(Boolean))).slice(0, 6)
  if (urls.length > 0) {
    lines.push("")
    lines.push("Sources:")
    lines.push(...urls.map((url) => `- ${url}`))
  }

  return lines.join("\n").trim() || null
}

function humanizeMissionOutputText(raw: string, contextData?: unknown): string {
  const text = String(raw || "").trim()
  const formatted = formatStructuredMissionOutput(text)
  const parsed = parseJsonObject(formatted)
  if (parsed) {
    const webFormatted = formatWebSearchObjectOutput(parsed)
    if (webFormatted) return webFormatted
  }

  if (contextData && typeof contextData === "object") {
    const contextRecord = contextData as Record<string, unknown>
    if (String(contextRecord.mode || "") === "web-search") {
      const fromContext = formatWebSearchObjectOutput(contextRecord)
      if (fromContext) return fromContext
    }
  }

  return formatted || text
}

function getByPath(input: unknown, path: string): unknown {
  const parts = String(path || "").split(".").map((p) => p.trim()).filter(Boolean)
  let cur: unknown = input
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function toNumberSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeWorkflowStep(raw: WorkflowStep, index: number): WorkflowStep {
  const type = String(raw.type || "output").toLowerCase()
  const stepType: WorkflowStepType =
    type === "trigger" || type === "fetch" || type === "ai" || type === "transform" || type === "condition" || type === "output"
      ? (type as WorkflowStepType)
      : "output"
  return {
    ...raw,
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `step-${index + 1}`,
    type: stepType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : stepType,
  }
}

function parseHeadersJson(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k).trim()
      const value = String(v ?? "").trim()
      if (key && value) out[key] = value
    }
    return out
  } catch {
    const out: Record<string, string> = {}
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) {
      const separator = line.indexOf(":")
      if (separator <= 0) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim()
      if (key && value) out[key] = value
    }
    return out
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.trim().toLowerCase()
  return Object.keys(headers).some((key) => key.trim().toLowerCase() === target)
}

function normalizeWebSearchRequestUrl(rawUrl: string): string {
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

function stripHtmlToText(html: string): string {
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

function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? cleanText(match[1]) : ""
}

function normalizeExtractedHref(href: string, baseUrl: string): string {
  const raw = String(href || "").trim()
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return ""
  try {
    const base = new URL(baseUrl)
    const resolved = new URL(raw, base).toString()
    const parsed = new URL(resolved)
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
    if (parsed.hostname.toLowerCase().includes("google.") && parsed.pathname === "/url") {
      const q = (parsed.searchParams.get("q") || "").trim()
      if (q) return q
    }
    return resolved
  } catch {
    return ""
  }
}

function extractHtmlLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
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

function extractSearchQueryFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const q = String(parsed.searchParams.get("q") || "").trim()
    return q
  } catch {
    return ""
  }
}

function isSearchEngineUrl(rawUrl: string): boolean {
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

function truncateForModel(text: string, limit = 8000): string {
  const normalized = cleanText(text)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function hasRecapSignal(text: string): boolean {
  const value = String(text || "").toLowerCase()
  if (!value) return false
  return /\b(recap|final|box score|game summary|won|defeated|beat|points|rebounds|assists|scoreboard)\b/.test(value)
    || /\b\d{2,3}\s*[-:]\s*\d{2,3}\b/.test(value)
}

function isLowSignalNavigationPage(input: { title?: string; url?: string; text?: string }): boolean {
  const combined = `${String(input.title || "")} ${String(input.text || "")}`.toLowerCase()
  const url = String(input.url || "").toLowerCase()
  const navOnly = /\b(watch|video|videos|podcast|highlights|schedule|standings|top stories|newsletter|subscribe)\b/.test(combined)
  const hasGameSignal = hasRecapSignal(combined)
  const obviousListing = /\/watch|\/video|youtube\.com|spotify\.com|rss\.com|wikihoops\.com/.test(url)
  return (navOnly || obviousListing) && !hasGameSignal
}

function isUsableWebResult(item: {
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

async function fetchWebDocument(
  url: string,
  headers: Record<string, string>,
): Promise<{
  ok: boolean
  status: number
  finalUrl: string
  title: string
  text: string
  links: Array<{ href: string; text: string }>
  error?: string
}> {
  try {
    const res = await fetch(url, { method: "GET", headers, cache: "no-store" })
    const contentType = String(res.headers.get("content-type") || "")
    const finalUrl = res.url || url
    if (contentType.includes("application/json")) {
      const jsonPayload = await res.json().catch(() => null)
      const text = truncateForModel(toTextPayload(jsonPayload), 10000)
      return {
        ok: res.ok,
        status: res.status,
        finalUrl,
        title: finalUrl,
        text,
        links: [],
        error: res.ok ? undefined : `Fetch returned status ${res.status}.`,
      }
    }
    const html = await res.text().catch(() => "")
    const links = extractHtmlLinks(html, finalUrl)
    const title = extractHtmlTitle(html) || finalUrl
    const text = truncateForModel(stripHtmlToText(html), 10000)
    return {
      ok: res.ok,
      status: res.status,
      finalUrl,
      title,
      text,
      links,
      error: res.ok ? undefined : `Fetch returned status ${res.status}.`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      title: url,
      text: "",
      links: [],
      error: error instanceof Error ? error.message : "Web fetch failed.",
    }
  }
}

function getWebSearchProviderPreference(): "tavily" | "serper" | "builtin" {
  // Enforce Tavily as the only web-search provider for mission scraping.
  return "tavily"
}

async function searchWithTavily(query: string): Promise<null | {
  searchUrl: string
  query: string
  searchTitle: string
  searchText: string
  provider: string
  results: Array<{
    url: string
    title: string
    snippet: string
    ok: boolean
    status: number
    pageTitle?: string
    pageText?: string
    error?: string
  }>
}> {
  const apiKey = String(process.env.TAVILY_API_KEY || "").trim()
  if (!apiKey) return null
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 8,
        include_answer: false,
        include_raw_content: true,
        search_depth: "advanced",
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => ({})) as {
      results?: Array<{ url?: string; title?: string; content?: string; raw_content?: string }>
    }
    if (!res.ok || !Array.isArray(payload.results)) return null
    const top: Array<{
      url: string
      title: string
      snippet: string
      ok: boolean
      status: number
      pageTitle?: string
      pageText?: string
      error?: string
    }> = payload.results
      .map((item) => {
        const url = String(item.url || "").trim()
        const title = cleanText(String(item.title || "").trim()) || url
        const pageText = truncateForModel(String(item.raw_content || item.content || ""), 10000)
        const snippet = pageText.slice(0, 280)
        if (!url) return null
        return {
          url,
          title,
          snippet,
          ok: pageText.length > 0,
          status: 200,
          pageTitle: title,
          pageText,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 8)

    // Deepen retrieval: when Tavily text is thin or low-signal, fetch the page directly.
    const enriched = await Promise.all(top.map(async (item) => {
      const text = String(item.pageText || "")
      if (text.length >= 800 && !isLowSignalNavigationPage({ title: item.title, url: item.url, text })) {
        return item
      }
      const doc = await fetchWebDocument(item.url, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      })
      const mergedText = truncateForModel(
        (String(doc.text || "").length > text.length ? String(doc.text || "") : text),
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
      searchUrl: `https://app.tavily.com/search?q=${encodeURIComponent(query)}`,
      query,
      searchTitle: "Tavily Search",
      searchText: results.map((item) => `${item.title} ${item.snippet}`).join(" "),
      provider: "tavily",
      results,
    }
  } catch {
    return null
  }
}

async function searchWithSerper(query: string, headers: Record<string, string>): Promise<null | {
  searchUrl: string
  query: string
  searchTitle: string
  searchText: string
  provider: string
  results: Array<{
    url: string
    title: string
    snippet: string
    ok: boolean
    status: number
    pageTitle?: string
    pageText?: string
    error?: string
  }>
}> {
  const apiKey = String(process.env.SERPER_API_KEY || "").trim()
  if (!apiKey) return null
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ q: query, num: 8 }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => ({})) as {
      organic?: Array<{ link?: string; title?: string; snippet?: string }>
    }
    if (!res.ok || !Array.isArray(payload.organic)) return null
    const top = payload.organic
      .map((item) => ({
        url: String(item.link || "").trim(),
        title: cleanText(String(item.title || "").trim()),
        snippet: cleanText(String(item.snippet || "").trim()),
      }))
      .filter((item) => item.url)
      .slice(0, 5)
    const results: Array<{
      url: string
      title: string
      snippet: string
      ok: boolean
      status: number
      pageTitle?: string
      pageText?: string
      error?: string
    }> = []
    for (const row of top) {
      const doc = await fetchWebDocument(row.url, headers)
      results.push({
        url: row.url,
        title: row.title || doc.title || row.url,
        snippet: doc.text.slice(0, 280) || row.snippet,
        ok: doc.ok,
        status: doc.status,
        pageTitle: doc.title,
        pageText: doc.text,
        error: doc.error,
      })
    }
    return {
      searchUrl: `https://google.com/search?q=${encodeURIComponent(query)}`,
      query,
      searchTitle: "Serper Search",
      searchText: top.map((item) => `${item.title} ${item.snippet}`).join(" "),
      provider: "serper",
      results,
    }
  } catch {
    return null
  }
}

async function searchWebAndCollect(
  query: string,
  headers: Record<string, string>,
): Promise<{
  searchUrl: string
  query: string
  searchTitle: string
  searchText: string
  provider: string
  results: Array<{
    url: string
    title: string
    snippet: string
    ok: boolean
    status: number
    pageTitle?: string
    pageText?: string
    error?: string
  }>
}> {
  const preferred = getWebSearchProviderPreference()
  const queryVariants = buildSearchQueryVariants(query)
  const collectFromProvider = async (provider: "tavily" | "serper") => {
    const merged: Array<{
      url: string
      title: string
      snippet: string
      ok: boolean
      status: number
      pageTitle?: string
      pageText?: string
      error?: string
    }> = []
    const seen = new Set<string>()
    let selected: null | {
      searchUrl: string
      query: string
      searchTitle: string
      searchText: string
      provider: string
    } = null

    for (const variant of queryVariants) {
      const found = provider === "tavily"
        ? await searchWithTavily(variant)
        : await searchWithSerper(variant, headers)
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

  if (preferred === "tavily") {
    const tavily = await collectFromProvider("tavily")
    if (tavily && tavily.results.length > 0) return tavily
  }

  // Tavily-only mode: do not fall back to Serper or DuckDuckGo scraping.
  return {
    searchUrl: `https://app.tavily.com/search?q=${encodeURIComponent(queryVariants[0] || query)}`,
    query,
    searchTitle: "Tavily Search",
    searchText: "",
    provider: "tavily",
    results: [],
  }
}

function buildSearchQueryVariants(query: string): string[] {
  const base = cleanText(query)
  if (!base) return []
  const variants = new Set<string>([base, `${base} latest updates`])
  const noYear = base.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim()
  if (noYear && noYear !== base) {
    variants.add(noYear)
    variants.add(`${noYear} recap`)
  }
  const lower = base.toLowerCase()
  if (/\bnba\b/.test(lower) && /\b(last night|recap|scores|games)\b/.test(lower)) {
    variants.add("nba games last night final scores site:nba.com OR site:espn.com OR site:apnews.com OR site:reuters.com")
    variants.add("nba recap last night final score box score")
  }
  return Array.from(variants).filter(Boolean).slice(0, 6)
}

function deriveWebSearchQuery(input: {
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

function isSearchLikeUrl(value: string): boolean {
  const raw = String(value || "").trim()
  if (!raw) return false
  if (!/^https?:\/\//i.test(raw)) return false
  if (isSearchEngineUrl(raw)) return true
  return /[?&]q=/i.test(raw)
}

function hasWebSearchUsableSources(data: unknown): boolean {
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

function isNoDataText(value: string): boolean {
  return /^no[_\s-]?data\.?$/i.test(String(value || "").trim())
}

function buildForcedWebSummaryPrompt(contextData: unknown): string {
  const payload = contextData && typeof contextData === "object"
    ? (contextData as Record<string, unknown>).payload
    : null
  const results = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).results)
    ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
    : []
  const sourceLines = results
    .slice(0, 5)
    .map((item, idx) => `${idx + 1}. ${String(item.title || "Untitled")}\nURL: ${String(item.url || "")}\nSnippet: ${String(item.snippet || "")}\nExtract: ${truncateForModel(String(item.pageText || ""), 700)}`)
    .join("\n\n")
  return [
    "Use the provided scraped sources to produce a concise factual summary.",
    "Do not return NO_DATA when sources are present.",
    "If details conflict, state uncertainty clearly.",
    "End with a Sources section listing URLs used.",
    "",
    "Sources:",
    sourceLines || "No sources captured.",
  ].join("\n")
}

function deriveCredibleSourceCountFromContext(context: Record<string, unknown>): number {
  const fromTopLevel = toNumberSafe(getByPath(context, "data.credibleSourceCount"))
  if (fromTopLevel !== null) return Math.max(0, Math.floor(fromTopLevel))

  const fromPayload = toNumberSafe(getByPath(context, "data.payload.credibleSourceCount"))
  if (fromPayload !== null) return Math.max(0, Math.floor(fromPayload))

  const sourceUrls = getByPath(context, "data.sourceUrls")
  if (Array.isArray(sourceUrls)) return sourceUrls.filter(Boolean).length

  const payloadSourceUrls = getByPath(context, "data.payload.sourceUrls")
  if (Array.isArray(payloadSourceUrls)) return payloadSourceUrls.filter(Boolean).length

  const payloadLinks = getByPath(context, "data.payload.links")
  if (Array.isArray(payloadLinks)) return payloadLinks.filter(Boolean).length

  return 0
}

function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const value = getByPath(context, key)
    if (value === null || typeof value === "undefined") return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  })
}

function getLocalTimeParts(date: Date, timezone: string): { hour: number; minute: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return { hour, minute }
  } catch {
    return null
  }
}

function getLocalParts(date: Date, timezone: string): { hour: number; minute: number; dayStamp: string; weekday: string } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))
    const year = lookup.get("year")
    const month = lookup.get("month")
    const day = lookup.get("day")
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    const weekdayRaw = String(lookup.get("weekday") || "").toLowerCase()
    const weekday = weekdayRaw.startsWith("mon")
      ? "mon"
      : weekdayRaw.startsWith("tue")
        ? "tue"
        : weekdayRaw.startsWith("wed")
          ? "wed"
          : weekdayRaw.startsWith("thu")
            ? "thu"
            : weekdayRaw.startsWith("fri")
              ? "fri"
              : weekdayRaw.startsWith("sat")
                ? "sat"
                : "sun"
    if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return {
      hour,
      minute,
      dayStamp: `${year}-${month}-${day}`,
      weekday,
    }
  } catch {
    return null
  }
}

function parseTime(value: string | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function toTextPayload(data: unknown): string {
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  if (!data) return ""
  try {
    const text = JSON.stringify(data, null, 2)
    return text.length > 8000 ? `${text.slice(0, 8000)}\n...` : text
  } catch {
    return String(data)
  }
}

function hasUsableContextData(data: unknown): boolean {
  if (data === null || typeof data === "undefined") return false
  if (typeof data === "string") return data.trim().length > 0
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === "object") {
    const record = data as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) return false
    if ("payload" in record) {
      const payload = record.payload
      if (payload === null || typeof payload === "undefined") return false
      if (typeof payload === "string") return payload.trim().length > 0
      if (Array.isArray(payload)) return payload.length > 0
      if (typeof payload === "object") {
        const payloadRecord = payload as Record<string, unknown>
        if (Array.isArray(payloadRecord.results)) {
          const viable = payloadRecord.results.some((item) => {
            if (!item || typeof item !== "object") return false
            const row = item as Record<string, unknown>
            const snippet = String(row.snippet || "").trim()
            const pageText = String(row.pageText || "").trim()
            return snippet.length > 0 || pageText.length > 0
          })
          if (viable) return true
        }
        if (typeof payloadRecord.text === "string" && payloadRecord.text.trim().length > 0) return true
        return Object.keys(payloadRecord).length > 0
      }
      return true
    }
    return Object.keys(record).length > 0
  }
  return true
}

function isInvalidConditionFieldPath(value: string): boolean {
  const field = String(value || "").trim()
  if (!field) return true
  if (field.includes("{{") || field.includes("}}")) return true
  if (field.includes("[") || field.includes("]")) return true
  return false
}

function defaultRecipientPlaceholder(channel: string): string {
  const normalized = String(channel || "").trim().toLowerCase()
  if (normalized === "discord") return "{{secrets.DISCORD_WEBHOOK_URL}}"
  if (normalized === "telegram") return "{{secrets.TELEGRAM_CHAT_ID}}"
  if (normalized === "email") return "{{secrets.EMAIL_TO}}"
  if (normalized === "webhook") return "{{secrets.WEBHOOK_URL}}"
  if (normalized === "push") return "{{secrets.PUSH_TARGET}}"
  return ""
}

function normalizeOutputRecipientsForChannel(channel: string, recipients: string | undefined): string {
  const normalizedChannel = String(channel || "").trim().toLowerCase()
  const value = String(recipients || "").trim()
  const fallback = defaultRecipientPlaceholder(normalizedChannel)
  if (!value) return fallback

  const upper = value.toUpperCase()
  const mentionsTelegram = upper.includes("TELEGRAM")
  const mentionsDiscord = upper.includes("DISCORD")
  const mentionsWebhook = upper.includes("WEBHOOK")
  const mentionsEmail = upper.includes("EMAIL")
  const mentionsPush = upper.includes("PUSH")

  if (normalizedChannel === "telegram" && (mentionsDiscord || mentionsWebhook || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "discord" && (mentionsTelegram || mentionsWebhook || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "webhook" && (mentionsTelegram || mentionsDiscord || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "email" && (mentionsTelegram || mentionsDiscord || mentionsWebhook || mentionsPush)) return fallback
  if (normalizedChannel === "push" && (mentionsTelegram || mentionsDiscord || mentionsWebhook || mentionsEmail)) return fallback

  return value
}

function isTemplateRecipient(value: string): boolean {
  const text = String(value || "").trim()
  return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
}

export async function completeWithConfiguredLlm(
  systemText: string,
  userText: string,
  maxTokens = 1200,
  scope?: IntegrationsStoreScope,
): Promise<CompletionResult> {
  const config = await loadIntegrationsConfig(scope)
  const provider: Provider = resolveConfiguredLlmProvider(config).provider

  if (provider === "claude") {
    const apiKey = config.claude.apiKey.trim()
    const model = config.claude.defaultModel.trim()
    const baseUrl = toClaudeBase(config.claude.baseUrl)
    if (!apiKey) throw new Error("Claude API key is missing.")
    if (!model) throw new Error("Claude default model is missing.")

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemText,
        messages: [{ role: "user", content: userText }],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Claude request failed (${res.status}).`)
    }
    const text = Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> }).content)
      ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
      : ""
    return { provider, model, text: String(text || "").trim() }
  }

  if (provider === "grok") {
    const apiKey = config.grok.apiKey.trim()
    const model = config.grok.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.grok.baseUrl, "https://api.x.ai/v1")
    if (!apiKey) throw new Error("Grok API key is missing.")
    if (!model) throw new Error("Grok default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Grok request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  if (provider === "gemini") {
    const apiKey = config.gemini.apiKey.trim()
    const model = config.gemini.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai")
    if (!apiKey) throw new Error("Gemini API key is missing.")
    if (!model) throw new Error("Gemini default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Gemini request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  const apiKey = config.openai.apiKey.trim()
  const model = config.openai.defaultModel.trim()
  const baseUrl = toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")
  if (!apiKey) throw new Error("OpenAI API key is missing.")
  if (!model) throw new Error("OpenAI default model is missing.")

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
    cache: "no-store",
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message || "")
      : ""
    throw new Error(msg || `OpenAI request failed (${res.status}).`)
  }
  const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
  return { provider: "openai", model, text: text.trim() }
}

async function dispatchOutput(channel: string, text: string, targets: string[] | undefined, schedule: NotificationSchedule): Promise<Array<{ ok: boolean; error?: string; status?: number }>> {
  if (channel === "discord" || channel === "telegram") {
    return dispatchNotification({
      integration: channel as NotificationIntegration,
      text,
      targets,
      source: "workflow",
      scheduleId: schedule.id,
      label: schedule.label,
    })
  }

  if (channel === "webhook") {
    const urls = (targets || []).map((t) => String(t || "").trim()).filter(Boolean)
    if (!urls.length) {
      return [{ ok: false, error: "Webhook output requires at least one URL in recipients." }]
    }
    const results = await Promise.all(urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            scheduleId: schedule.id,
            label: schedule.label,
            ts: new Date().toISOString(),
          }),
        })
        return { ok: res.ok, status: res.status, error: res.ok ? undefined : `Webhook returned ${res.status}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Webhook send failed" }
      }
    }))
    return results
  }

  return [{ ok: false, error: `Unsupported output channel: ${channel}` }]
}

export function parseMissionWorkflow(message: string): ParsedWorkflow {
  const raw = String(message || "")
  const idx = raw.indexOf(WORKFLOW_MARKER)
  const description = idx < 0 ? raw.trim() : raw.slice(0, idx).trim()
  if (idx < 0) return { description, summary: null }

  const maybe = parseJsonObject(raw.slice(idx + WORKFLOW_MARKER.length))
  if (!maybe) return { description, summary: null }

  const summary = maybe as unknown as WorkflowSummary
  const stepsRaw = Array.isArray(summary.workflowSteps) ? summary.workflowSteps : []
  summary.workflowSteps = stepsRaw.map((s, i) => normalizeWorkflowStep(s, i))
  return { description, summary }
}

export function shouldWorkflowRunNow(schedule: NotificationSchedule, now: Date): WorkflowScheduleGate {
  const parsed = parseMissionWorkflow(schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const trigger = steps.find((s) => String(s.type || "").toLowerCase() === "trigger")
  const timezone = String(
    trigger?.triggerTimezone ||
    parsed.summary?.schedule?.timezone ||
    schedule.timezone ||
    "America/New_York",
  ).trim() || "America/New_York"
  const local = getLocalParts(now, timezone)
  if (!local) return { due: false, dayStamp: "", mode: "daily" }

  const mode = String(trigger?.triggerMode || parsed.summary?.schedule?.mode || "daily").toLowerCase()
  const timeString = String(trigger?.triggerTime || parsed.summary?.schedule?.time || schedule.time || "09:00").trim()
  const target = parseTime(timeString)
  if ((mode === "daily" || mode === "weekly" || mode === "once") && !target) {
    return { due: false, dayStamp: local.dayStamp, mode }
  }

  if (mode === "interval") {
    const every = Math.max(1, Number(trigger?.triggerIntervalMinutes || "30") || 30)
    const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { due: true, dayStamp: local.dayStamp, mode }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    return { due: minutesSince >= every, dayStamp: local.dayStamp, mode }
  }

  const sameMinute = local.hour === (target?.hour ?? -1) && local.minute === (target?.minute ?? -1)
  if (!sameMinute) return { due: false, dayStamp: local.dayStamp, mode }

  if (mode === "weekly" || mode === "once") {
    const days = Array.isArray(trigger?.triggerDays)
      ? trigger!.triggerDays!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : Array.isArray(parsed.summary?.schedule?.days)
        ? parsed.summary!.schedule!.days!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        : []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { due: false, dayStamp: local.dayStamp, mode }
    }
  }

  return { due: true, dayStamp: local.dayStamp, mode }
}

function buildFallbackWorkflowPayload(prompt: string, defaultOutput: string): Record<string, unknown> {
  const description = cleanText(prompt) || "Generated workflow"
  const searchQuery = description.length > 180 ? description.slice(0, 180) : description
  return {
    label: description.slice(0, 80) || "Generated Workflow",
    description,
    integration: defaultOutput,
    priority: "medium",
    schedule: {
      mode: "daily",
      days: ["mon", "tue", "wed", "thu", "fri"],
      time: "09:00",
      timezone: "America/New_York",
    },
    tags: ["automation"],
    workflowSteps: [
      {
        type: "trigger",
        title: "Mission triggered",
        triggerMode: "daily",
        triggerTime: "09:00",
        triggerTimezone: "America/New_York",
        triggerDays: ["mon", "tue", "wed", "thu", "fri"],
      },
      {
        type: "fetch",
        title: "Fetch data",
        fetchSource: "web",
        fetchMethod: "GET",
        fetchUrl: "",
        fetchQuery: searchQuery,
        fetchHeaders: "",
        fetchSelector: "a[href]",
      },
      {
        type: "ai",
        title: "Summarize report",
        aiPrompt: "Summarize the fetched web sources with factual bullet points and include source URLs. If sources are weak, say what is uncertain.",
      },
      {
        type: "output",
        title: "Send notification",
        outputChannel: defaultOutput,
        outputTiming: "immediate",
        outputTime: "09:00",
        outputFrequency: "once",
      },
    ],
  }
}

function promptRequestsImmediateOutput(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(now|immediately|immediate|right away|asap)\b/.test(text)
}

function promptLooksLikeWebLookupTask(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  const asksLookup = /\b(search|scrape|lookup|find|latest|recap|scores|news|web)\b/.test(text)
  const domainHint = /\b(nba|nfl|mlb|nhl|wnba|soccer|crypto|market|stocks|headline)\b/.test(text)
  return asksLookup || domainHint
}

function promptRequestsConditionLogic(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(if|when|only if|unless|threshold|above|below|greater than|less than|at least|at most)\b/.test(text)
}

function promptRequestsTransformLogic(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(transform|normalize|dedupe|aggregate|format|enrich|map|filter)\b/.test(text)
}

function simplifyGeneratedWorkflowSteps(input: {
  steps: WorkflowStep[]
  prompt: string
  schedule: { time: string; timezone: string; days: string[] }
  defaultOutput: string
  defaultLlm: string
}): WorkflowStep[] {
  const wantsCondition = promptRequestsConditionLogic(input.prompt)
  const wantsTransform = promptRequestsTransformLogic(input.prompt)
  const immediate = promptRequestsImmediateOutput(input.prompt)

  const trigger = input.steps.find((step) => step.type === "trigger")
  const fetch = input.steps.find((step) => step.type === "fetch")
  const transform = wantsTransform ? input.steps.find((step) => step.type === "transform") : null
  const ai = input.steps.find((step) => step.type === "ai")
  const condition = wantsCondition ? input.steps.find((step) => step.type === "condition" && String(step.conditionField || "").trim()) : null
  const output = input.steps.find((step) => step.type === "output")

  const ordered: WorkflowStep[] = []
  ordered.push(normalizeWorkflowStep(
    trigger || {
      type: "trigger",
      title: "Mission triggered",
      triggerMode: "daily",
      triggerTime: input.schedule.time || "09:00",
      triggerTimezone: input.schedule.timezone || "America/New_York",
      triggerDays: input.schedule.days.length > 0 ? input.schedule.days : ["mon", "tue", "wed", "thu", "fri"],
    },
    ordered.length,
  ))

  if (fetch) ordered.push(normalizeWorkflowStep(fetch, ordered.length))
  if (transform) ordered.push(normalizeWorkflowStep(transform, ordered.length))

  ordered.push(normalizeWorkflowStep(
    ai || {
      type: "ai",
      title: "Summarize report",
      aiPrompt: "Summarize the fetched data in clear human-readable bullet points. If data is missing, say that briefly.",
      aiIntegration: input.defaultLlm,
    },
    ordered.length,
  ))

  if (condition) ordered.push(normalizeWorkflowStep(condition, ordered.length))

  ordered.push(normalizeWorkflowStep(
    output || {
      type: "output",
      title: "Send notification",
      outputChannel: input.defaultOutput,
      outputTiming: immediate ? "immediate" : "scheduled",
      outputTime: input.schedule.time || "09:00",
      outputFrequency: "once",
      outputRepeatCount: "1",
    },
    ordered.length,
  ))

  return ordered
}

function buildStableWebSummarySteps(input: {
  prompt: string
  time: string
  timezone: string
  defaultOutput: string
  defaultLlm: string
}): WorkflowStep[] {
  const query = cleanText(input.prompt).slice(0, 180) || "latest recap"
  const aiPrompt = [
    "Use only fetched web-search data from context.",
    "Summarize key facts concisely and clearly in bullet points.",
    "Do not invent data. If uncertain, say it is uncertain.",
    "If useful data is insufficient, state that briefly.",
  ].join(" ")
  return [
    normalizeWorkflowStep({
      type: "trigger",
      title: "Mission triggered",
      triggerMode: "daily",
      triggerTime: input.time || "09:00",
      triggerTimezone: input.timezone || "America/New_York",
      triggerDays: ["mon", "tue", "wed", "thu", "fri"],
    }, 0),
    normalizeWorkflowStep({
      type: "fetch",
      title: "Fetch data",
      fetchSource: "web",
      fetchMethod: "GET",
      fetchUrl: "",
      fetchQuery: query,
      fetchSelector: "a[href]",
      fetchHeaders: "",
      fetchRefreshMinutes: "15",
    }, 1),
    normalizeWorkflowStep({
      type: "ai",
      title: "Summarize report",
      aiPrompt,
      aiIntegration: input.defaultLlm,
    }, 2),
    normalizeWorkflowStep({
      type: "output",
      title: "Send notification",
      outputChannel: input.defaultOutput,
      outputTiming: promptRequestsImmediateOutput(input.prompt) ? "immediate" : "scheduled",
      outputTime: input.time || "09:00",
      outputFrequency: "once",
      outputRepeatCount: "1",
    }, 3),
  ]
}

export async function buildWorkflowFromPrompt(prompt: string): Promise<{ workflow: { label: string; integration: string; summary: WorkflowSummary }; provider: Provider; model: string }> {
  const catalog = await loadIntegrationCatalog()
  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean)
  const outputOptions = catalog.filter((item) => item.kind === "channel" && item.connected).map((item) => item.id).filter(Boolean)
  const apiIntegrations = catalog
    .filter((item) => item.kind === "api" && item.connected && item.endpoint)
    .map((item) => ({ id: item.id, label: item.label, endpoint: item.endpoint as string }))
  const outputSet = new Set(outputOptions.length > 0 ? outputOptions : ["telegram", "discord", "webhook"])
  const defaultOutput = outputOptions[0] || "telegram"
  const defaultLlm = llmOptions[0] || "openai"
  const forceImmediateOutput = promptRequestsImmediateOutput(prompt)

  // Deterministic path for web lookup prompts.
  // Avoids malformed model-generated step plans and enforces a stable search->summarize flow.
  if (promptLooksLikeWebLookupTask(prompt)) {
    const schedule = {
      mode: "daily",
      days: ["mon", "tue", "wed", "thu", "fri"],
      time: "09:00",
      timezone: "America/New_York",
    }
    const integration = defaultOutput
    const steps = buildStableWebSummarySteps({
      prompt,
      time: schedule.time,
      timezone: schedule.timezone,
      defaultOutput: integration,
      defaultLlm,
    }).map((step) => {
      if (step.type !== "output") return step
      if (forceImmediateOutput) step.outputTiming = "immediate"
      step.outputRecipients = normalizeOutputRecipientsForChannel(String(step.outputChannel || integration), step.outputRecipients)
      return step
    })

    const summary: WorkflowSummary = {
      description: cleanText(prompt),
      priority: "medium",
      schedule,
      missionActive: true,
      tags: ["automation", "web-research"],
      apiCalls: ["FETCH:web", `LLM:${defaultLlm}`, `OUTPUT:${integration}`],
      workflowSteps: steps,
    }

    return {
      workflow: {
        label: cleanText(prompt).slice(0, 80) || "Web Research Workflow",
        integration,
        summary,
      },
      provider: "openai",
      model: "deterministic-web-template",
    }
  }

  const systemText = [
    "You are Nova's workflow architect. Build production-grade automation workflows.",
    "Return only strict JSON.",
    "Design complete, executable workflows with trigger, fetch, transform/ai, condition, and output steps when relevant.",
    "If the user asks for market/news/web updates, you must include at least one fetch step that retrieves real external data before any AI summary step.",
    "Do not invent source facts. The workflow must be grounded in fetched data.",
    "For web/news summaries, include source URLs in fetchUrl fields when possible and design output to include source links.",
    "Do not use auth-required endpoints unless credentials are explicitly provided by the user prompt.",
    "Do not use template expressions in conditionField. Use plain dot-paths like data.payload.price.",
    "When no reliable data is fetched, prefer workflow condition failure action 'skip' or explicit no-data output.",
    "Use 24h HH:mm time and realistic defaults.",
    `Connected AI providers: ${llmOptions.join(", ") || "openai"}.`,
    `Connected output channels: ${outputOptions.join(", ") || "telegram, discord, webhook"}.`,
    `Configured API integrations: ${apiIntegrations.length > 0 ? JSON.stringify(apiIntegrations) : "none"}.`,
    "If you build fetch steps for source=api, prefer fetchApiIntegrationId + fetchUrl using configured integrations.",
  ].join(" ")

  const userText = [
    `User prompt: ${prompt}`,
    "Return JSON with this exact shape:",
    JSON.stringify({
      label: "",
      description: "",
      integration: "telegram",
      priority: "medium",
      schedule: { mode: "daily", days: ["mon", "tue", "wed", "thu", "fri"], time: "09:00", timezone: "America/New_York" },
      tags: ["automation"],
      workflowSteps: [
        { type: "trigger", title: "Mission triggered", triggerMode: "daily", triggerTime: "09:00", triggerTimezone: "America/New_York", triggerDays: ["mon", "tue", "wed", "thu", "fri"] },
        { type: "fetch", title: "Fetch data", fetchSource: "crypto", fetchMethod: "GET", fetchApiIntegrationId: "", fetchUrl: "", fetchQuery: "", fetchSelector: "", fetchHeaders: "" },
        { type: "ai", title: "Summarize report", aiPrompt: "", aiIntegration: "openai", aiModel: "" },
        { type: "condition", title: "Check threshold", conditionField: "", conditionOperator: "greater_than", conditionValue: "", conditionLogic: "all", conditionFailureAction: "skip" },
        { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "scheduled", outputTime: "09:00", outputFrequency: "once", outputRecipients: "" }
      ]
    }),
  ].join("\n")

  const completion = await completeWithConfiguredLlm(systemText, userText, 1800)
  const parsed = parseJsonObject(completion.text) || buildFallbackWorkflowPayload(prompt, defaultOutput)

  const label = cleanText(String(parsed.label || "")) || "Generated Workflow"
  const description = cleanText(String(parsed.description || "")) || cleanText(prompt)
  const integrationRaw = cleanText(String(parsed.integration || "telegram")).toLowerCase() || "telegram"
  const priority = cleanText(String(parsed.priority || "medium")).toLowerCase() || "medium"

  const scheduleObj = parsed.schedule && typeof parsed.schedule === "object" ? (parsed.schedule as Record<string, unknown>) : {}
  const schedule = {
    mode: String(scheduleObj.mode || "daily").trim() || "daily",
    days: Array.isArray(scheduleObj.days) ? scheduleObj.days.map((d) => String(d).trim()).filter(Boolean) : ["mon", "tue", "wed", "thu", "fri"],
    time: String(scheduleObj.time || "09:00").trim() || "09:00",
    timezone: String(scheduleObj.timezone || "America/New_York").trim() || "America/New_York",
  }

  const stepsRaw = Array.isArray(parsed.workflowSteps)
    ? parsed.workflowSteps.map((step, index) => normalizeWorkflowStep((step || {}) as WorkflowStep, index))
    : []

  const llmSet = new Set(llmOptions.length > 0 ? llmOptions : ["openai", "claude", "grok", "gemini"])
  const integration = outputSet.has(integrationRaw) ? integrationRaw : defaultOutput
  const apiById = new Map(apiIntegrations.map((item) => [item.id, item.endpoint]))

  let steps = stepsRaw.map((step) => {
    if (step.type === "ai") {
      const provider = String(step.aiIntegration || "").trim().toLowerCase()
      if (!llmSet.has(provider)) {
        step.aiIntegration = defaultLlm
      }
      return step
    }
    if (step.type === "output") {
      const channel = String(step.outputChannel || "").trim().toLowerCase()
      if (!outputSet.has(channel)) {
        step.outputChannel = defaultOutput
      }
      if (forceImmediateOutput) {
        step.outputTiming = "immediate"
      } else if (String(step.outputTiming || "").trim() !== "immediate" && String(step.outputTiming || "").trim() !== "scheduled" && String(step.outputTiming || "").trim() !== "digest") {
        step.outputTiming = "immediate"
      }
      step.outputRecipients = normalizeOutputRecipientsForChannel(String(step.outputChannel || defaultOutput), step.outputRecipients)
      return step
    }
    if (step.type === "condition") {
      let field = String(step.conditionField || "").trim()
      // Normalize common generator mistakes for source-count checks.
      if (/credibleSourceCount/i.test(field)) {
        field = "data.credibleSourceCount"
      }
      // Runtime condition parser supports dot-path lookups, not template/bracket expressions.
      if (isInvalidConditionFieldPath(field)) {
        return null
      }
      step.conditionField = field
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "web") {
      const rawUrl = String(step.fetchUrl || "").trim()
      const rawQuery = String(step.fetchQuery || "").trim()
      if (rawUrl && isSearchLikeUrl(rawUrl)) {
        const extracted = extractSearchQueryFromUrl(rawUrl)
        if (extracted && !rawQuery) step.fetchQuery = extracted
        if (extracted || rawQuery) step.fetchUrl = ""
      }
      // For web-search missions, use clean defaults and avoid stale placeholder config.
      step.fetchHeaders = ""
      if (!String(step.fetchSelector || "").trim() || isSearchLikeUrl(rawUrl) || String(step.fetchQuery || "").trim()) {
        step.fetchSelector = "a[href]"
      }
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "api") {
      const apiId = String(step.fetchApiIntegrationId || "").trim()
      if (apiId && apiById.has(apiId) && !String(step.fetchUrl || "").trim()) {
        step.fetchUrl = String(apiById.get(apiId) || "")
      }
      if (!apiId && step.fetchUrl) {
        const byEndpoint = apiIntegrations.find((item) => String(item.endpoint).trim() === String(step.fetchUrl || "").trim())
        if (byEndpoint) step.fetchApiIntegrationId = byEndpoint.id
      }
      const rawUrl = String(step.fetchUrl || "").trim()
      // If model places a search URL under API source, normalize to web-search source.
      if (isSearchLikeUrl(rawUrl)) {
        const extracted = extractSearchQueryFromUrl(rawUrl)
        step.fetchSource = "web"
        step.fetchMethod = "GET"
        step.fetchUrl = extracted ? "" : rawUrl
        step.fetchQuery = extracted || String(step.fetchQuery || "")
        step.fetchHeaders = ""
        step.fetchSelector = "a[href]"
        return step
      }
      const isCryptoPanic = /cryptopanic\.com\/api\/v1\/posts/i.test(rawUrl)
      const hasMissingAuthToken = /auth_token=\s*(?:&|$)/i.test(rawUrl) || (!/auth_token=/i.test(rawUrl))
      // Avoid generating auth-required news endpoints without credentials.
      if (isCryptoPanic && hasMissingAuthToken) {
        step.fetchSource = "rss"
        step.fetchUrl = "https://feeds.feedburner.com/coindesk"
        step.fetchQuery = ""
        step.fetchHeaders = ""
        step.fetchSelector = ""
      }
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "rss") {
      if (!String(step.fetchUrl || "").trim()) {
        step.fetchUrl = "https://feeds.feedburner.com/coindesk"
      }
      return step
    }
    return step
  }).filter((step): step is WorkflowStep => Boolean(step))

  steps = simplifyGeneratedWorkflowSteps({
    steps,
    prompt,
    schedule,
    defaultOutput: integration,
    defaultLlm,
  })

  const derivedApiCalls = Array.from(
    new Set(
      steps.flatMap((step) => {
        if (step.type === "fetch") {
          if (step.fetchApiIntegrationId) return [`INTEGRATION:${step.fetchApiIntegrationId}`]
          if (step.fetchUrl?.trim()) return [`${String(step.fetchMethod || "GET").toUpperCase()} ${step.fetchUrl.trim()}`]
          return [`FETCH:${step.fetchSource || "api"}`]
        }
        if (step.type === "ai") return [`LLM:${step.aiIntegration || defaultLlm}`]
        if (step.type === "output") return [`OUTPUT:${step.outputChannel || defaultOutput}`]
        return []
      }),
    ),
  )

  const summary: WorkflowSummary = {
    description,
    priority,
    schedule,
    missionActive: true,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    apiCalls: derivedApiCalls,
    workflowSteps: steps.length > 0 ? steps : [
      normalizeWorkflowStep({ type: "trigger", title: "Mission triggered", triggerMode: "daily", triggerTime: schedule.time, triggerTimezone: schedule.timezone, triggerDays: schedule.days }, 0),
      normalizeWorkflowStep({ type: "output", title: "Send notification", outputChannel: outputSet.has(integration) ? integration : defaultOutput, outputTiming: "scheduled", outputTime: schedule.time, outputFrequency: "once" }, 1),
    ],
  }

  return {
    workflow: {
      label,
      integration,
      summary,
    },
    provider: completion.provider,
    model: completion.model,
  }
}

export async function executeMissionWorkflow(input: ExecuteMissionWorkflowInput): Promise<ExecuteMissionWorkflowResult> {
  const now = input.now ?? new Date()
  const parsed = parseMissionWorkflow(input.schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const integrationCatalog = await loadIntegrationCatalog()
  const apiEndpointById = new Map(
    integrationCatalog
      .filter((item) => item.kind === "api" && item.connected && item.endpoint)
      .map((item) => [item.id, String(item.endpoint || "").trim()]),
  )

  const context: Record<string, unknown> = {
    mission: {
      id: input.schedule.id,
      label: input.schedule.label,
      integration: input.schedule.integration,
      time: input.schedule.time,
      timezone: input.schedule.timezone,
      source: input.source,
    },
    description: parsed.description,
    summary: parsed.summary || {},
    nowIso: now.toISOString(),
    data: null,
    ai: null,
  }

  let skipped = false
  let skipReason = ""
  let outputs: Array<{ ok: boolean; error?: string; status?: number }> = []
  const stepTraces: WorkflowStepTrace[] = []

  const completeStepTrace = (
    step: WorkflowStep,
    status: WorkflowStepTrace["status"],
    detail?: string,
    startedAt?: string,
  ) => {
    stepTraces.push({
      stepId: String(step.id || "").trim() || `step-${stepTraces.length + 1}`,
      type: String(step.type || "output"),
      title: String(step.title || step.type || "Step"),
      status,
      detail: detail?.trim() || undefined,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
    })
  }

  for (const step of steps) {
    const type = String(step.type || "").toLowerCase()

    if (type === "trigger") {
      const startedAt = new Date().toISOString()
      context.trigger = {
        mode: step.triggerMode || "daily",
        time: step.triggerTime || input.schedule.time,
        timezone: step.triggerTimezone || input.schedule.timezone,
      }
      completeStepTrace(step, "completed", "Trigger context prepared.", startedAt)
      continue
    }

    if (type === "fetch") {
      const startedAt = new Date().toISOString()
      let source = String(step.fetchSource || "api").toLowerCase()
      const method = String(step.fetchMethod || "GET").toUpperCase() === "POST" ? "POST" : "GET"
      let url = String(step.fetchUrl || "").trim()
      const apiId = String(step.fetchApiIntegrationId || "").trim()
      if (!url && source === "api") {
        if (apiId && apiEndpointById.has(apiId)) {
          url = String(apiEndpointById.get(apiId) || "")
        }
      }
      if (!url && source === "crypto") url = "https://api.coingecko.com/api/v3/global"
      if (!url && source === "calendar") url = "/api/calendar/events"
      if (!url && source === "rss") url = "https://feeds.feedburner.com/coindesk"

      const headers = parseHeadersJson(step.fetchHeaders)
      const query = String(step.fetchQuery || "").trim()
      const requestHeaders: Record<string, string> = {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...headers,
      }
      if (source === "web") {
        if (!hasHeader(requestHeaders, "Accept")) {
          requestHeaders.Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        if (!hasHeader(requestHeaders, "User-Agent")) {
          requestHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
      }
      const inferredSearchQuery = deriveWebSearchQuery({
        explicitQuery: query,
        url,
        stepTitle: step.title,
        workflowDescription: parsed.description,
        missionLabel: input.schedule.label,
      })
      // Safety net: generator may emit API fetch with no URL for clearly web-search missions.
      if (source !== "web" && !url && !apiId && inferredSearchQuery.length > 0) {
        source = "web"
      }
      const useSearchPipeline = source === "web" && inferredSearchQuery.length > 0 && (!url || isSearchEngineUrl(url) || query.length > 0)
      if (useSearchPipeline) {
        const webResearch = await searchWebAndCollect(inferredSearchQuery, requestHeaders)
        const usable = webResearch.results.filter((item) => isUsableWebResult(item))
        context.data = {
          source,
          mode: "web-search",
          provider: webResearch.provider,
          query: webResearch.query,
          status: usable.length > 0 ? 200 : 502,
          ok: usable.length > 0,
          credibleSourceCount: usable.length,
          sourceUrls: usable.map((item) => item.url),
          payload: {
            searchUrl: webResearch.searchUrl,
            searchTitle: webResearch.searchTitle,
            searchText: webResearch.searchText,
            results: webResearch.results,
            credibleSourceCount: usable.length,
            sourceUrls: usable.map((item) => item.url),
            links: usable.map((item) => item.url),
            text: truncateForModel(
              usable
                .map((item) => `${item.title}\n${item.pageText || item.snippet}\n${item.url}`)
                .join("\n\n"),
              12000,
            ),
          },
        }
        if (usable.length > 0) {
          completeStepTrace(step, "completed", `Searched web via ${webResearch.provider} for "${inferredSearchQuery}" and found ${usable.length} usable sources.`, startedAt)
        } else {
          completeStepTrace(step, "failed", `Web search via ${webResearch.provider} for "${inferredSearchQuery}" returned no usable sources.`, startedAt)
        }
        continue
      }
      if (!url) {
        context.data = { source, error: source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured." }
        completeStepTrace(step, "failed", source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured.", startedAt)
        continue
      }

      const queryPrefix = query && !url.includes("?") ? "?" : query ? "&" : ""
      const requestUrl = url.startsWith("http") ? `${url}${queryPrefix}${query}` : `http://localhost:3000${url}${queryPrefix}${query}`
      const effectiveRequestUrl = source === "web" ? normalizeWebSearchRequestUrl(requestUrl) : requestUrl

      try {
        const res = await fetch(effectiveRequestUrl, {
          method,
          headers: requestHeaders,
          body: method === "POST" ? JSON.stringify({ query, scheduleId: input.schedule.id }) : undefined,
          cache: "no-store",
        })

        const contentType = String(res.headers.get("content-type") || "")
        let payload: unknown
        if (contentType.includes("application/json")) {
          payload = await res.json().catch(() => null)
        } else {
          const htmlText = await res.text().catch(() => "")
          payload = htmlText
          if (source === "web") {
            const links = extractHtmlLinks(htmlText, res.url || effectiveRequestUrl)
            const plainText = stripHtmlToText(htmlText)
            const selectedBySelector = step.fetchSelector && typeof htmlText === "string"
              ? (() => {
                  const selector = step.fetchSelector.trim().toLowerCase()
                  if (selector === "a[href]" || selector === "a") return links
                  return null
                })()
              : null
            payload = {
              title: extractHtmlTitle(htmlText),
              url: effectiveRequestUrl,
              finalUrl: res.url || effectiveRequestUrl,
              text: plainText.length > 12000 ? `${plainText.slice(0, 12000)}...` : plainText,
              sourceUrls: links.map((item) => item.href),
              links,
              selected: selectedBySelector || undefined,
            }
          }
          if (source === "web" && step.fetchSelector && typeof htmlText === "string") {
            const selector = step.fetchSelector.trim()
            const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(selector)
            const classMatch = /^\.([A-Za-z0-9_-]+)$/.exec(selector)
            if (idMatch) {
              const id = idMatch[1]
              const rx = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(htmlText)
              if (match && typeof payload === "object" && payload) {
                ;(payload as Record<string, unknown>).selected = cleanText(match[1].replace(/<[^>]+>/g, " "))
              }
            } else if (classMatch) {
              const cls = classMatch[1]
              const rx = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(htmlText)
              if (match && typeof payload === "object" && payload) {
                ;(payload as Record<string, unknown>).selected = cleanText(match[1].replace(/<[^>]+>/g, " "))
              }
            }
          }
        }

        const credibleSourceCount = source === "web"
          ? (() => {
              if (payload && typeof payload === "object") {
                const p = payload as Record<string, unknown>
                if (Array.isArray(p.sourceUrls)) return p.sourceUrls.filter(Boolean).length
                if (Array.isArray(p.links)) return p.links.filter(Boolean).length
              }
              return 0
            })()
          : 0
        context.data = {
          source,
          url: effectiveRequestUrl,
          status: res.status,
          ok: res.ok,
          payload,
          ...(source === "web"
            ? {
                credibleSourceCount,
                sourceUrls:
                  payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).sourceUrls)
                    ? ((payload as Record<string, unknown>).sourceUrls as unknown[]).map((item) => String(item)).filter(Boolean)
                    : [],
              }
            : {}),
        }
        if (!res.ok) {
          completeStepTrace(step, "failed", `Fetch returned status ${res.status} from ${effectiveRequestUrl}.`, startedAt)
        } else {
          completeStepTrace(step, "completed", `Fetched data from ${effectiveRequestUrl}.`, startedAt)
        }
      } catch (error) {
        context.data = { source, url: effectiveRequestUrl, error: error instanceof Error ? error.message : "fetch failed" }
        completeStepTrace(step, "failed", error instanceof Error ? error.message : "Fetch failed.", startedAt)
      }
      continue
    }

    if (type === "transform") {
      const startedAt = new Date().toISOString()
      const action = String(step.transformAction || "normalize").toLowerCase()
      const format = String(step.transformFormat || "markdown").toLowerCase()
      const inputData = context.data
      let outputData: unknown = inputData

      if (action === "dedupe" && Array.isArray(inputData)) {
        outputData = Array.from(new Map(inputData.map((item) => [JSON.stringify(item), item])).values())
      }
      if (action === "aggregate" && Array.isArray(inputData)) {
        outputData = { count: inputData.length, sample: inputData.slice(0, 5) }
      }
      if (action === "format") {
        const text = toTextPayload(inputData)
        outputData = format === "json" ? inputData : text
      }
      if (action === "normalize") {
        outputData = typeof inputData === "string" ? cleanText(inputData) : inputData
      }

      context.data = outputData
      completeStepTrace(step, "completed", `Transform action '${action}' applied (${format}).`, startedAt)
      continue
    }

    if (type === "condition") {
      const startedAt = new Date().toISOString()
      const field = String(step.conditionField || "").trim()
      const operator = String(step.conditionOperator || "contains").trim()
      const expected = String(step.conditionValue || "")
      let value = field ? getByPath(context, field) : undefined
      if (typeof value === "undefined" && /(^|\.)(credibleSourceCount)$/i.test(field)) {
        value = deriveCredibleSourceCountFromContext(context)
      }

      let pass = true
      if (operator === "exists") {
        pass = typeof value !== "undefined" && value !== null && String(value).trim() !== ""
      } else if (operator === "equals") {
        pass = String(value ?? "") === expected
      } else if (operator === "not_equals") {
        pass = String(value ?? "") !== expected
      } else if (operator === "greater_than") {
        pass = (toNumberSafe(value) ?? Number.NEGATIVE_INFINITY) > (toNumberSafe(expected) ?? Number.POSITIVE_INFINITY)
      } else if (operator === "less_than") {
        pass = (toNumberSafe(value) ?? Number.POSITIVE_INFINITY) < (toNumberSafe(expected) ?? Number.NEGATIVE_INFINITY)
      } else if (operator === "regex") {
        try {
          pass = new RegExp(expected).test(String(value ?? ""))
        } catch {
          pass = false
        }
      } else {
        pass = String(value ?? "").toLowerCase().includes(expected.toLowerCase())
      }

      if (!pass) {
        const failure = String(step.conditionFailureAction || "skip").toLowerCase()
        if (failure === "stop") {
          completeStepTrace(step, "failed", `Condition failed on '${field}' with stop action.`, startedAt)
          return { ok: false, skipped: true, outputs, reason: "Condition failed with stop action.", stepTraces }
        }
        if (failure === "notify") {
          const warnText = `Mission \"${input.schedule.label}\" condition failed on field \"${field}\".`
          const notifyResults = await dispatchOutput(input.schedule.integration || "telegram", warnText, input.schedule.chatIds, input.schedule)
          outputs = outputs.concat(notifyResults)
          completeStepTrace(step, "completed", `Condition failed and notify fallback was sent for '${field}'.`, startedAt)
        } else {
          completeStepTrace(step, "skipped", `Condition failed on '${field}'.`, startedAt)
        }
        skipped = true
        skipReason = "Condition check failed."
      } else {
        completeStepTrace(step, "completed", `Condition passed on '${field || "context"}'.`, startedAt)
      }
      if (skipped) break
      continue
    }

    if (type === "ai") {
      const startedAt = new Date().toISOString()
      const aiPrompt = String(step.aiPrompt || "").trim()
      if (!aiPrompt) {
        completeStepTrace(step, "skipped", "AI prompt is empty.", startedAt)
        continue
      }
      if (!hasUsableContextData(context.data)) {
        context.ai = "No reliable fetched data is available for this run. Skipping AI analysis to avoid fabricated output."
        context.aiSkipped = true
        completeStepTrace(step, "skipped", "No reliable fetched data available for AI analysis.", startedAt)
        continue
      }
      const systemText = "You are Nova workflow AI. Use only the provided context data. Never fabricate facts, events, prices, or links. If context is incomplete, state that clearly. Return concise, actionable output."
      const userText = [
        `Step: ${step.title || "AI step"}`,
        `Instruction: ${aiPrompt}`,
        "Context JSON:",
        toTextPayload(context.data),
      ].join("\n\n")
      try {
        const completion = await completeWithConfiguredLlm(systemText, userText, 900)
        let aiText = completion.text
        let provider = completion.provider
        let model = completion.model

        if (isNoDataText(aiText) && hasWebSearchUsableSources(context.data)) {
          const forcedPrompt = buildForcedWebSummaryPrompt(context.data)
          const retry = await completeWithConfiguredLlm(systemText, forcedPrompt, 900)
          aiText = retry.text
          provider = retry.provider
          model = retry.model
        }

        aiText = humanizeMissionOutputText(aiText, context.data)

        context.ai = aiText
        context.lastAiProvider = provider
        context.lastAiModel = model
        completeStepTrace(step, "completed", `AI completed using ${provider}/${model}.`, startedAt)
      } catch (error) {
        context.ai = `AI step failed: ${error instanceof Error ? error.message : "Unknown error"}`
        completeStepTrace(step, "failed", error instanceof Error ? error.message : "AI step failed.", startedAt)
      }
      continue
    }

    if (type === "output") {
      const startedAt = new Date().toISOString()
      const channel = String(step.outputChannel || input.schedule.integration || "telegram").toLowerCase()
      const timing = String(step.outputTiming || "immediate").toLowerCase()
      const outputTime = String(step.outputTime || input.schedule.time || "").trim()
      if (input.enforceOutputTime && (timing === "scheduled" || timing === "digest")) {
        const target = parseTime(outputTime)
        const local = getLocalTimeParts(now, input.schedule.timezone || "America/New_York")
        if (target && local && (target.hour !== local.hour || target.minute !== local.minute)) {
          skipped = true
          skipReason = "Output timing does not match this tick."
          completeStepTrace(step, "skipped", skipReason, startedAt)
          continue
        }
      }

      const rawTemplate = String(step.outputTemplate || "").trim()
      const baseTextRaw = rawTemplate
        ? interpolateTemplate(rawTemplate, context)
        : String(context.ai || parsed.description || input.schedule.message)
      const baseText = humanizeMissionOutputText(baseTextRaw, context.data)

      const recipientString = String(step.outputRecipients || "").trim()
      const parsedRecipients = recipientString
        ? recipientString.split(/[,\n]/).map((r) => r.trim()).filter(Boolean)
        : []
      const recipients = parsedRecipients.filter((recipient) => !isTemplateRecipient(recipient))
      const resolvedRecipients = recipients.length > 0 ? recipients : input.schedule.chatIds

      const frequency = String(step.outputFrequency || "once").toLowerCase()
      const repeatCount = Math.max(1, Math.min(10, Number(step.outputRepeatCount || "1") || 1))
      const loops = frequency === "multiple" ? repeatCount : 1

      for (let i = 0; i < loops; i += 1) {
        const text = loops > 1 ? `${baseText}\n\n(${i + 1}/${loops})` : baseText
        const result = await dispatchOutput(channel, text, resolvedRecipients, input.schedule)
        outputs = outputs.concat(result)
      }
      const stepResults = outputs.slice(-loops)
      const outputOk = stepResults.some((result) => result.ok)
      const outputError = stepResults.find((result) => !result.ok && result.error)?.error
      completeStepTrace(
        step,
        outputOk ? "completed" : "failed",
        outputOk ? `Output sent via ${channel}.` : `Output failed via ${channel}${outputError ? `: ${outputError}` : "."}`,
        startedAt,
      )
      continue
    }
  }

  if (!steps.some((s) => String(s.type || "") === "output") && !skipped) {
    const startedAt = new Date().toISOString()
    const fallbackTextRaw = String(context.ai || parsed.description || input.schedule.message)
    const fallbackText = humanizeMissionOutputText(fallbackTextRaw, context.data)
    const result = await dispatchOutput(input.schedule.integration || "telegram", fallbackText, input.schedule.chatIds, input.schedule)
    outputs = outputs.concat(result)
    const fallbackOk = result.some((item) => item.ok)
    stepTraces.push({
      stepId: "fallback-output",
      type: "output",
      title: "Fallback output",
      status: fallbackOk ? "completed" : "failed",
      detail: fallbackOk ? "Fallback output sent." : "Fallback output failed.",
      startedAt,
      endedAt: new Date().toISOString(),
    })
  }

  if (skipped && outputs.length === 0) {
    return { ok: true, skipped: true, outputs: [], reason: skipReason || "Workflow skipped.", stepTraces }
  }

  const ok = outputs.some((r) => r.ok)
  return { ok, skipped: false, outputs, reason: ok ? undefined : "All workflow outputs failed.", stepTraces }
}
