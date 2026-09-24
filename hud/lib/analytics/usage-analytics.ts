/**
 * Usage analytics aggregation (token-efficiency Stage 5). Server only: reads nova.db.
 *
 * Sources: the per-call `llm_usage` ledger (every LLM call from chat, agent tasks and missions) and the
 * `agent_tasks` rows (effective budget + current budget state). Shapes are defined in ./types.
 *
 * Day bucketing: SQL groups the ledger by UTC hour (`substr(ts, 1, 13)`, which uses the (user_id, ts) index for
 * the range scan); each hour is then assigned to the LOCAL calendar day of the hour's start. The server runs on
 * the user's machine, so the server time zone is the user's. In zones with a half-hour (or 45-minute) offset an
 * hour straddles local midnight; its calls are all counted on the day the hour starts. An hour that starts
 * before the range's first local midnight (only possible in such zones) is counted on the first day.
 *
 * Savings are exact per (day, source, provider, model) group because cost is linear in tokens for one model
 * (up to the 6-decimal rounding of estimateTokenCostUsd).
 */

import "server-only"

import { getDb } from "../../../src/db/index.js"
import { resolveLlmUsageRetentionDays } from "../../../src/db/llm-usage.js"
import { estimateTokenCostUsd, resolveModelPricing } from "../../../src/providers/pricing/index.js"
import { listTasks, readTaskBudgetSettings } from "@/lib/agents/task-store"
import { budgetFraction } from "@/lib/agents/task-budget"
import { AGENT_TASK_TERMINAL, type AgentTask, type AgentTaskBudgetState } from "@/lib/agents/types"
import {
  ANALYTICS_RANGE_DAYS,
  USAGE_SOURCES,
  type AnalyticsData,
  type AnalyticsSummary,
  type BudgetAnalytics,
  type BudgetTaskRow,
  type TaskDailyStats,
  type TaskModelStats,
  type UsageAnalytics,
  type UsageByModelRow,
  type UsageByProviderRow,
  type UsageBySourceRow,
  type UsageDailyRow,
  type UsageSavingsSummary,
  type UsageSource,
  type UsageTotals,
} from "./types"

const BUDGET_LIST_LIMIT = 50
const SUMMARY_TASK_LIMIT = 5
const BUDGET_STATES: readonly AgentTaskBudgetState[] = ["ok", "warning", "degraded", "exhausted"]

// ─── Range ───────────────────────────────────────────────────────────────────

/** Parses the `days` query value: integer in [min, max]; missing / non-numeric → default; out of range → clamped. */
export function resolveAnalyticsDays(raw: string | null | undefined): number {
  const text = String(raw ?? "").trim()
  if (!text) return ANALYTICS_RANGE_DAYS.default
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return ANALYTICS_RANGE_DAYS.default
  return Math.min(ANALYTICS_RANGE_DAYS.max, Math.max(ANALYTICS_RANGE_DAYS.min, Math.floor(parsed)))
}

/** YYYY-MM-DD of a date in the server's (= user's) local time zone. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export interface UsageRange {
  days: number
  since: Date
  until: Date
  /** Local day keys, oldest first; `days` entries ending today. */
  dayKeys: string[]
}

/** Range starts at local midnight `days - 1` days ago and ends now. */
export function resolveUsageRange(days: number, now: Date = new Date()): UsageRange {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  const dayKeys: string[] = []
  for (let i = 0; i < days; i++) {
    dayKeys.push(localDateKey(new Date(since.getFullYear(), since.getMonth(), since.getDate() + i)))
  }
  return { days, since, until: now, dayKeys }
}

// ─── Ledger read ─────────────────────────────────────────────────────────────

/** One SQL group: a UTC hour × source × provider × model. */
export interface UsageHourGroup {
  /** "YYYY-MM-DDTHH" (UTC). */
  hour: string
  source: string
  provider: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
  unpricedCalls: number
}

interface UsageHourGroupDbRow {
  hour: string
  source: string
  provider: string
  model: string
  calls: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  cost_usd: number
  unpriced_calls: number
}

export function readUsageHourGroups(userId: string, sinceIso: string, untilIso: string): UsageHourGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT substr(ts, 1, 13) AS hour, source, provider, model,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(cost_usd IS NULL), 0) AS unpriced_calls
         FROM llm_usage
        WHERE user_id = ? AND ts >= ? AND ts <= ?
        GROUP BY hour, source, provider, model`,
    )
    .all(userId, sinceIso, untilIso) as UsageHourGroupDbRow[]
  return rows.map((row) => ({
    hour: String(row.hour ?? ""),
    source: String(row.source ?? ""),
    provider: String(row.provider ?? ""),
    model: String(row.model ?? ""),
    calls: Number(row.calls) || 0,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cachedInputTokens: Number(row.cached_input_tokens) || 0,
    cacheWriteInputTokens: Number(row.cache_write_input_tokens) || 0,
    costUsd: Number(row.cost_usd) || 0,
    unpricedCalls: Number(row.unpriced_calls) || 0,
  }))
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

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
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

/** Local day of a UTC hour key ("YYYY-MM-DDTHH"), or "" when the key is malformed. */
function localDayOfHour(hour: string): string {
  const ms = Date.parse(`${hour}:00:00.000Z`)
  return Number.isFinite(ms) ? localDateKey(new Date(ms)) : ""
}

export function aggregateUsage(groups: readonly UsageHourGroup[], range: UsageRange, retentionDays: number): UsageAnalytics {
  const firstDay = range.dayKeys[0] ?? ""
  const daySet = new Set(range.dayKeys)

  // 1. Collapse hours into (local day, source, provider, model).
  interface DayGroup extends Accumulator {
    day: string
    source: UsageSource
    provider: string
    model: string
  }
  const dayGroups = new Map<string, DayGroup>()
  for (const group of groups) {
    if (!isUsageSource(group.source)) continue
    let day = localDayOfHour(group.hour)
    if (!daySet.has(day)) {
      // Only an hour straddling the first local midnight (half-hour zones) or clock skew lands here.
      day = day < firstDay ? firstDay : (range.dayKeys[range.dayKeys.length - 1] ?? day)
    }
    const key = `${day}\u0000${group.source}\u0000${group.provider}\u0000${group.model}`
    const target = getOrCreate(dayGroups, key, () => ({
      ...emptyAccumulator(),
      day,
      source: group.source as UsageSource,
      provider: group.provider,
      model: group.model,
    }))
    addInto(target, { ...group, savingsUsd: 0 })
  }

  // 2. Price each collapsed group and roll it up.
  const pricedByModel = new Map<string, boolean>()
  const savings = { costAtUncachedRatesUsd: 0, costWithCachingUsd: 0, unpricedCachedInputTokens: 0 }
  const totals = emptyAccumulator()
  const bySource = new Map<UsageSource, Accumulator>(USAGE_SOURCES.map((source) => [source, emptyAccumulator()]))
  const byProvider = new Map<string, Accumulator>()
  const byModel = new Map<string, Accumulator & { provider: string; model: string }>()
  const daily = new Map<string, { acc: Accumulator; bySource: Record<UsageSource, { costUsd: number; tokens: number }>; costByProvider: Record<string, number> }>()

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
    addInto(bySource.get(group.source) ?? emptyAccumulator(), group)
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
      bySource: { chat: { costUsd: 0, tokens: 0 }, "agent-task": { costUsd: 0, tokens: 0 }, mission: { costUsd: 0, tokens: 0 } },
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
    const bySourceRow: UsageDailyRow["bySource"] = {
      chat: { costUsd: 0, tokens: 0 },
      "agent-task": { costUsd: 0, tokens: 0 },
      mission: { costUsd: 0, tokens: 0 },
    }
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
      sinceTs: range.since.toISOString(),
      untilTs: range.until.toISOString(),
      retentionDays,
    },
    totals: toTotals(totals),
    bySource: USAGE_SOURCES.map<UsageBySourceRow>((source) => ({
      source,
      ...toTotals(bySource.get(source) ?? emptyAccumulator()),
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

export function buildUsageAnalytics(userId: string, days: number, now: Date = new Date()): UsageAnalytics {
  const range = resolveUsageRange(days, now)
  const groups = readUsageHourGroups(userId, range.since.toISOString(), range.until.toISOString())
  return aggregateUsage(groups, range, resolveLlmUsageRetentionDays())
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

function toBudgetTaskRow(task: AgentTask): BudgetTaskRow {
  const spend = { spentUsd: task.costUsd, spentTokens: task.tokensIn + task.tokensOut }
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    provider: task.agent,
    model: task.model,
    budgetState: task.budgetState,
    pauseReason: task.pauseReason ?? null,
    spentUsd: spend.spentUsd,
    spentTokens: spend.spentTokens,
    costBudgetUsd: task.budget?.costUsd ?? null,
    tokenBudget: task.budget?.tokens ?? null,
    fraction: task.budget?.active ? budgetFraction(spend, task.budget) : 0,
    updatedAt: task.updatedAt,
  }
}

function byUpdatedAtDesc(a: BudgetTaskRow, b: BudgetTaskRow): number {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
}

/** Non-ok rows ("events" of the current state), most recently updated first. */
function budgetEventRows(tasks: readonly AgentTask[]): BudgetTaskRow[] {
  return tasks.filter((task) => task.budgetState !== "ok").map(toBudgetTaskRow).sort(byUpdatedAtDesc)
}

/**
 * Counts: "ok" counts tasks that have an active budget and are within it; the other states count every task in
 * that state (only a budgeted task can leave "ok").
 */
function budgetCounts(tasks: readonly AgentTask[]): Record<AgentTaskBudgetState, number> {
  const counts: Record<AgentTaskBudgetState, number> = { ok: 0, warning: 0, degraded: 0, exhausted: 0 }
  for (const task of tasks) {
    const state = BUDGET_STATES.includes(task.budgetState) ? task.budgetState : "ok"
    if (state === "ok" && !task.budget?.active) continue
    counts[state] += 1
  }
  return counts
}

export function buildBudgetAnalytics(userId: string, tasks: readonly AgentTask[]): BudgetAnalytics {
  const settings = readTaskBudgetSettings(userId)
  return {
    defaults: { costBudgetUsd: settings.defaultCostBudgetUsd, tokenBudget: settings.defaultTokenBudget },
    counts: budgetCounts(tasks),
    tasks: tasks
      .filter((task) => task.budget?.active)
      .map(toBudgetTaskRow)
      .sort((a, b) => b.fraction - a.fraction || byUpdatedAtDesc(a, b))
      .slice(0, BUDGET_LIST_LIMIT),
    events: budgetEventRows(tasks).slice(0, BUDGET_LIST_LIMIT),
  }
}

// ─── Agent-task fields (kept from the original route) ────────────────────────

type TaskFields = Omit<AnalyticsData, "usage" | "budgets">

/** Timeline covers the same local days as the usage range (at least the 30 days the original route returned). */
export function buildTaskAnalytics(tasks: readonly AgentTask[], days: number, now: Date = new Date()): TaskFields {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysAgo = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  const weekAgo = daysAgo(7)
  const monthAgo = daysAgo(30)
  const timelineRange = resolveUsageRange(Math.max(days, 30), now)

  let totalCost = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let successCount = 0
  let todayCount = 0
  let weekCount = 0
  let monthCount = 0

  const modelMap = new Map<string, TaskModelStats>()
  const providerMap = new Map<string, { taskCount: number; totalCost: number; successCount: number }>()
  const timelineMap = new Map<string, TaskDailyStats>()

  for (const task of tasks) {
    const taskDate = new Date(task.createdAt)
    const completed = task.status === "completed"

    totalCost += task.costUsd
    totalTokensIn += task.tokensIn
    totalTokensOut += task.tokensOut
    if (completed) successCount++

    if (taskDate >= today) todayCount++
    if (taskDate >= weekAgo) weekCount++
    if (taskDate >= monthAgo) monthCount++

    const modelStats = getOrCreate(modelMap, `${task.agent}:${task.model}`, () => ({
      model: task.model,
      provider: task.agent,
      taskCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      totalCost: 0,
    }))
    modelStats.taskCount++
    modelStats.tokensIn += task.tokensIn
    modelStats.tokensOut += task.tokensOut
    modelStats.totalCost += task.costUsd

    const providerStats = getOrCreate(providerMap, task.agent, () => ({ taskCount: 0, totalCost: 0, successCount: 0 }))
    providerStats.taskCount++
    providerStats.totalCost += task.costUsd
    if (completed) providerStats.successCount++

    if (taskDate >= timelineRange.since) {
      const dateKey = localDateKey(taskDate)
      const dayStats = getOrCreate(timelineMap, dateKey, () => ({
        date: dateKey,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        totalCost: 0,
      }))
      dayStats.totalTasks++
      if (completed) dayStats.successfulTasks++
      else if (task.status === "failed") dayStats.failedTasks++
      dayStats.totalCost += task.costUsd
    }
  }

  return {
    totalTasks: tasks.length,
    totalCost,
    successRate: tasks.length > 0 ? (successCount / tasks.length) * 100 : 0,
    averageCostPerTask: tasks.length > 0 ? totalCost / tasks.length : 0,
    totalTokensIn,
    totalTokensOut,
    byModel: Array.from(modelMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    byProvider: Object.fromEntries(providerMap),
    timeline: timelineRange.dayKeys.map(
      (date) => timelineMap.get(date) ?? { date, totalTasks: 0, successfulTasks: 0, failedTasks: 0, totalCost: 0 },
    ),
    recentTasks: Math.min(tasks.length, 10),
    todayTasks: todayCount,
    weekTasks: weekCount,
    monthTasks: monthCount,
  }
}

// ─── Entry points ────────────────────────────────────────────────────────────

export async function buildAnalyticsData(userId: string, days: number, now: Date = new Date()): Promise<AnalyticsData> {
  const tasks = await listTasks(userId)
  return {
    ...buildTaskAnalytics(tasks, days, now),
    usage: buildUsageAnalytics(userId, days, now),
    budgets: buildBudgetAnalytics(userId, tasks),
  }
}

/**
 * Today's usage + current budget alerts. Cheap: one indexed range scan over today's rows and one task read.
 * Only non-terminal tasks count: a finished task keeps its last budget_state, but the Home panel lists what can
 * still be acted on.
 */
export async function buildAnalyticsSummary(userId: string, now: Date = new Date()): Promise<AnalyticsSummary> {
  const usage = buildUsageAnalytics(userId, 1, now)
  const tasks = (await listTasks(userId)).filter((task) => !AGENT_TASK_TERMINAL.includes(task.status))
  const counts = budgetCounts(tasks)
  return {
    date: localDateKey(now),
    today: usage.totals,
    budget: {
      warning: counts.warning,
      degraded: counts.degraded,
      exhausted: counts.exhausted,
      tasks: budgetEventRows(tasks)
        .slice(0, SUMMARY_TASK_LIMIT)
        .map(({ id, name, budgetState, status, fraction }) => ({ id, name, budgetState, status, fraction })),
    },
    generatedAt: now.toISOString(),
  }
}
