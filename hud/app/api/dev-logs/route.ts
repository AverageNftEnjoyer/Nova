import { NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"

import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DevTurn = {
  turnId: string
  ts: string
  conversationId: string
  source: string
  sender: string
  userContextId: string
  route: string
  routing?: { provider?: string; model?: string } | null
  usage?: { totalTokens?: number } | null
  timing?: { latencyMs?: number; hotPath?: string } | null
  status?: { ok?: boolean; error?: string } | null
  quality?: { score?: number; tags?: string[] } | null
  input?: { user?: { text?: string; chars?: number } } | null
  output?: { assistant?: { text?: string; chars?: number } } | null
  tools?: { calls?: string[] } | null
}

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))
  return Number(sorted[index] || 0)
}

async function readJsonlTail(filePath: string, maxBytes: number): Promise<string[]> {
  let content = ""
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return []
    const start = Math.max(0, stat.size - maxBytes)
    const handle = await fs.open(filePath, "r")
    try {
      const buffer = Buffer.alloc(stat.size - start)
      await handle.read(buffer, 0, buffer.length, start)
      content = buffer.toString("utf8")
    } finally {
      await handle.close()
    }
  } catch {
    return []
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines
}

function parseTurns(lines: string[], userContextId: string, limit: number): DevTurn[] {
  const turns: DevTurn[] = []
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as DevTurn
      if (!parsed || typeof parsed !== "object") continue
      if (String(parsed.userContextId || "").trim().toLowerCase() !== userContextId) continue
      turns.push(parsed)
    } catch {
      // ignore malformed line
    }
  }
  turns.sort((a, b) => Date.parse(String(b.ts || "")) - Date.parse(String(a.ts || "")))
  return turns.slice(0, limit)
}

function buildSummary(turns: DevTurn[]) {
  const latencies = turns.map((turn) => toFiniteNumber(turn.timing?.latencyMs)).filter((value) => value > 0)
  const qualityScores = turns.map((turn) => toFiniteNumber(turn.quality?.score)).filter((value) => value > 0)
  const providerCounts = new Map<string, number>()
  const hotPathCounts = new Map<string, number>()
  const conversationCounts = new Map<string, number>()
  let okCount = 0
  let errorCount = 0
  let emptyReplyCount = 0
  let totalTokens = 0

  for (const turn of turns) {
    const provider = String(turn.routing?.provider || "unknown").trim().toLowerCase() || "unknown"
    providerCounts.set(provider, Number(providerCounts.get(provider) || 0) + 1)
    const hotPath = String(turn.timing?.hotPath || "unknown").trim().toLowerCase() || "unknown"
    hotPathCounts.set(hotPath, Number(hotPathCounts.get(hotPath) || 0) + 1)
    const conversationId = String(turn.conversationId || "").trim()
    if (conversationId) conversationCounts.set(conversationId, Number(conversationCounts.get(conversationId) || 0) + 1)
    if (turn.status?.ok === false) errorCount += 1
    else okCount += 1
    if (!String(turn.output?.assistant?.text || "").trim()) emptyReplyCount += 1
    totalTokens += toFiniteNumber(turn.usage?.totalTokens)
  }

  const providerBreakdown = [...providerCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  const hotPathBreakdown = [...hotPathCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  const conversationBreakdown = [...conversationCounts.entries()]
    .map(([conversationId, turnsCount]) => ({ conversationId, turnsCount }))
    .sort((a, b) => b.turnsCount - a.turnsCount)

  return {
    totalTurns: turns.length,
    activeConversations: conversationCounts.size,
    okCount,
    errorCount,
    emptyReplyCount,
    reliabilityPct: turns.length > 0 ? Number(((okCount / turns.length) * 100).toFixed(2)) : 100,
    totalTokens,
    averageTokensPerTurn: turns.length > 0 ? Math.round(totalTokens / turns.length) : 0,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      average: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    },
    quality: {
      average: qualityScores.length > 0 ? Number((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length).toFixed(2)) : 0,
      min: qualityScores.length > 0 ? Math.min(...qualityScores) : 0,
      max: qualityScores.length > 0 ? Math.max(...qualityScores) : 0,
    },
    providerBreakdown,
    hotPathBreakdown,
    conversationBreakdown,
  }
}

async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd()
  const parent = path.resolve(cwd, "..")
  const cwdAgentPath = path.join(cwd, ".agent")
  const parentAgentPath = path.join(parent, ".agent")
  try {
    await fs.access(cwdAgentPath)
    return cwd
  } catch {
    // no-op
  }
  try {
    await fs.access(parentAgentPath)
    return parent
  } catch {
    // no-op
  }
  return cwd
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const userContextId = normalizeUserContextId(verified.user.id)
  if (!userContextId) return NextResponse.json({ ok: false, error: "Missing user context." }, { status: 400 })

  const url = new URL(req.url)
  const limit = Math.max(20, Math.min(500, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200))
  const maxBytes = Math.max(128 * 1024, Math.min(8 * 1024 * 1024, Number.parseInt(url.searchParams.get("maxBytes") || `${4 * 1024 * 1024}`, 10) || 4 * 1024 * 1024))
  const workspaceRoot = await resolveWorkspaceRoot()
  const logPath = path.join(workspaceRoot, ".agent", "user-context", userContextId, "logs", "conversation-dev.jsonl")
  const lines = await readJsonlTail(logPath, maxBytes)
  const turns = parseTurns(lines, userContextId, limit)
  const summary = buildSummary(turns)

  let fileMeta: { exists: boolean; bytes: number; updatedAt: string | null } = { exists: false, bytes: 0, updatedAt: null }
  try {
    const stat = await fs.stat(logPath)
    fileMeta = {
      exists: stat.isFile(),
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  } catch {
    // file not present yet
  }

  return NextResponse.json({
    ok: true,
    userContextId,
    logPath,
    file: fileMeta,
    summary,
    turns,
    generatedAt: new Date().toISOString(),
  })
}
