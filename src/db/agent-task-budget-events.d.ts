export type AgentTaskBudgetEventKind = "warning" | "degraded" | "exhausted" | "raised"
export type AgentTaskBudgetEventState = "ok" | "warning" | "degraded" | "exhausted"

export const AGENT_TASK_BUDGET_EVENT_KINDS: readonly AgentTaskBudgetEventKind[]

export interface AgentTaskBudgetEventInput {
  userId: string
  taskId: string
  kind: AgentTaskBudgetEventKind
  /** The task's budget_state right after the event. */
  state: AgentTaskBudgetEventState
  /** ISO-8601 or epoch ms; defaults to now. */
  ts?: string | number
  spentUsd?: number
  spentTokens?: number
  /** Effective budget at the time of the event; null / absent = no limit in that dimension. */
  costBudgetUsd?: number | null
  tokenBudget?: number | null
  model?: string
  economyModel?: string | null
}

export interface AgentTaskBudgetEventRow {
  id: string
  userId: string
  taskId: string
  ts: string
  kind: AgentTaskBudgetEventKind
  state: AgentTaskBudgetEventState
  spentUsd: number
  spentTokens: number
  costBudgetUsd: number | null
  tokenBudget: number | null
  model: string
  economyModel: string
}

/** Throws on invalid input. Returns the generated row id. */
export function insertAgentTaskBudgetEvent(event: AgentTaskBudgetEventInput): string
/** Never throws; returns the row id or null. */
export function recordAgentTaskBudgetEventSafe(event: AgentTaskBudgetEventInput): string | null
export function deleteAgentTaskBudgetEvents(userId: string, taskId: string): number
export function pruneAgentTaskBudgetEventsBefore(cutoffIso: string): number
/** Newest first; default limit 200, max 2000. */
export function listAgentTaskBudgetEvents(
  userId: string,
  options?: { taskId?: string; sinceTs?: string; limit?: number },
): AgentTaskBudgetEventRow[]
