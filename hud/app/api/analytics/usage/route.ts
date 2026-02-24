import { NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"

import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Log turn shape (mirrors dev-conversation-log.js output) ──────────────────

type LogTurn = {
  ts: string
  userContextId?: string
  routing?: { provider?: string } | null
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    estimatedCostUsd?: number | null
  } | null
  timing?: { latencyMs?: number } | null
  status?: { ok?: boolean; error?: string } | null
  quality?: { tags?: string[] } | null
  tools?: { calls?: string[] } | null
}

// ── Classification ────────────────────────────────────────────────────────────

const LLM_PROVIDERS = new Set(["openai", "openai-chatkit", "claude", "grok", "gemini"])

const SCRAPER_TOOLS = new Set([
  "brave_search", "web_search", "search_web", "search_the_web",
  "firecrawl_scrape", "scrape_url", "fetch_url", "web_fetch",
])

const MESSAGING_TOOLS = new Set([
  "send_telegram", "telegram_send", "telegram_message",
  "send_discord", "discord_send", "discord_message",
  "send_gmail", "gmail_send", "gmail_compose",
])

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  "openai-chatkit": "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
}

function classifyTools(calls: string[]): { scraper: number; messaging: number; unclassified: number } {
  let scraper = 0
  let messaging = 0
  let unclassified = 0
  for (const call of calls) {
    const name = call.trim().toLowerCase()
    if (SCRAPER_TOOLS.has(name)) scraper += 1
    else if (MESSAGING_TOOLS.has(name)) messaging += 1
    else unclassified += 1
  }
  return { scraper, messaging, unclassified }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function timeAgoStr(tsMs: number): string {
  const diff = Math.max(0, Date.now() - tsMs)
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function shouldSuppressActivityError(error: unknown): boolean {
  const raw = String(error ?? "").trim().toLowerCase()
  if (!raw) return false
  return (
    raw.includes("operation was aborted")
    || raw.includes("aborterror")
    || raw.includes("request aborted")
    || raw.includes("request was aborted")
    || raw.includes("cancelled")
    || raw.includes("canceled")
  )
}

async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd()
  const parent = path.resolve(cwd, "..")
  try { await fs.access(path.join(cwd, ".agent")); return cwd } catch { /* no-op */ }
  try { await fs.access(path.join(parent, ".agent")); return parent } catch { /* no-op */ }
  return cwd
}

async function readJsonlTail(filePath: string, maxBytes: number): Promise<string[]> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return []
    const start = Math.max(0, stat.size - maxBytes)
    const handle = await fs.open(filePath, "r")
    try {
      const buffer = Buffer.alloc(stat.size - start)
      await handle.read(buffer, 0, buffer.length, start)
      return buffer.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    } finally {
      await handle.close()
    }
  } catch {
    return []
  }
}

function parseUserTurns(lines: string[], userContextId: string): LogTurn[] {
  const turns: LogTurn[] = []
  for (const line of lines) {
    try {
      const t = JSON.parse(line) as LogTurn
      if (!t || typeof t !== "object" || !t.ts) continue
      if (normalizeUserContextId(t.userContextId) !== userContextId) continue
      turns.push(t)
    } catch { /* ignore malformed line */ }
  }
  return turns.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
}

// ── Timeseries ────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

type TimeseriesPoint = { time: string; llm: number; scraper: number; messaging: number; unclassified: number }

function emptyPoint(time: string): TimeseriesPoint {
  return { time, llm: 0, scraper: 0, messaging: 0, unclassified: 0 }
}

function buildRequestVolume(turns: LogTurn[], nowMs: number): Record<string, TimeseriesPoint[]> {
  // 24h — 6 four-hour buckets aligned to hour-of-day
  const bucket24h: TimeseriesPoint[] = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"].map(emptyPoint)
  const since24h = nowMs - 24 * 3_600_000

  // 7d — 7 daily buckets, oldest first
  const bucket7d: TimeseriesPoint[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(nowMs - (6 - i) * 86_400_000)
    return emptyPoint(DAY_NAMES[d.getDay()])
  })
  const since7d = nowMs - 7 * 86_400_000

  // 30d — 4 weekly buckets, Week 1 = oldest
  const bucket30d: TimeseriesPoint[] = ["Week 1", "Week 2", "Week 3", "Week 4"].map(emptyPoint)
  const since30d = nowMs - 30 * 86_400_000

  // 90d — 3 monthly buckets in chronological order
  const months90d = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(nowMs)
    d.setMonth(d.getMonth() - (2 - i))
    return { label: MONTH_NAMES[d.getMonth()], month: d.getMonth(), year: d.getFullYear() }
  })
  const bucket90d: TimeseriesPoint[] = months90d.map((m) => emptyPoint(m.label))
  const since90d = nowMs - 90 * 86_400_000

  for (const turn of turns) {
    const tsMs = Date.parse(turn.ts)
    if (!Number.isFinite(tsMs)) continue

    const provider = String(turn.routing?.provider ?? "").trim().toLowerCase()
    const isLlm = LLM_PROVIDERS.has(provider)
    const toolCalls = Array.isArray(turn.tools?.calls) ? (turn.tools!.calls as string[]) : []
    const { scraper, messaging, unclassified } = classifyTools(toolCalls)

    const add = (p: TimeseriesPoint) => {
      if (isLlm) p.llm += 1
      p.scraper += scraper
      p.messaging += messaging
      p.unclassified += unclassified
    }

    if (tsMs >= since24h) {
      const bi = Math.floor(new Date(tsMs).getHours() / 4)
      add(bucket24h[bi])
    }

    if (tsMs >= since7d) {
      // daysAgo 0 = today → bucket index 6; daysAgo 6 = 6 days ago → bucket index 0
      const daysAgo = Math.min(6, Math.floor((nowMs - tsMs) / 86_400_000))
      add(bucket7d[6 - daysAgo])
    }

    if (tsMs >= since30d) {
      // daysAgo 0-6 → Week 4 (index 3); daysAgo 21-30 → Week 1 (index 0)
      const bi = Math.min(3, Math.floor((nowMs - tsMs) / 86_400_000 / 7))
      add(bucket30d[3 - bi])
    }

    if (tsMs >= since90d) {
      const turnDate = new Date(tsMs)
      const idx = months90d.findIndex((m) => m.month === turnDate.getMonth() && m.year === turnDate.getFullYear())
      if (idx >= 0) add(bucket90d[idx])
    }
  }

  return { "24h": bucket24h, "7d": bucket7d, "30d": bucket30d, "90d": bucket90d }
}

// ── Activity feed ─────────────────────────────────────────────────────────────

type ActivityEvent = {
  id: string
  service: string
  action: string
  timeAgo: string
  status: "success" | "warning" | "error"
}

const ACTIVITY_MAX_AGE_MS = 24 * 60 * 60 * 1000
const ACTIVITY_DEDUP_WINDOW_MS = 60 * 1000

const WARNING_TAGS = new Set([
  "high_prompt_tokens", "slow_response", "uncertain_reply",
  "tool_loop_budget_exhausted", "tool_loop_step_timeout", "degraded_fallback",
])

// Maps tool call names → human-readable service label and action
const TOOL_SERVICE: Record<string, string> = {
  brave_search: "Brave", web_search: "Brave", search_web: "Brave", search_the_web: "Brave",
  firecrawl_scrape: "Firecrawl", scrape_url: "Firecrawl", fetch_url: "Firecrawl", web_fetch: "Firecrawl",
  send_telegram: "Telegram", telegram_send: "Telegram", telegram_message: "Telegram",
  send_discord: "Discord", discord_send: "Discord", discord_message: "Discord",
  send_gmail: "Gmail", gmail_send: "Gmail", gmail_compose: "Gmail",
}

const TOOL_ACTION: Record<string, string> = {
  brave_search: "Search query", web_search: "Search query", search_web: "Search query", search_the_web: "Search query",
  firecrawl_scrape: "Page scraped", scrape_url: "Page scraped", fetch_url: "URL fetched", web_fetch: "URL fetched",
  send_telegram: "Message sent", telegram_send: "Message sent", telegram_message: "Message sent",
  send_discord: "Message sent", discord_send: "Message sent", discord_message: "Message sent",
  send_gmail: "Email sent", gmail_send: "Email sent", gmail_compose: "Email composed",
}

function buildActivityFeed(turns: LogTurn[], limit = 20): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const nowMs = Date.now()
  const seenByKey = new Map<string, number>()

  const pushEvent = (event: ActivityEvent, tsMs: number) => {
    const dedupKey = `${event.service.toLowerCase()}|${event.action.toLowerCase()}|${event.status}`
    const lastSeenMs = seenByKey.get(dedupKey)
    if (typeof lastSeenMs === "number" && Math.abs(lastSeenMs - tsMs) <= ACTIVITY_DEDUP_WINDOW_MS) return
    seenByKey.set(dedupKey, tsMs)
    events.push(event)
  }

  for (let i = 0; i < turns.length && events.length < limit; i++) {
    const turn = turns[i]
    const tsMs = Date.parse(turn.ts)
    if (!Number.isFinite(tsMs)) continue
    if ((nowMs - tsMs) > ACTIVITY_MAX_AGE_MS) continue
    const provider = String(turn.routing?.provider ?? "").trim().toLowerCase()
    const service = PROVIDER_LABEL[provider] ?? (provider ? provider[0].toUpperCase() + provider.slice(1) : "Nova")
    const totalTokens = toNum(turn.usage?.totalTokens)
    const toolCalls = Array.isArray(turn.tools?.calls) ? (turn.tools!.calls as string[]) : []
    const tags = Array.isArray(turn.quality?.tags) ? (turn.quality!.tags as string[]) : []
    const isError = turn.status?.ok === false
    const isWarning = !isError && tags.some((t) => WARNING_TAGS.has(t))
    const timeAgo = Number.isFinite(tsMs) ? timeAgoStr(tsMs) : "unknown"
    const status: ActivityEvent["status"] = isError ? "error" : isWarning ? "warning" : "success"

    // Emit one event per tool call so each integration shows up individually
    for (let j = 0; j < toolCalls.length && events.length < limit; j++) {
      const name = String(toolCalls[j]).trim().toLowerCase()
      const toolService = TOOL_SERVICE[name] ?? (name ? name[0].toUpperCase() + name.slice(1) : "Tool")
      const toolAction = TOOL_ACTION[name] ?? name
      pushEvent({
        id: `tool-${i}-${j}-${tsMs}`,
        service: toolService,
        action: toolAction,
        timeAgo,
        status,
      }, tsMs)
    }

    // Emit the LLM turn event
    if (events.length < limit) {
      if (isError && shouldSuppressActivityError(turn.status?.error)) continue
      const action = isError
        ? String(turn.status?.error ?? "Request failed").slice(0, 80)
        : totalTokens > 0
          ? `${totalTokens.toLocaleString()} tokens`
          : "Response completed"
      pushEvent({
        id: `turn-${i}-${tsMs}`,
        service,
        action,
        timeAgo,
        status,
      }, tsMs)
    }
  }

  return events
}

// ── Integration stats ─────────────────────────────────────────────────────────

type IntegrationStat = { requests: number; successCount: number; totalLatencyMs: number }

function buildIntegrationStats(turns: LogTurn[]): Record<string, IntegrationStat> {
  const stats: Record<string, IntegrationStat> = {}
  for (const turn of turns) {
    const raw = String(turn.routing?.provider ?? "").trim().toLowerCase()
    if (!raw) continue
    const key = raw === "openai-chatkit" ? "openai" : raw
    if (!stats[key]) stats[key] = { requests: 0, successCount: 0, totalLatencyMs: 0 }
    stats[key].requests += 1
    if (turn.status?.ok !== false) stats[key].successCount += 1
    stats[key].totalLatencyMs += toNum(turn.timing?.latencyMs)
  }
  return stats
}

// ── Token totals ──────────────────────────────────────────────────────────────

type TokenTotal = { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number }

function buildTokenTotals(turns: LogTurn[]): Record<string, TokenTotal> {
  const totals: Record<string, TokenTotal> = {}
  for (const turn of turns) {
    const raw = String(turn.routing?.provider ?? "").trim().toLowerCase()
    if (!raw || !LLM_PROVIDERS.has(raw)) continue
    const key = raw === "openai-chatkit" ? "openai" : raw
    if (!totals[key]) totals[key] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }
    totals[key].promptTokens += toNum(turn.usage?.promptTokens)
    totals[key].completionTokens += toNum(turn.usage?.completionTokens)
    totals[key].totalTokens += toNum(turn.usage?.totalTokens)
    const cost = turn.usage?.estimatedCostUsd
    if (typeof cost === "number" && Number.isFinite(cost)) totals[key].estimatedCostUsd += cost
  }
  return totals
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const userContextId = normalizeUserContextId(verified.user.id)
  if (!userContextId) {
    return NextResponse.json({ ok: false, error: "Missing user context." }, { status: 400 })
  }

  const workspaceRoot = await resolveWorkspaceRoot()
  const logPath = path.join(workspaceRoot, ".agent", "user-context", userContextId, "logs", "conversation-dev.jsonl")

  // 8 MB read window — covers thousands of turns, enough for 90-day aggregation
  const lines = await readJsonlTail(logPath, 8 * 1024 * 1024)
  const turns = parseUserTurns(lines, userContextId)
  const nowMs = Date.now()

  return NextResponse.json({
    ok: true,
    requestVolume: buildRequestVolume(turns, nowMs),
    activityFeed: buildActivityFeed(turns, 20),
    integrationStats: buildIntegrationStats(turns),
    tokenTotals: buildTokenTotals(turns),
    turnCount: turns.length,
    generatedAt: new Date().toISOString(),
  })
}
