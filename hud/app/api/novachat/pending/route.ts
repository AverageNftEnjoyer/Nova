import { NextResponse } from "next/server"
import { checkUserRateLimit, createRateLimitHeaders, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import {
  loadPendingMessages,
  type PendingNovaChatMessage,
  markMessagesConsumedForUser,
} from "@/lib/novachat/pending-messages"

export const runtime = "nodejs"

type PendingDeliveryLeaseState = typeof globalThis & {
  __novaPendingDeliveryLeaseByKey?: Map<string, number>
  __novaPendingDeliveryLeaseLastGcAt?: number
}

const pendingDeliveryLeaseState = globalThis as PendingDeliveryLeaseState
const pendingDeliveryLeaseByKey = pendingDeliveryLeaseState.__novaPendingDeliveryLeaseByKey ?? new Map<string, number>()
pendingDeliveryLeaseState.__novaPendingDeliveryLeaseByKey = pendingDeliveryLeaseByKey

function readIntEnv(name: string, fallback: number, minValue: number, maxValue: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minValue, Math.min(maxValue, parsed))
}

const PENDING_DELIVERY_LEASE_MS = readIntEnv("NOVA_PENDING_DELIVERY_LEASE_MS", 12_000, 1_000, 60_000)
const PENDING_DELIVERY_LEASE_GC_MS = readIntEnv("NOVA_PENDING_DELIVERY_LEASE_GC_MS", 30_000, 5_000, 120_000)
const PENDING_DELIVERY_MAX_BATCH = readIntEnv("NOVA_PENDING_DELIVERY_MAX_BATCH", 50, 1, 200)
const PENDING_DELIVERY_MAX_CONSUME_IDS = readIntEnv("NOVA_PENDING_DELIVERY_MAX_CONSUME_IDS", 200, 1, 2000)

function normalizeScope(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function buildDeliveryLeaseKey(userId: string, messageId: string): string {
  const userScope = normalizeScope(userId)
  const messageScope = normalizeScope(messageId).slice(0, 128)
  if (!userScope || !messageScope) return ""
  return `${userScope}:${messageScope}`
}

function maybeCollectPendingDeliveryLeaseGarbage(nowMs: number): void {
  const lastGc = Number(pendingDeliveryLeaseState.__novaPendingDeliveryLeaseLastGcAt || 0)
  if (nowMs - lastGc < PENDING_DELIVERY_LEASE_GC_MS) return
  pendingDeliveryLeaseState.__novaPendingDeliveryLeaseLastGcAt = nowMs
  for (const [key, leaseUntil] of pendingDeliveryLeaseByKey.entries()) {
    if (!key || Number(leaseUntil || 0) <= nowMs) {
      pendingDeliveryLeaseByKey.delete(key)
    }
  }
}

function leaseDeliverableMessages(userId: string, messages: PendingNovaChatMessage[]): PendingNovaChatMessage[] {
  const nowMs = Date.now()
  maybeCollectPendingDeliveryLeaseGarbage(nowMs)
  const deliverable: PendingNovaChatMessage[] = []
  for (const msg of messages) {
    if (deliverable.length >= PENDING_DELIVERY_MAX_BATCH) break
    const key = buildDeliveryLeaseKey(userId, msg.id)
    if (!key) continue
    const leaseUntil = Number(pendingDeliveryLeaseByKey.get(key) || 0)
    if (leaseUntil > nowMs) continue
    pendingDeliveryLeaseByKey.set(key, nowMs + PENDING_DELIVERY_LEASE_MS)
    deliverable.push(msg)
  }
  return deliverable
}

function releaseDeliveryLeases(userId: string, messageIds: string[]): void {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return
  for (const messageId of messageIds) {
    const key = buildDeliveryLeaseKey(userId, messageId)
    if (!key) continue
    pendingDeliveryLeaseByKey.delete(key)
  }
}

function parseMessageIdsFromBody(body: unknown): string[] {
  const input = body && typeof body === "object" ? (body as { messageIds?: unknown }).messageIds : []
  const rawIds = Array.isArray(input) ? input : []
  const deduped = new Set<string>()
  for (const id of rawIds) {
    const normalized = normalizeMessageId(id)
    if (!normalized) continue
    deduped.add(normalized)
    if (deduped.size >= PENDING_DELIVERY_MAX_CONSUME_IDS) break
  }
  return [...deduped]
}

function normalizeMessageId(value: unknown): string {
  const messageId = String(value || "").trim()
  if (!messageId || messageId.length > 128) return ""
  // Keep exact ID value for consume matching, only allow known-safe token chars.
  if (!/^[A-Za-z0-9._:-]+$/.test(messageId)) return ""
  return messageId
}

/**
 * GET: Fetch pending NovaChat messages for the authenticated user.
 */
export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.novachatPendingPoll)
  if (!limit.allowed) {
    const retryAfterMs = Math.max(0, Math.round(Number(limit.retryAfterSeconds || 0) * 1000))
    const headers = createRateLimitHeaders(limit)
    headers.set("Cache-Control", "no-store")
    return NextResponse.json(
      {
        ok: true,
        messages: [],
        rateLimited: true,
        retryAfterMs,
      },
      {
        status: 200,
        headers,
      },
    )
  }

  try {
    const messages = await loadPendingMessages(verified.user.id)
    const deliverable = leaseDeliverableMessages(verified.user.id, messages)
    return NextResponse.json(
      { ok: true, messages: deliverable },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load messages" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}

/**
 * POST: Mark messages as consumed after the chat UI has processed them.
 */
export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const messageIds = parseMessageIdsFromBody(body)

    if (messageIds.length > 0) {
      try {
        await markMessagesConsumedForUser(verified.user.id, messageIds)
      } finally {
        releaseDeliveryLeases(verified.user.id, messageIds)
      }
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark messages" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
