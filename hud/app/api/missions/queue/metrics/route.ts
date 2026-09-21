import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { getDb } from "../../../../../../src/db/index.js"

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
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionQueueMetricsRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  const now = new Date()
  const nowIso = now.toISOString()
  const sinceIso = new Date(now.getTime() - QUEUE_FAILURE_LOOKBACK_MINUTES * 60_000).toISOString()

  try {
    const db = getDb()
    const queueDepth = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status = 'pending'").get(userId) as { n?: number } | undefined)?.n || 0,
    )
    const dueDepth = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status = 'pending' AND scheduled_for <= ?")
          .get(userId, nowIso) as { n?: number } | undefined
      )?.n || 0,
    )
    const inflight = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status IN ('claimed','running')")
          .get(userId) as { n?: number } | undefined
      )?.n || 0,
    )
    const terminalCountLookback = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status IN ('succeeded','failed','dead','cancelled') AND finished_at >= ?",
          )
          .get(userId, sinceIso) as { n?: number } | undefined
      )?.n || 0,
    )
    const failedCountLookback = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM job_runs WHERE user_id = ? AND status IN ('failed','dead') AND finished_at >= ?",
          )
          .get(userId, sinceIso) as { n?: number } | undefined
      )?.n || 0,
    )
    const oldestDueScheduledFor =
      (
        db
          .prepare(
            "SELECT scheduled_for FROM job_runs WHERE user_id = ? AND status = 'pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT 1",
          )
          .get(userId, nowIso) as { scheduled_for?: string } | undefined
      )?.scheduled_for ?? null

    const oldestDueMs = typeof oldestDueScheduledFor === "string" ? Date.parse(oldestDueScheduledFor) : NaN
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load queue metrics."
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
