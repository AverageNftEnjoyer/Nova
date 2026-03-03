import { NextResponse } from "next/server"

import { createSupabaseAdminClient, requireSupabaseApiUser } from "@/lib/supabase/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readIntEnv(name: string, fallback: number, minValue: number, maxValue: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minValue, Math.min(maxValue, parsed))
}

const QUEUE_FAILURE_LOOKBACK_MINUTES = readIntEnv("NOVA_MISSIONS_QUEUE_FAILURE_LOOKBACK_MINUTES", 60, 5, 24 * 60)

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const userId = verified.user.id
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionQueueMetricsRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const db = createSupabaseAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()
  const sinceIso = new Date(now.getTime() - QUEUE_FAILURE_LOOKBACK_MINUTES * 60_000).toISOString()

  const [pendingCountRes, dueCountRes, inflightCountRes, terminalCountRes, failedTerminalCountRes, oldestDueRes] = await Promise.all([
    db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
    db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("scheduled_for", nowIso),
    db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["claimed", "running"]),
    db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["succeeded", "failed", "dead", "cancelled"])
      .gte("finished_at", sinceIso),
    db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["failed", "dead"])
      .gte("finished_at", sinceIso),
    db
      .from("job_runs")
      .select("scheduled_for")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  const firstError =
    pendingCountRes.error ||
    dueCountRes.error ||
    inflightCountRes.error ||
    terminalCountRes.error ||
    failedTerminalCountRes.error ||
    oldestDueRes.error
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message || "Failed to load queue metrics." }, { status: 500 })
  }

  const queueDepth = Math.max(0, Number(pendingCountRes.count || 0))
  const dueDepth = Math.max(0, Number(dueCountRes.count || 0))
  const inflight = Math.max(0, Number(inflightCountRes.count || 0))
  const terminalCountLookback = Math.max(0, Number(terminalCountRes.count || 0))
  const failedCountLookback = Math.max(0, Number(failedTerminalCountRes.count || 0))
  const oldestDueScheduledFor = typeof oldestDueRes.data?.scheduled_for === "string" ? oldestDueRes.data.scheduled_for : null
  const oldestDueMs = oldestDueScheduledFor ? Date.parse(oldestDueScheduledFor) : NaN
  const lagMs = Number.isFinite(oldestDueMs) ? Math.max(0, now.getTime() - oldestDueMs) : 0
  const lagSeconds = Math.max(0, Math.round(lagMs / 1000))
  const failureRate = terminalCountLookback > 0 ? failedCountLookback / terminalCountLookback : 0

  return NextResponse.json({
    ok: true,
    metrics: {
      asOf: nowIso,
      lookbackMinutes: QUEUE_FAILURE_LOOKBACK_MINUTES,
      queueDepth,
      dueDepth,
      inflight,
      lagMs,
      lagSeconds,
      oldestDueScheduledFor,
      terminalCountLookback,
      failedCountLookback,
      failureRate,
    },
  })
}
