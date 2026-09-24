import type {
  AgentTaskBudgetProvider,
  AgentTaskBudgetSettings,
  AgentTaskBudgetSource,
  AgentTaskBudgetState,
  EffectiveTaskBudget,
} from "../../../src/runtime/modules/agent-tasks/budget-settings/index.js"

export type { AgentTaskBudgetProvider, AgentTaskBudgetSettings, AgentTaskBudgetSource, AgentTaskBudgetState }

export type AgentTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
// "cancelled" = user Stop (terminal), kept distinct from "failed".
export type AgentTaskPriority = "low" | "normal" | "high"
export type AgentProvider = "claude" | "openai" | "gemini" | "grok"
export type AgentPermissionMode = "default" | "accept-edits" | "plan-mode" | "dont-ask" | "bypass"

export type AgentTaskAction = "play" | "pause" | "stop"
export type AgentTaskUiAction = AgentTaskAction | "delete"
export type AgentTaskPauseReason = "user" | "approval" | "budget"

/** The budget that applies to a task (its own value, else the user's default), computed server-side at read. */
export type AgentTaskEffectiveBudget = EffectiveTaskBudget

/** Cumulative spend of the running attempt, from the runtime's "agent-task-budget" WebSocket event. Client-only. */
export interface AgentTaskBudgetLive {
  spentUsd: number
  spentTokens: number
  model: string
  economyModel: string | null
  ts: number
}

export interface AgentTask {
  id: string
  userId: string
  name: string
  prompt: string
  agent: AgentProvider
  model: string
  status: AgentTaskStatus
  priority: AgentTaskPriority
  permissionMode: AgentPermissionMode
  progress: number
  /** Total input tokens (cached + cache-write included). Uncached = tokensIn - cachedInputTokens - cacheWriteInputTokens. */
  tokensIn: number
  tokensOut: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
  error?: string
  result?: string
  toolCalls?: string[]
  pauseReason?: AgentTaskPauseReason
  pendingApproval?: {
    toolName: string
    reason: string
    approvalKey: string
    expiresAt: string
  }
  approvedTools?: string[]
  approvedToolExpiries?: Record<string, string>
  attachedFiles?: string[]
  contextId?: string
  worktreePath?: string
  branchName?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  pausedAt?: string
  completedAt?: string
  /** The task's own cost budget (USD). Absent = the user's default applies. */
  costBudgetUsd?: number
  /** The task's own token budget (input incl. cached + output). Absent = the user's default applies. */
  tokenBudget?: number
  budgetState: AgentTaskBudgetState
  budget: AgentTaskEffectiveBudget
  /** Merged from the WebSocket budget event while the task runs; never persisted. */
  budgetLive?: AgentTaskBudgetLive
}

export interface CreateAgentTaskInput {
  name?: string
  prompt: string
  agent: AgentProvider
  model: string
  priority?: AgentTaskPriority
  permissionMode?: AgentPermissionMode
  attachedFiles?: string[]
  contextId?: string
  useWorktree?: boolean
  /** Empty / null = use the user's default. */
  costBudgetUsd?: number | null
  /** Empty / null = use the user's default. */
  tokenBudget?: number | null
}

/** PATCH /api/agent-tasks { id, action: "raise-budget", ...RaiseAgentTaskBudgetInput }. null = back to the default. */
export interface RaiseAgentTaskBudgetInput {
  costBudgetUsd?: number | null
  tokenBudget?: number | null
}

/** User-scoped WebSocket payload the runtime broadcasts after each budgeted model call of an agent task. */
export interface AgentTaskBudgetEvent {
  type: "agent-task-budget"
  userContextId: string
  taskId: string
  state: AgentTaskBudgetState
  reason: Exclude<AgentTaskBudgetState, "ok">
  spentUsd: number
  spentTokens: number
  costBudgetUsd: number | null
  tokenBudget: number | null
  fraction: number
  model: string
  economyModel: string | null
  ts: number
}

export interface AgentTaskEconomyModelCandidate {
  value: string
  label: string
  priceHint?: string
}

export interface AgentTaskBudgetLimits {
  cost: { min: number; max: number }
  tokens: { min: number; max: number }
}

/** Built-in defaults (used until the user saves settings): cost $2.00, tokens null (no limit, budget on cost). */
export interface AgentTaskBudgetDefaults {
  costUsd: number | null
  tokens: number | null
}

/** GET /api/agent-tasks/budget-settings (PUT returns the same shape). */
export interface AgentTaskBudgetSettingsResponse {
  settings: AgentTaskBudgetSettings
  candidates: Record<AgentTaskBudgetProvider, AgentTaskEconomyModelCandidate[]>
  limits: AgentTaskBudgetLimits
  defaults: AgentTaskBudgetDefaults
}

/** PUT /api/agent-tasks/budget-settings body. null clears a default budget ("no limit"); absent keeps it. */
export interface AgentTaskBudgetSettingsUpdate {
  defaultCostBudgetUsd?: number | null
  defaultTokenBudget?: number | null
  economyModels?: Partial<Record<AgentTaskBudgetProvider, string>>
}

export interface AgentTaskStats {
  queued: number
  running: number
  paused: number
  completed: number
  failed: number
  cancelled: number
  totalCostTodayUsd: number
  totalTokensToday: number
}

export type AgentTaskEvent =
  | { type: "task.upserted"; task: AgentTask }
  | { type: "task.deleted"; id: string }

export const AGENT_TASK_MAX_CONCURRENT = 5
export const AGENT_TASK_TERMINAL: readonly AgentTaskStatus[] = ["completed", "failed", "cancelled"]
