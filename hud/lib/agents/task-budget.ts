/**
 * Client-safe agent-task budget helpers (token-efficiency Stage 4).
 *
 * The canonical budget rules live in src/runtime/modules/agent-tasks/budget-settings (server only: it reads nova.db).
 * This module mirrors the one formula the UI needs (fraction = max(cost share, token share); a dimension without a
 * limit does not count, so the default cost-only budget is the cost share alone) plus the parsing and merging of the
 * runtime's "agent-task-budget" WebSocket event, and must not import anything server-side.
 */

import { resolveModelPricing } from "../../app/integrations/constants/pricing"

import {
  AGENT_TASK_TERMINAL,
  type AgentTask,
  type AgentTaskBudgetEvent,
  type AgentTaskBudgetState,
  type AgentTaskEffectiveBudget,
} from "./types"

/** Window CustomEvent that useNovaState re-dispatches for every validated "agent-task-budget" WebSocket message. */
export const AGENT_TASK_BUDGET_WINDOW_EVENT = "nova:agent-task-budget"

const BUDGET_STATES: readonly AgentTaskBudgetState[] = ["ok", "warning", "degraded", "exhausted"]
const SEVERITY: Record<AgentTaskBudgetState, number> = { ok: 0, warning: 1, degraded: 2, exhausted: 3 }

export interface AgentTaskBudgetSpend {
  spentUsd: number
  spentTokens: number
}

function finiteNonNegative(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function positiveOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Validates a raw WebSocket payload; returns null for anything that is not a well-formed budget event. */
export function parseAgentTaskBudgetEvent(raw: unknown): AgentTaskBudgetEvent | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as Record<string, unknown>
  if (data.type !== "agent-task-budget") return null
  const taskId = typeof data.taskId === "string" ? data.taskId.trim() : ""
  const state = BUDGET_STATES.find((candidate) => candidate === data.state)
  if (!taskId || !state) return null
  const reason = BUDGET_STATES.find((candidate) => candidate !== "ok" && candidate === data.reason)
  const economyModel = typeof data.economyModel === "string" && data.economyModel.trim() ? data.economyModel.trim() : null
  const ts = Number(data.ts)
  return {
    type: "agent-task-budget",
    userContextId: typeof data.userContextId === "string" ? data.userContextId.trim() : "",
    taskId,
    state,
    reason: reason && reason !== "ok" ? reason : state === "ok" ? "warning" : state,
    spentUsd: finiteNonNegative(data.spentUsd),
    spentTokens: Math.round(finiteNonNegative(data.spentTokens)),
    costBudgetUsd: positiveOrNull(data.costBudgetUsd),
    tokenBudget: positiveOrNull(data.tokenBudget),
    fraction: finiteNonNegative(data.fraction),
    model: typeof data.model === "string" ? data.model.trim().slice(0, 80) : "",
    economyModel,
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
  }
}

/** Spend shown for a task: the live figure while it runs (row columns only update at the end of an attempt). */
export function taskBudgetSpend(task: AgentTask): AgentTaskBudgetSpend {
  const rowSpend = { spentUsd: task.costUsd, spentTokens: task.tokensIn + task.tokensOut }
  if (task.status !== "running" || !task.budgetLive) return rowSpend
  return {
    spentUsd: Math.max(rowSpend.spentUsd, task.budgetLive.spentUsd),
    spentTokens: Math.max(rowSpend.spentTokens, task.budgetLive.spentTokens),
  }
}

/** Mirrors computeBudgetFraction in src/runtime/modules/agent-tasks/budget-settings. */
export function budgetFraction(spend: AgentTaskBudgetSpend, budget: AgentTaskEffectiveBudget | undefined): number {
  const costFraction = budget?.costUsd ? spend.spentUsd / budget.costUsd : 0
  const tokenFraction = budget?.tokens ? spend.spentTokens / budget.tokens : 0
  return Math.max(0, costFraction, tokenFraction)
}

/**
 * Mirrors isCostBudgetBlind in budget-settings: the only limit is cost and Nova has no price for the model, so the
 * budget can never stop the task (its calls are recorded at $0). The task still runs; the card says so.
 */
export function isCostBudgetBlind(budget: AgentTaskEffectiveBudget | undefined, model: string): boolean {
  if (!budget?.active || budget.tokens !== null || budget.costUsd === null) return false
  return resolveModelPricing(model) === null
}

/** True when the effective budget still exceeds the spend in every limited dimension (a resume can make a call). */
export function hasBudgetHeadroom(spend: AgentTaskBudgetSpend, budget: AgentTaskEffectiveBudget | undefined): boolean {
  return !budget?.active || budgetFraction(spend, budget) < 1
}

/** Applies a budget event to its task. Never touches updatedAt, so server freshness checks are unaffected. */
export function applyBudgetEvent(task: AgentTask, event: AgentTaskBudgetEvent): AgentTask {
  if (task.id !== event.taskId) return task
  // A late event for a finished task must not override the row's final state. "queued" is accepted because the
  // WebSocket event can overtake the stream update that marks the task running.
  if (AGENT_TASK_TERMINAL.includes(task.status)) return task
  return {
    ...task,
    budgetState: event.state,
    budgetLive: {
      spentUsd: event.spentUsd,
      spentTokens: event.spentTokens,
      model: event.model,
      economyModel: event.economyModel,
      ts: event.ts,
    },
  }
}

/**
 * Keeps the live figures of the current attempt across a server upsert of the same task: the row's budget_state
 * can briefly trail the WebSocket event, and the row's spend only lands at the end of the attempt.
 */
export function carryBudgetLive(existing: AgentTask | undefined, incoming: AgentTask): AgentTask {
  const live = existing?.budgetLive
  if (!existing || !live || incoming.status !== "running") return incoming
  const startedAt = incoming.startedAt ? Date.parse(incoming.startedAt) : 0
  if (Number.isFinite(startedAt) && live.ts < startedAt) return incoming
  const incomingState = incoming.budgetState ?? "ok"
  const budgetState = SEVERITY[existing.budgetState] > SEVERITY[incomingState] ? existing.budgetState : incomingState
  return { ...incoming, budgetState, budgetLive: live }
}
