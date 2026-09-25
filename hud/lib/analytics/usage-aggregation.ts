/**
 * Usage analytics: ledger reads and pure aggregation (token-efficiency Stage 5 + close-out).
 *
 * Deliberately free of `server-only` and `@/` imports so plain Node smokes can transpile and run it against a real
 * nova.db (scripts/smoke/analytics). It still only runs on the server: it opens nova.db through src/db.
 * usage-analytics.ts (server-only) adds the agent-task parts and is what the API routes import.
 *
 * Day bucketing: one indexed range query on (user_id, ts) groups the ledger by UTC 15-minute bucket × source ×
 * provider × model × routing tier (NULL tier → "untagged"). Every time zone in use has an offset that is a multiple of 15 minutes and changes it on a
 * 15-minute boundary, so each bucket lies inside exactly one local day of the viewer's zone (`tz`, IANA). Buckets
 * are assigned to days with Intl in that zone, which also covers DST. The range starts at the first instant of the
 * local day `days - 1` days ago in that zone.
 *
 * Savings are exact per (day, source, provider, model) group because cost is linear in tokens for one model
 * (up to the 6-decimal rounding of estimateTokenCostUsd).
 */

import { getDb } from "../../../src/db/index.js"
import { listAgentTaskBudgetEvents } from "../../../src/db/agent-task-budget-events.js"
import { resolveLlmUsageRetentionDays } from "../../../src/db/llm-usage.js"
import { estimateTokenCostUsd, resolveModelPricing } from "../../../src/providers/pricing/index.js"
import { addDaysToKey, zonedDateKey, zonedDayStartMs } from "./time-zone"
import {
  ANALYTICS_RANGE_DAYS,
  BUDGET_EVENT_KINDS,
  BUDGET_HISTORY_LIMIT,
  USAGE_SOURCES,
  USAGE_TIERS,
  type BudgetEventKind,
  type BudgetEventRow,
  type UsageAnalytics,
  type UsageByModelRow,
  type UsageByProviderRow,
  type UsageBySourceRow,
  type UsageByTierRow,
  type UsageDailyRow,
  type UsageSavingsSummary,
  type UsageSource,
  type UsageTier,
  type UsageTotals,
} from "./types"

type BudgetState = BudgetEventRow["state"]
const BUDGET_STATES: readonly BudgetState[] = ["ok", "warning", "degraded", "exhausted"]

// ─── Range ───────────────────────────────────────────────────────────────────

/** Parses the `days` query value: integer in [min, max]; missing / non-numeric → default; out of range → clamped. */
export function resolveAnalyticsDays(raw: string | null | undefined): number {
  const text = String(raw ?? "").trim()
  if (!text) return ANALYTICS_RANGE_DAYS.default
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return ANALYTICS_RANGE_DAYS.default
  return Math.min(ANALYTICS_RANGE_DAYS.max, Math.max(ANALYTICS_RANGE_DAYS.min, Math.floor(parsed)))
}

export interface UsageRange {
  days: number
  timeZone: string
  /** First instant of the first local day. */
  since: Date
  until: Date
  /** Local day keys in `timeZone`, oldest first; `days` entries ending today. */
  dayKeys: string[]
}

/** Range starts at the first instant of the local day `days - 1` days ago (in `timeZone`) and ends now. */
export function resolveUsageRange(days: number, timeZone: string, now: Date = new Date()): UsageRange {
  const today = zonedDateKey(now.getTime(), timeZone)
  const dayKeys: string[] = []
  for (let i = days - 1; i >= 0; i--) dayKeys.push(addDaysToKey(today, -i))
  return { days, timeZone, since: new Date(zonedDayStartMs(dayKeys[0] ?? today, timeZone)), until: now, dayKeys }
}

// ─── Ledger read ─────────────────────────────────────────────────────────────

/** One SQL group: a UTC 15-minute bucket × source × provider × model × tier. */
export interface UsageBucketGroup {
  /** Bucket start, "YYYY-MM-DDTHH:MM" (UTC, MM in 00/15/30/45). */
  bucket: string
  source: string
  provider: string
  model: string
  /** Routing tier ("trivial" / "standard" / "hard"); "untagged" for a NULL tier. Optional for older callers. */
  tier?: string
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
  unpricedCalls: number
}

interface UsageBucketGroupDbRow {
  bucket: string
  source: string
  provider: string
  model: string
  tier: string | null
  calls: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  cost_usd: number
  unpriced_calls: number
}

/**
 * The one ledger query: a range scan on the (user_id, ts) index, grouped by UTC 15-minute bucket. `ts` is always
 * Date#toISOString() ("YYYY-MM-DDTHH:MM:SS.sssZ"), written by src/db/llm-usage.js.
 */
export const USAGE_BUCKET_SQL = `SELECT substr(ts, 1, 14) || printf('%02d', (CAST(substr(ts, 15, 2) AS INTEGER) / 15) * 15) AS bucket,
              source, provider, model, tier,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(cost_usd IS NULL), 0) AS unpriced_calls
         FROM llm_usage
        WHERE user_id = ? AND ts >= ? AND ts <= ?
        GROUP BY bucket, source, provider, model, tier`

export function readUsageBucketGroups(userId: string, sinceIso: string, untilIso: string): UsageBucketGroup[] {
  const rows = getDb().prepare(USAGE_BUCKET_SQL).all(userId, sinceIso, untilIso) as UsageBucketGroupDbRow[]
  return rows.map((row) => ({
    bucket: String(row.bucket ?? ""),
    source: String(row.source ?? ""),
    provider: String(row.provider ?? ""),
    model: String(row.model ?? ""),
    tier: normalizeUsageTier(row.tier),
    calls: Number(row.calls) || 0,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cachedInputTokens: Number(row.cached_input_tokens) || 0,
    cacheWriteInputTokens: Number(row.cache_write_input_tokens) || 0,
    costUsd: Number(row.cost_usd) || 0,
    unpricedCalls: Number(row.unpriced_calls) || 0,
  }))
}

/** A ledger tier value as a UsageTier: NULL, empty or unknown → "untagged". */
export function normalizeUsageTier(value: unknown): UsageTier {
  const key = String(value ?? "").trim().toLowerCase()
  return key !== "untagged" && (USAGE_TIERS as readonly string[]).includes(key) ? (key as UsageTier) : "untagged"
}

// ─── Aggregation (pure) ──────────────────────────────────────────────────────

interface Accumulator {
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
  unpricedCalls: number
  savingsUsd: number
}

function emptyAccumulator(): Accumulator {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    savingsUsd: 0,
  }
}

function addInto(target: Accumulator, source: Accumulator): void {
  target.calls += source.calls
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.cacheWriteInputTokens += source.cacheWriteInputTokens
  target.costUsd += source.costUsd
  target.unpricedCalls += source.unpricedCalls
  target.savingsUsd += source.savingsUsd
}

function uncachedOf(acc: Pick<Accumulator, "inputTokens" | "cachedInputTokens" | "cacheWriteInputTokens">): number {
  return Math.max(0, acc.inputTokens - acc.cachedInputTokens - acc.cacheWriteInputTokens)
}

/** Rounds away float noise from summing many 6-decimal costs. */
function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

function toTotals(acc: Accumulator): UsageTotals {
  return {
    calls: acc.calls,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cachedInputTokens: acc.cachedInputTokens,
    cacheWriteInputTokens: acc.cacheWriteInputTokens,
    uncachedInputTokens: uncachedOf(acc),
    costUsd: roundUsd(acc.costUsd),
    unpricedCalls: acc.unpricedCalls,
    cacheHitRate: acc.inputTokens > 0 ? acc.cachedInputTokens / acc.inputTokens : 0,
    savingsUsd: roundUsd(acc.savingsUsd),
  }
}

export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

function isUsageSource(value: string): value is UsageSource {
  return (USAGE_SOURCES as readonly string[]).includes(value)
}

type SourceSplit = UsageDailyRow["bySource"]

function emptySourceSplit(): SourceSplit {
  const split = {} as SourceSplit
  for (const source of USAGE_SOURCES) split[source] = { costUsd: 0, tokens: 0 }
  return split
}

export function aggregateUsage(groups: readonly UsageBucketGroup[], range: UsageRange, retentionDays: number): UsageAnalytics {
  const firstDay = range.dayKeys[0] ?? ""
  const lastDay = range.dayKeys[range.dayKeys.length - 1] ?? ""
  const daySet = new Set(range.dayKeys)
  const dayOfBucket = new Map<string, string>()

  // 1. Collapse buckets into (local day, source, provider, model, tier).
  interface DayGroup extends Accumulator {
    day: string
    source: UsageSource
    provider: string
    model: string
    tier: UsageTier
  }
  const dayGroups = new Map<string, DayGroup>()
  for (const group of groups) {
    if (!isUsageSource(group.source)) continue
    let day = getOrCreate(dayOfBucket, group.bucket, () => {
      const ms = Date.parse(`${group.bucket}:00.000Z`)
      return Number.isFinite(ms) ? zonedDateKey(ms, range.timeZone) : ""
    })
    // Rows are range-filtered by SQL, so only clock skew (a row stamped after "now") can land outside the days.
    if (!daySet.has(day)) day = day !== "" && day < firstDay ? firstDay : lastDay
    const source = group.source
    const tier = normalizeUsageTier(group.tier)
    const key = `${day}\u0000${source}\u0000${group.provider}\u0000${group.model}\u0000${tier}`
    const target = getOrCreate(dayGroups, key, () => ({
      ...emptyAccumulator(),
      day,
      source,
      provider: group.provider,
      model: group.model,
      tier,
    }))
    addInto(target, { ...group, savingsUsd: 0 })
  }

  // 2. Price each collapsed group and roll it up.
  const pricedByModel = new Map<string, boolean>()
  const savings = { costAtUncachedRatesUsd: 0, costWithCachingUsd: 0, unpricedCachedInputTokens: 0 }
  const totals = emptyAccumulator()
  const bySource = new Map<UsageSource, Accumulator>(USAGE_SOURCES.map((source) => [source, emptyAccumulator()]))
  const byTier = new Map<UsageTier, Accumulator>(USAGE_TIERS.map((tier) => [tier, emptyAccumulator()]))
  const byProvider = new Map<string, Accumulator>()
  const byModel = new Map<string, Accumulator & { provider: string; model: string }>()
  const daily = new Map<string, { acc: Accumulator; bySource: SourceSplit; costByProvider: Record<string, number> }>()

  for (const group of dayGroups.values()) {
    const priced = getOrCreate(pricedByModel, group.model, () => resolveModelPricing(group.model) !== null)
    if (priced) {
      const uncachedCost = estimateTokenCostUsd(group.model, group.inputTokens, group.outputTokens) ?? 0
      const cachedCost =
        estimateTokenCostUsd(group.model, group.inputTokens, group.outputTokens, {
          cachedInputTokens: group.cachedInputTokens,
          cacheWriteInputTokens: group.cacheWriteInputTokens,
        }) ?? 0
      group.savingsUsd = uncachedCost - cachedCost
      savings.costAtUncachedRatesUsd += uncachedCost
      savings.costWithCachingUsd += cachedCost
    } else {
      savings.unpricedCachedInputTokens += group.cachedInputTokens
    }

    addInto(totals, group)
    addInto(getOrCreate(bySource, group.source, emptyAccumulator), group)
    addInto(getOrCreate(byTier, group.tier, emptyAccumulator), group)
    addInto(getOrCreate(byProvider, group.provider, emptyAccumulator), group)
    addInto(
      getOrCreate(byModel, `${group.provider}\u0000${group.model}`, () => ({
        ...emptyAccumulator(),
        provider: group.provider,
        model: group.model,
      })),
      group,
    )
    const day = getOrCreate(daily, group.day, () => ({
      acc: emptyAccumulator(),
      bySource: emptySourceSplit(),
      costByProvider: {} as Record<string, number>,
    }))
    addInto(day.acc, group)
    day.bySource[group.source].costUsd += group.costUsd
    day.bySource[group.source].tokens += group.inputTokens + group.outputTokens
    day.costByProvider[group.provider] = (day.costByProvider[group.provider] ?? 0) + group.costUsd
  }

  const byCostThenTokens = (a: UsageTotals, b: UsageTotals) =>
    b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)

  const dailyRows: UsageDailyRow[] = range.dayKeys.map((date) => {
    const day = daily.get(date)
    const acc = day?.acc ?? emptyAccumulator()
    const bySourceRow = emptySourceSplit()
    for (const source of USAGE_SOURCES) {
      const value = day?.bySource[source]
      if (value) bySourceRow[source] = { costUsd: roundUsd(value.costUsd), tokens: value.tokens }
    }
    const costByProvider: Record<string, number> = {}
    for (const [provider, cost] of Object.entries(day?.costByProvider ?? {})) costByProvider[provider] = roundUsd(cost)
    return {
      date,
      costUsd: roundUsd(acc.costUsd),
      calls: acc.calls,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cachedInputTokens: acc.cachedInputTokens,
      cacheWriteInputTokens: acc.cacheWriteInputTokens,
      uncachedInputTokens: uncachedOf(acc),
      savingsUsd: roundUsd(acc.savingsUsd),
      bySource: bySourceRow,
      costByProvider,
    }
  })

  const savingsSummary: UsageSavingsSummary = {
    costAtUncachedRatesUsd: roundUsd(savings.costAtUncachedRatesUsd),
    costWithCachingUsd: roundUsd(savings.costWithCachingUsd),
    savingsUsd: roundUsd(savings.costAtUncachedRatesUsd - savings.costWithCachingUsd),
    unpricedCachedInputTokens: savings.unpricedCachedInputTokens,
  }

  return {
    range: {
      days: range.days,
      timeZone: range.timeZone,
      sinceTs: range.since.toISOString(),
      untilTs: range.until.toISOString(),
      retentionDays,
    },
    totals: toTotals(totals),
    bySource: USAGE_SOURCES.map<UsageBySourceRow>((source) => ({
      source,
      ...toTotals(bySource.get(source) ?? emptyAccumulator()),
    })),
    byTier: USAGE_TIERS.map<UsageByTierRow>((tier) => ({
      tier,
      ...toTotals(byTier.get(tier) ?? emptyAccumulator()),
    })),
    byProvider: Array.from(byProvider.entries())
      .map<UsageByProviderRow>(([provider, acc]) => ({ provider, ...toTotals(acc) }))
      .sort(byCostThenTokens),
    byModel: Array.from(byModel.values())
      .map<UsageByModelRow>((acc) => ({
        provider: acc.provider,
        model: acc.model,
        priced: pricedByModel.get(acc.model) ?? false,
        ...toTotals(acc),
      }))
      .sort(byCostThenTokens),
    daily: dailyRows,
    savings: savingsSummary,
  }
}

export function buildUsageAnalytics(userId: string, days: number, timeZone: string, now: Date = new Date()): UsageAnalytics {
  const range = resolveUsageRange(days, timeZone, now)
  const groups = readUsageBucketGroups(userId, range.since.toISOString(), range.until.toISOString())
  return aggregateUsage(groups, range, resolveLlmUsageRetentionDays())
}

// ─── Budget event history ────────────────────────────────────────────────────

/** max(cost share, token share); 0 when no limit applied. */
export function budgetEventFraction(
  event: Pick<BudgetEventRow, "spentUsd" | "spentTokens" | "costBudgetUsd" | "tokenBudget">,
): number {
  const cost = event.costBudgetUsd !== null && event.costBudgetUsd > 0 ? event.spentUsd / event.costBudgetUsd : 0
  const tokens = event.tokenBudget !== null && event.tokenBudget > 0 ? event.spentTokens / event.tokenBudget : 0
  return Math.max(0, cost, tokens)
}

interface TaskNameDbRow {
  id: string
  name: string
}

/**
 * Current names of the given tasks of one user. A task that is gone, or soft-deleted and awaiting cleanup
 * (`deleted_at` set), is left out and shown as deleted. One primary-key lookup per id (at most the history limit).
 */
function readTaskNames(userId: string, taskIds: readonly string[]): Map<string, string> {
  const names = new Map<string, string>()
  if (taskIds.length === 0) return names
  const statement = getDb().prepare("SELECT id, name FROM agent_tasks WHERE user_id = ? AND id = ? AND deleted_at IS NULL")
  for (const taskId of taskIds) {
    const row = statement.get(userId, taskId) as TaskNameDbRow | undefined
    if (row) names.set(row.id, String(row.name ?? ""))
  }
  return names
}

export interface BudgetEventHistory {
  history: BudgetEventRow[]
  historyTruncated: boolean
}

/**
 * The user's stored budget events since `sinceIso` (inclusive), newest first, at most `limit` (bounded by
 * BUDGET_HISTORY_LIMIT), each with the task's current name (null when the task was deleted).
 */
export function readBudgetEventHistory(userId: string, sinceIso: string, limit: number = BUDGET_HISTORY_LIMIT): BudgetEventHistory {
  const cap = Math.max(1, Math.min(BUDGET_HISTORY_LIMIT, Math.floor(limit) || BUDGET_HISTORY_LIMIT))
  const rows = listAgentTaskBudgetEvents(userId, { sinceTs: sinceIso, limit: cap + 1 })
  const kept = rows.slice(0, cap)
  const names = readTaskNames(userId, Array.from(new Set(kept.map((row) => row.taskId))))
  const history = kept
    .filter((row) => (BUDGET_EVENT_KINDS as readonly string[]).includes(row.kind))
    .map<BudgetEventRow>((row) => {
      const kind: BudgetEventKind = row.kind
      const state: BudgetState = BUDGET_STATES.includes(row.state) ? row.state : "ok"
      const base = {
        spentUsd: row.spentUsd,
        spentTokens: row.spentTokens,
        costBudgetUsd: row.costBudgetUsd,
        tokenBudget: row.tokenBudget,
      }
      return {
        id: row.id,
        taskId: row.taskId,
        taskName: names.get(row.taskId) ?? null,
        ts: row.ts,
        kind,
        state,
        ...base,
        fraction: budgetEventFraction(base),
        model: row.model,
        economyModel: row.economyModel,
      }
    })
  return { history, historyTruncated: rows.length > cap }
}
