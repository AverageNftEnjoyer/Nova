/**
 * Usage analytics entry points (token-efficiency Stage 5 + close-out). Server only: reads nova.db and the HUD
 * agent-task store.
 *
 * The ledger read, day bucketing (viewer's IANA zone, UTC 15-minute buckets) and budget-event history live in
 * ./usage-aggregation (importable from plain Node smokes); this module adds the agent-task fields and the current
 * budget state per task. Shapes are defined in ./types.
 */

import "server-only"

import { listTasks, readTaskBudgetSettings } from "@/lib/agents/task-store"
import { budgetFraction } from "@/lib/agents/task-budget"
import { AGENT_TASK_TERMINAL, type AgentTask, type AgentTaskBudgetState } from "@/lib/agents/types"
import { zonedDateKey, zonedDayStartMs, addDaysToKey } from "./time-zone"
import { buildUsageAnalytics, getOrCreate, readBudgetEventHistory, resolveUsageRange } from "./usage-aggregation"
import type { AnalyticsData, AnalyticsSummary, BudgetAnalytics, BudgetTaskRow, TaskDailyStats, TaskModelStats } from "./types"

export { resolveAnalyticsDays } from "./usage-aggregation"
export { resolveTimeZone } from "./time-zone"

const BUDGET_LIST_LIMIT = 50
const SUMMARY_TASK_LIMIT = 5
const BUDGET_STATES: readonly AgentTaskBudgetState[] = ["ok", "warning", "degraded", "exhausted"]

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

/** Tasks whose current state is not "ok", most recently updated first. */
function budgetAlertRows(tasks: readonly AgentTask[]): BudgetTaskRow[] {
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

/** Current state per task (from `tasks`) plus the stored event history since `sinceIso`. */
export function buildBudgetAnalytics(userId: string, tasks: readonly AgentTask[], sinceIso: string): BudgetAnalytics {
  const settings = readTaskBudgetSettings(userId)
  const { history, historyTruncated } = readBudgetEventHistory(userId, sinceIso)
  return {
    defaults: { costBudgetUsd: settings.defaultCostBudgetUsd, tokenBudget: settings.defaultTokenBudget },
    counts: budgetCounts(tasks),
    tasks: tasks
      .filter((task) => task.budget?.active)
      .map(toBudgetTaskRow)
      .sort((a, b) => b.fraction - a.fraction || byUpdatedAtDesc(a, b))
      .slice(0, BUDGET_LIST_LIMIT),
    alerts: budgetAlertRows(tasks).slice(0, BUDGET_LIST_LIMIT),
    history,
    historyTruncated,
  }
}

// ─── Agent-task fields (kept from the original route) ────────────────────────

type TaskFields = Omit<AnalyticsData, "usage" | "budgets">

/**
 * Timeline covers the same local days (in `timeZone`) as the usage range, at least the 30 days the original route
 * returned.
 */
export function buildTaskAnalytics(
  tasks: readonly AgentTask[],
  days: number,
  timeZone: string,
  now: Date = new Date(),
): TaskFields {
  const todayKey = zonedDateKey(now.getTime(), timeZone)
  const daysAgo = (n: number) => new Date(zonedDayStartMs(addDaysToKey(todayKey, -n), timeZone))
  const today = daysAgo(0)
  const weekAgo = daysAgo(7)
  const monthAgo = daysAgo(30)
  const timelineRange = resolveUsageRange(Math.max(days, 30), timeZone, now)

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
      const dateKey = zonedDateKey(taskDate.getTime(), timeZone)
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

export async function buildAnalyticsData(
  userId: string,
  days: number,
  timeZone: string,
  now: Date = new Date(),
): Promise<AnalyticsData> {
  const tasks = await listTasks(userId)
  const usage = buildUsageAnalytics(userId, days, timeZone, now)
  return {
    ...buildTaskAnalytics(tasks, days, timeZone, now),
    usage,
    budgets: buildBudgetAnalytics(userId, tasks, usage.range.sinceTs),
  }
}

/**
 * Today's usage + current budget alerts. Cheap: one indexed range scan over today's rows and one task read.
 * Only non-terminal tasks count: a finished task keeps its last budget_state, but the Home panel lists what can
 * still be acted on.
 */
export async function buildAnalyticsSummary(
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<AnalyticsSummary> {
  const usage = buildUsageAnalytics(userId, 1, timeZone, now)
  const tasks = (await listTasks(userId)).filter((task) => !AGENT_TASK_TERMINAL.includes(task.status))
  const counts = budgetCounts(tasks)
  return {
    date: zonedDateKey(now.getTime(), timeZone),
    timeZone,
    today: usage.totals,
    budget: {
      warning: counts.warning,
      degraded: counts.degraded,
      exhausted: counts.exhausted,
      tasks: budgetAlertRows(tasks)
        .slice(0, SUMMARY_TASK_LIMIT)
        .map(({ id, name, budgetState, status, fraction }) => ({ id, name, budgetState, status, fraction })),
    },
    generatedAt: now.toISOString(),
  }
}
