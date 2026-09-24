export type AgentTaskBudgetProvider = "openai" | "claude" | "gemini" | "grok"
export type AgentTaskBudgetState = "ok" | "warning" | "degraded" | "exhausted"
export type AgentTaskBudgetSource = "task" | "default" | "none"

export interface AgentTaskBudgetSettings {
  /** null = no default cost limit. */
  defaultCostBudgetUsd: number | null
  /** null = no default token limit (the built-in default). Total tokens (input incl. cached + output). */
  defaultTokenBudget: number | null
  economyModels: Record<AgentTaskBudgetProvider, string>
  updatedAt: string | null
}

export interface AgentTaskBudgetSettingsPatch {
  defaultCostBudgetUsd?: number | string | null
  defaultTokenBudget?: number | string | null
  economyModels?: Partial<Record<AgentTaskBudgetProvider, string>>
}

export interface EffectiveTaskBudget {
  costUsd: number | null
  tokens: number | null
  costSource: AgentTaskBudgetSource
  tokenSource: AgentTaskBudgetSource
  active: boolean
}

export interface BudgetSpend {
  spentUsd: number
  spentTokens: number
}

export const AGENT_TASK_BUDGET_KV_NAMESPACE: string
export const AGENT_TASK_BUDGET_KV_KEY: string
export const AGENT_TASK_BUDGET_PROVIDERS: readonly AgentTaskBudgetProvider[]
export const AGENT_TASK_BUDGET_STATES: readonly AgentTaskBudgetState[]
export const AGENT_TASK_BUDGET_WARNING_FRACTION: number
export const DEFAULT_AGENT_TASK_COST_BUDGET_USD: number
/** null: budgets are on cost by default; tokens are an optional limit. */
export const DEFAULT_AGENT_TASK_TOKEN_BUDGET: number | null
export const AGENT_TASK_COST_BUDGET_LIMITS: Readonly<{ min: number; max: number }>
export const AGENT_TASK_TOKEN_BUDGET_LIMITS: Readonly<{ min: number; max: number }>
export const DEFAULT_ECONOMY_MODELS: Readonly<Record<AgentTaskBudgetProvider, string>>

export function listEconomyModelCandidates(provider: string): string[]
export function isValidEconomyModel(provider: string, model: string): boolean
export function normalizeCostBudgetUsd(value: unknown): number | null
export function normalizeTokenBudget(value: unknown): number | null
export function normalizeBudgetState(value: unknown): AgentTaskBudgetState
export function normalizeAgentTaskBudgetSettings(raw: unknown): AgentTaskBudgetSettings
export function readAgentTaskBudgetSettings(userId: string): AgentTaskBudgetSettings
export function writeAgentTaskBudgetSettings(userId: string, patch: AgentTaskBudgetSettingsPatch): AgentTaskBudgetSettings
export function resolveEffectiveTaskBudget(
  task: { costBudgetUsd?: unknown; tokenBudget?: unknown },
  settings: AgentTaskBudgetSettings | null | undefined,
): EffectiveTaskBudget
export function computeBudgetFraction(spend: BudgetSpend, budget: EffectiveTaskBudget | null | undefined): number
export function budgetStateForSpend(
  spend: BudgetSpend,
  budget: EffectiveTaskBudget | null | undefined,
): Extract<AgentTaskBudgetState, "ok" | "warning">
/** True when the only limit is cost and `model` is unpriced: the budget cannot stop the task (it is not blocked). */
export function isCostBudgetBlind(budget: EffectiveTaskBudget | null | undefined, model: string): boolean
