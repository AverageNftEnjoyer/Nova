/**
 * Usage analytics API contract (token-efficiency Stage 5).
 *
 * Client-safe: types and constants only. The data comes from the per-call `llm_usage` ledger (migrations 13, 17),
 * the `agent_tasks` budget columns (migration 14) and the `agent_task_budget_events` history (migration 15).
 * Days are local days in the viewer's IANA zone (the `tz` query parameter). Token counts: `inputTokens` is the TOTAL input (cached and
 * cache-write included); `uncachedInputTokens = inputTokens - cachedInputTokens - cacheWriteInputTokens`.
 */

import type { AgentTaskBudgetState, AgentTaskPauseReason, AgentTaskStatus } from "@/lib/agents/types"

/**
 * `llm_usage.source` (migration 17): chat turns, agent tasks, missions, one-off helper calls ("utility": mission
 * suggestions, model tests, Gmail summary) and memory-index embeddings. Mirrors LLM_USAGE_SOURCES in src/db/llm-usage.js.
 */
export type UsageSource = "chat" | "agent-task" | "mission" | "utility" | "embedding"

export const USAGE_SOURCES: readonly UsageSource[] = ["chat", "agent-task", "mission", "utility", "embedding"]

/** Display labels, in USAGE_SOURCES order. */
export const USAGE_SOURCE_LABELS: Record<UsageSource, string> = {
  chat: "Chat",
  "agent-task": "Agent tasks",
  mission: "Missions",
  utility: "Utility",
  embedding: "Embeddings",
}

/** Allowed values of the `days` query parameter of GET /api/analytics. */
export const ANALYTICS_RANGE_DAYS = { min: 1, max: 90, default: 30 } as const

/**
 * Query parameter carrying the viewer's IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on
 * GET /api/analytics and /api/analytics/summary. Days are bucketed in this zone; missing / invalid → the server's.
 */
export const ANALYTICS_TIME_ZONE_PARAM = "tz"

/** At most this many budget events are returned in `budgets.history` (newest first). */
export const BUDGET_HISTORY_LIMIT = 100

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  uncachedInputTokens: number
  /** Sum of `cost_usd` over priced calls. Unpriced calls add tokens but no cost. */
  costUsd: number
  /** Calls whose model has no known price (cost_usd NULL). */
  unpricedCalls: number
  /** cachedInputTokens / inputTokens (0..1); 0 when there is no input. */
  cacheHitRate: number
  /**
   * Priced calls only: cost at uncached input rates minus the cost with the cached / cache-write split, both from
   * src/providers/pricing. Can be negative (Anthropic cache writes cost 1.25x input).
   */
  savingsUsd: number
}

export interface UsageBySourceRow extends UsageTotals {
  source: UsageSource
}

export interface UsageByProviderRow extends UsageTotals {
  /** "openai" | "claude" | "gemini" | "grok", or whatever the ledger row says ("" = unknown). */
  provider: string
}

export interface UsageByModelRow extends UsageTotals {
  provider: string
  model: string
  /** False when the model has no entry in src/providers/pricing (cost and savings unknown). */
  priced: boolean
}

export interface UsageDailyRow {
  /** Local calendar day in `range.timeZone`, YYYY-MM-DD. */
  date: string
  costUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  uncachedInputTokens: number
  savingsUsd: number
  /** Cost and total tokens (input + output) per source for the day. Every source is present (0 when none). */
  bySource: Record<UsageSource, { costUsd: number; tokens: number }>
  /** Cost per provider for the day (only providers with calls that day). */
  costByProvider: Record<string, number>
}

export interface UsageSavingsSummary {
  /** Priced calls only. */
  costAtUncachedRatesUsd: number
  /** Priced calls only, recomputed with the cached split from the same price table. */
  costWithCachingUsd: number
  savingsUsd: number
  /** Cached input tokens on unpriced models: excluded from the savings figure. */
  unpricedCachedInputTokens: number
}

export interface UsageAnalytics {
  range: {
    days: number
    /** IANA zone the days are bucketed in (the `tz` parameter, else the server's zone). */
    timeZone: string
    /** Inclusive lower bound (ISO), start of the local day `days - 1` days ago in `timeZone`. */
    sinceTs: string
    untilTs: string
    /** NOVA_LLM_USAGE_RETENTION_DAYS: rows older than this are pruned. */
    retentionDays: number
  }
  totals: UsageTotals
  bySource: UsageBySourceRow[]
  byProvider: UsageByProviderRow[]
  byModel: UsageByModelRow[]
  daily: UsageDailyRow[]
  savings: UsageSavingsSummary
}

export interface BudgetTaskRow {
  id: string
  name: string
  status: AgentTaskStatus
  provider: string
  model: string
  budgetState: AgentTaskBudgetState
  pauseReason: AgentTaskPauseReason | null
  spentUsd: number
  spentTokens: number
  /** Effective budget (the task's own, else the user's default); null = no limit in that dimension. */
  costBudgetUsd: number | null
  tokenBudget: number | null
  /** max(cost share, token share); 0 when no budget applies. */
  fraction: number
  updatedAt: string
}

/** `agent_task_budget_events.kind` (migration 15): runtime transitions, or the user raising the budget. */
export type BudgetEventKind = "warning" | "degraded" | "exhausted" | "raised"

export const BUDGET_EVENT_KINDS: readonly BudgetEventKind[] = ["warning", "degraded", "exhausted", "raised"]

/** One stored budget event (history), with the task's current title. */
export interface BudgetEventRow {
  id: string
  taskId: string
  /** The task's current name; null when the task no longer exists (shown as "Deleted task"). */
  taskName: string | null
  /** ISO timestamp of the event. */
  ts: string
  kind: BudgetEventKind
  /** The task's budget state right after the event. */
  state: AgentTaskBudgetState
  spentUsd: number
  spentTokens: number
  /** Effective budget at the time of the event; null = no limit in that dimension. */
  costBudgetUsd: number | null
  tokenBudget: number | null
  /** max(cost share, token share) at the time of the event; 0 when no budget applied. */
  fraction: number
  model: string
  /** Economy model in use after a "degraded" event ("" otherwise). */
  economyModel: string
}

export interface BudgetAnalytics {
  defaults: { costBudgetUsd: number | null; tokenBudget: number | null }
  /** Current state counts (from the task rows, not the history). */
  counts: Record<AgentTaskBudgetState, number>
  /** Tasks with a budget, current state, highest use first (at most 50). */
  tasks: BudgetTaskRow[]
  /** Tasks whose current budget_state is not "ok", most recently updated first (at most 50). */
  alerts: BudgetTaskRow[]
  /**
   * Stored budget events of the current user inside the requested range, newest first, at most
   * BUDGET_HISTORY_LIMIT. Pruned with the llm_usage retention period.
   */
  history: BudgetEventRow[]
  /** True when the range holds more events than `history` returns. */
  historyTruncated: boolean
}

/** Existing agent-task fields of GET /api/analytics, kept for compatibility. */
export interface TaskModelStats {
  model: string
  provider: string
  taskCount: number
  tokensIn: number
  tokensOut: number
  totalCost: number
}

export interface TaskDailyStats {
  date: string
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  totalCost: number
}

export interface AnalyticsData {
  totalTasks: number
  totalCost: number
  successRate: number
  averageCostPerTask: number
  totalTokensIn: number
  totalTokensOut: number
  byModel: TaskModelStats[]
  byProvider: Record<string, { taskCount: number; totalCost: number; successCount: number }>
  timeline: TaskDailyStats[]
  recentTasks: number
  todayTasks: number
  weekTasks: number
  monthTasks: number
  /** Ledger-based usage for every LLM call (all USAGE_SOURCES) in the requested range. */
  usage: UsageAnalytics
  budgets: BudgetAnalytics
}

/** GET /api/analytics?days=N&tz=Area/City → { ok: true, analytics: AnalyticsData } */
export interface AnalyticsResponse {
  ok: boolean
  analytics?: AnalyticsData
  error?: string
}

/** GET /api/analytics/summary?tz=Area/City → compact figures for the Home Analytics panel. */
export interface AnalyticsSummary {
  /** Local calendar day in `timeZone`, YYYY-MM-DD. */
  date: string
  timeZone: string
  today: UsageTotals
  budget: {
    warning: number
    degraded: number
    exhausted: number
    /** Up to 5 tasks in warning / degraded / exhausted, most recently updated first. */
    tasks: Array<Pick<BudgetTaskRow, "id" | "name" | "budgetState" | "status" | "fraction">>
  }
  generatedAt: string
}

export interface AnalyticsSummaryResponse {
  ok: boolean
  summary?: AnalyticsSummary
  error?: string
}
