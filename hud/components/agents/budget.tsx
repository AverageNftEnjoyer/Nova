"use client"

import { Badge, Tooltip } from "@/components/ui"
import { budgetFraction, isCostBudgetBlind, taskBudgetSpend } from "@/lib/agents/task-budget"
import { AGENT_TASK_TERMINAL, type AgentTask, type AgentTaskBudgetState } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { formatTokens, formatUsd } from "./run-format"

interface BudgetStateMeta {
  label: string
  hint: string
  tone: "neutral" | "warning" | "danger"
  bar: string
}

/** One label, explanation and tone per `budget_state` (migration 14). */
export const BUDGET_STATE_META: Record<AgentTaskBudgetState, BudgetStateMeta> = {
  ok: { label: "Within budget", hint: "Spend is under 80% of the budget.", tone: "neutral", bar: "bg-faint" },
  warning: { label: "Budget 80%", hint: "This run has used 80% or more of its budget.", tone: "warning", bar: "bg-warning" },
  degraded: {
    label: "Economy model",
    hint: "Near its budget: older tool results are trimmed and the run switched to the provider's economy model.",
    tone: "warning",
    bar: "bg-warning",
  },
  exhausted: {
    label: "Budget spent",
    hint: "The next model call would go over budget, so the run paused before making it.",
    tone: "danger",
    bar: "bg-danger",
  },
}

export const UNPRICED_HINT =
  "Nova records this model's calls at $0, so a cost-only budget never trips. Set a token budget (Settings, Agent budgets, or when creating a task) to cap it."

/** The budget-state badge; nothing for "ok". */
export function BudgetStateBadge({ state, economyModel }: { state: AgentTaskBudgetState; economyModel?: string | null }) {
  if (state === "ok") return null
  const meta = BUDGET_STATE_META[state]
  const hint = state === "degraded" && economyModel ? `${meta.hint} Now using ${economyModel}.` : meta.hint
  return (
    <Tooltip content={hint}>
      <Badge tone={meta.tone}>
        {meta.label}
      </Badge>
    </Tooltip>
  )
}

export interface TaskBudgetView {
  spentUsd: number
  spentTokens: number
  limitUsd: number | null
  limitTokens: number | null
  /** 0..1+ share of the tightest limit; 0 without a budget. */
  fraction: number
  state: AgentTaskBudgetState
  active: boolean
  /** The model is unpriced, so a cost-only budget cannot stop it. */
  costBlind: boolean
  economyModel: string | null
}

export function taskBudgetView(task: AgentTask): TaskBudgetView {
  const spend = taskBudgetSpend(task)
  return {
    spentUsd: spend.spentUsd,
    spentTokens: spend.spentTokens,
    limitUsd: task.budget?.costUsd ?? null,
    limitTokens: task.budget?.tokens ?? null,
    fraction: budgetFraction(spend, task.budget),
    state: task.budgetState,
    active: Boolean(task.budget?.active),
    costBlind: !AGENT_TASK_TERMINAL.includes(task.status) && isCostBudgetBlind(task.budget, task.model),
    economyModel: task.budgetLive?.economyModel ?? null,
  }
}

/** "$0.42 / $2.00" and/or "12k / 100k tok". */
export function budgetReadout(view: TaskBudgetView): string {
  const parts: string[] = []
  if (view.limitUsd !== null) parts.push(`${formatUsd(view.spentUsd)} / ${formatUsd(view.limitUsd)}`)
  if (view.limitTokens !== null) parts.push(`${formatTokens(view.spentTokens)} / ${formatTokens(view.limitTokens)} tok`)
  return parts.length > 0 ? parts.join(", ") : formatUsd(view.spentUsd)
}

/** Thin spend-vs-budget bar. Neutral until 80%, then the state's tone. */
export function BudgetBar({ view, className }: { view: TaskBudgetView; className?: string }) {
  const percent = Math.round(Math.min(1, view.fraction) * 100)
  return (
    <div
      role="meter"
      aria-label="Budget used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1 overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150 ease-out", BUDGET_STATE_META[view.state].bar)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
