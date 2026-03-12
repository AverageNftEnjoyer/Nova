/**
 * Trigger Node Executors
 */

import type { ScheduleTriggerNode, ManualTriggerNode, WebhookTriggerNode, EventTriggerNode, PolymarketPriceTriggerNode, PolymarketMonitorNode, NodeOutput, ExecutionContext } from "../../types/index"
import { getLocalParts, parseTime } from "../time"
import { resolveTimezone } from "@/lib/shared/timezone"
import {
  fetchPolymarketMarkets,
  fetchPolymarketPriceHistory,
  fetchPolymarketPrices,
} from "@/lib/integrations/polymarket/server"

const DEFAULT_WINDOW_MINUTES = 10

function toClampedDecimal(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value ?? "").trim())
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function toClampedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizePolymarketHistoryRange(value: unknown): "1h" | "6h" | "1d" | "1w" | "1m" | "all" {
  const normalized = String(value || "").trim().toLowerCase()
  if (
    normalized === "1h"
    || normalized === "6h"
    || normalized === "1d"
    || normalized === "1w"
    || normalized === "1m"
    || normalized === "all"
  ) {
    return normalized
  }
  return "1d"
}

export async function executeScheduleTrigger(
  node: ScheduleTriggerNode,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port?: string }> {
  if (ctx.runSource === "trigger" || ctx.runSource === "manual") {
    return { ok: true, text: "Manual trigger — schedule gate bypassed.", data: { triggered: true } }
  }

  const now = ctx.now
  const timezone = resolveTimezone(node.triggerTimezone, ctx.mission?.settings?.timezone)
  const local = getLocalParts(now, timezone)
  if (!local) return { ok: false, error: "Could not determine local time.", data: { triggered: false } }

  const mode = node.triggerMode || "daily"

  if (mode === "interval") {
    const every = Math.max(1, node.triggerIntervalMinutes || 30)
    const lastRun = ctx.lastRunAt ? new Date(ctx.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { ok: true, text: "Interval trigger — first run.", data: { triggered: true, dayStamp: local.dayStamp } }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    if (minutesSince >= every) {
      return { ok: true, text: `Interval trigger — ${minutesSince.toFixed(1)}m since last run.`, data: { triggered: true, dayStamp: local.dayStamp } }
    }
    return { ok: true, text: "Interval trigger — not yet due.", data: { triggered: false, skipped: true } }
  }

  const target = parseTime(node.triggerTime)
  if (!target) {
    return { ok: false, error: "Invalid trigger time format.", data: { triggered: false } }
  }

  if (mode === "weekly" || mode === "once") {
    const days = node.triggerDays || []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { ok: true, text: `Weekly trigger — today is ${local.weekday}, not in [${days.join(",")}].`, data: { triggered: false, skipped: true } }
    }
  }

  const nowMinutes = local.hour * 60 + local.minute
  const targetMinutes = target.hour * 60 + target.minute
  if (nowMinutes < targetMinutes) {
    return { ok: true, text: "Schedule trigger — not yet time.", data: { triggered: false, skipped: true } }
  }

  const lag = nowMinutes - targetMinutes
  const window = node.triggerWindowMinutes ?? DEFAULT_WINDOW_MINUTES
  if (lag > window) {
    return { ok: true, text: `Schedule trigger — missed window (${lag}m lag, ${window}m window).`, data: { triggered: false, skipped: true } }
  }

  return {
    ok: true,
    text: `Schedule trigger fired — ${mode} at ${node.triggerTime} ${timezone}.`,
    data: { triggered: true, dayStamp: local.dayStamp, mode, timezone },
  }
}

export async function executeManualTrigger(
  _node: ManualTriggerNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _node
  void _ctx
  return { ok: true, text: "Manual trigger.", data: { triggered: true } }
}

export async function executeWebhookTrigger(
  _node: WebhookTriggerNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  let webhookData: unknown = {}
  const raw = ctx.variables["__webhook_payload"]
  if (raw) {
    try {
      webhookData = JSON.parse(raw)
    } catch {
      return { ok: false, error: "Webhook payload is not valid JSON." }
    }
  }
  return { ok: true, text: "Webhook trigger received.", data: { triggered: true, payload: webhookData } }
}

export async function executeEventTrigger(
  _node: EventTriggerNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _node
  void _ctx
  return { ok: true, text: "Event trigger fired.", data: { triggered: true } }
}

export async function executePolymarketPriceTrigger(
  node: PolymarketPriceTriggerNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _ctx
  const tokenId = String(node.tokenId || "").trim()
  if (!tokenId) {
    return { ok: false, error: "polymarket-price-trigger requires tokenId.", errorCode: "POLYMARKET_TOKEN_REQUIRED" }
  }

  const direction = String(node.direction || "above").trim().toLowerCase() === "below" ? "below" : "above"
  const threshold = toClampedDecimal(node.threshold, 0.5, 0, 1)

  try {
    const rows = await fetchPolymarketPrices([tokenId])
    const priceRow = rows.find((row) => String(row.tokenId || "").trim() === tokenId) || rows[0]
    if (!priceRow) {
      return {
        ok: false,
        error: `No price data returned for token ${tokenId}.`,
        errorCode: "POLYMARKET_PRICE_UNAVAILABLE",
      }
    }

    const price = Number(priceRow.price)
    const triggered = direction === "above" ? price >= threshold : price <= threshold
    if (!triggered) {
      return {
        ok: true,
        text: `Polymarket trigger not met (${(price * 100).toFixed(1)}% ${direction} ${(threshold * 100).toFixed(1)}%).`,
        data: {
          triggered: false,
          skipped: true,
          tokenId,
          marketSlug: String(node.marketSlug || "").trim() || undefined,
          direction,
          threshold,
          price,
        },
      }
    }

    return {
      ok: true,
      text: `Polymarket trigger fired (${(price * 100).toFixed(1)}% ${direction} ${(threshold * 100).toFixed(1)}%).`,
      data: {
        triggered: true,
        tokenId,
        marketSlug: String(node.marketSlug || "").trim() || undefined,
        direction,
        threshold,
        price,
      },
    }
  } catch (error) {
    return { ok: false, error: String(error), errorCode: "POLYMARKET_TRIGGER_FAILED" }
  }
}

export async function executePolymarketMonitor(
  node: PolymarketMonitorNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _ctx
  const maxMarkets = toClampedInt(node.maxMarkets, 6, 1, 12)
  const changeThresholdPct = toClampedDecimal(node.changeThresholdPct, 5, 0.1, 100)
  const query = String(node.query || "").trim()
  const tagSlug = String(node.tagSlug || "").trim() || undefined
  const range = normalizePolymarketHistoryRange(node.range)

  try {
    const markets = await fetchPolymarketMarkets({ query, tagSlug, limit: maxMarkets })
    const targets = markets
      .map((market) => {
        const firstOutcome = market.outcomes.find((outcome) => String(outcome.tokenId || "").trim())
        const tokenId = String(firstOutcome?.tokenId || "").trim()
        if (!tokenId) return null
        return {
          marketId: market.id,
          slug: market.slug,
          question: market.question,
          tokenId,
        }
      })
      .filter((entry): entry is { marketId: string; slug: string; question: string; tokenId: string } => Boolean(entry))

    if (targets.length === 0) {
      return {
        ok: true,
        text: "Polymarket monitor found no tokenized outcomes to evaluate.",
        data: {
          triggered: false,
          skipped: true,
          query,
          tagSlug,
          range,
          changeThresholdPct,
          matches: [],
        },
      }
    }

    const historyResults = await Promise.allSettled(
      targets.map(async (target) => {
        const history = await fetchPolymarketPriceHistory(target.tokenId, range)
        if (!Array.isArray(history) || history.length < 2) return null
        const start = Number(history[0]?.p)
        const end = Number(history[history.length - 1]?.p)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null
        const deltaPct = (end - start) * 100
        return {
          ...target,
          startPrice: start,
          endPrice: end,
          deltaPct,
          absDeltaPct: Math.abs(deltaPct),
          direction: deltaPct >= 0 ? "up" : "down",
        }
      }),
    )

    const matches = historyResults
      .filter((result): result is PromiseFulfilledResult<{
        marketId: string
        slug: string
        question: string
        tokenId: string
        startPrice: number
        endPrice: number
        deltaPct: number
        absDeltaPct: number
        direction: "up" | "down"
      } | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((entry): entry is {
        marketId: string
        slug: string
        question: string
        tokenId: string
        startPrice: number
        endPrice: number
        deltaPct: number
        absDeltaPct: number
        direction: "up" | "down"
      } => {
        if (!entry) return false
        return entry.absDeltaPct >= changeThresholdPct
      })
      .sort((a, b) => b.absDeltaPct - a.absDeltaPct)

    if (matches.length === 0) {
      return {
        ok: true,
        text: `No Polymarket swings above ${changeThresholdPct.toFixed(2)}% (${range}).`,
        data: {
          triggered: false,
          skipped: true,
          query,
          tagSlug,
          range,
          changeThresholdPct,
          scanned: targets.length,
          matches: [],
        },
      }
    }

    const top = matches[0]
    return {
      ok: true,
      text: `Polymarket monitor fired: ${top.question} moved ${top.deltaPct.toFixed(2)}% (${top.direction}).`,
      data: {
        triggered: true,
        query,
        tagSlug,
        range,
        changeThresholdPct,
        scanned: targets.length,
        matches,
      },
      items: matches,
    }
  } catch (error) {
    return { ok: false, error: String(error), errorCode: "POLYMARKET_MONITOR_FAILED" }
  }
}


