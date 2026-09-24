"use client"

import { Ban, Bookmark, CheckCircle2, Clock, GitBranch, Loader2, Pause, PauseCircle, Play, ShieldAlert, Square, Trash2, XCircle } from "lucide-react"
import { useEffect, useState, type ComponentType, type FormEvent } from "react"

import { budgetFraction, hasBudgetHeadroom, taskBudgetSpend } from "@/lib/agents/task-budget"
import type {
  AgentPermissionMode,
  AgentTask,
  AgentTaskBudgetState,
  AgentTaskStatus,
  AgentTaskUiAction,
  RaiseAgentTaskBudgetInput,
} from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"

export type RaiseTaskBudgetHandler = (
  taskId: string,
  input: RaiseAgentTaskBudgetInput,
) => Promise<{ ok: true } | { ok: false; error: string }>

interface TaskCardProps {
  task: AgentTask
  isLight: boolean
  subPanelClass: string
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
  onRaiseBudget: RaiseTaskBudgetHandler
}

interface StatusStyle {
  label: string
  Icon: ComponentType<{ className?: string }>
  lightText: string
  darkText: string
  bar: string
}

const STATUS_STYLES: Record<AgentTaskStatus, StatusStyle> = {
  running: { label: "Running", Icon: Loader2, lightText: "text-emerald-600", darkText: "text-emerald-400", bar: "bg-emerald-500" },
  queued: { label: "Queued", Icon: Clock, lightText: "text-yellow-600", darkText: "text-yellow-400", bar: "bg-yellow-500" },
  paused: { label: "Paused", Icon: PauseCircle, lightText: "text-sky-600", darkText: "text-sky-400", bar: "bg-sky-500" },
  completed: { label: "Completed", Icon: CheckCircle2, lightText: "text-emerald-600", darkText: "text-emerald-400", bar: "bg-emerald-600" },
  failed: { label: "Failed", Icon: XCircle, lightText: "text-red-600", darkText: "text-red-400", bar: "bg-red-500" },
  cancelled: { label: "Cancelled", Icon: Ban, lightText: "text-slate-500", darkText: "text-slate-400", bar: "bg-slate-500" },
}

export const PERMISSION_MODE_LABELS: Record<AgentPermissionMode, string> = {
  default: "Default",
  "accept-edits": "Accept edits",
  "plan-mode": "Plan mode",
  "dont-ask": "Don't ask",
  bypass: "Bypass",
}

function formatCost(cost: number): string {
  if (cost > 0 && cost < 0.01) return "<$0.01"
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

interface BudgetStateStyle {
  label: string
  hint: string
  lightText: string
  darkText: string
  chip: string
  bar: string
}

// "ok" has no chip; its bar stays neutral.
const BUDGET_STATE_STYLES: Record<Exclude<AgentTaskBudgetState, "ok">, BudgetStateStyle> = {
  warning: {
    label: "Budget 80%",
    hint: "This task has used 80% or more of its budget.",
    lightText: "text-amber-600",
    darkText: "text-amber-400",
    chip: "border-amber-500/40 bg-amber-500/10",
    bar: "bg-amber-500",
  },
  degraded: {
    label: "Economy",
    hint: "Near its budget: older tool results are trimmed and the task switched to an economy model.",
    lightText: "text-orange-600",
    darkText: "text-orange-400",
    chip: "border-orange-500/40 bg-orange-500/10",
    bar: "bg-orange-500",
  },
  exhausted: {
    label: "Budget spent",
    hint: "The next model call would go over budget, so the task paused before making it.",
    lightText: "text-red-600",
    darkText: "text-red-400",
    chip: "border-red-500/40 bg-red-500/10",
    bar: "bg-red-500",
  },
}

const RESUME_NOTE = "Resume re-runs the task from the start. Steps that already had side effects are not repeated."
const MAX_COST_BUDGET_USD = 100
const MAX_TOKEN_BUDGET = 10_000_000

/** Prefill for "Raise budget": twice the current limit (or the spend, if higher), capped at the allowed maximum. */
function suggestedCostBudget(current: number | null, spent: number): string {
  if (current === null) return ""
  const next = Math.min(MAX_COST_BUDGET_USD, Math.ceil(Math.max(current, spent) * 2 * 100) / 100)
  return next.toFixed(2)
}

function suggestedTokenBudget(current: number | null, spent: number): string {
  if (current === null) return ""
  return String(Math.min(MAX_TOKEN_BUDGET, Math.ceil((Math.max(current, spent) * 2) / 1_000) * 1_000))
}

/** Shorter than formatTokens for the budget readout: 63K, 100K, 1.5M. */
function formatBudgetTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 10_000) return `${Number((tokens / 1_000).toFixed(1))}K`
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}K`
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

function formatElapsed(startedAt: string | undefined): string {
  if (!startedAt) return ""
  const ts = Date.parse(startedAt)
  if (!Number.isFinite(ts)) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

interface ControlButtonProps {
  title: string
  tone: string
  disabled: boolean
  onClick: () => void
  Icon: ComponentType<{ className?: string }>
}

function ControlButton({ title, tone, disabled, onClick, Icon }: ControlButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50", tone)}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

export function TaskCard({ task, isLight, subPanelClass, onAction, onRaiseBudget }: TaskCardProps) {
  const [isActing, setIsActing] = useState(false)
  const [, setClockTick] = useState(0)
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseCost, setRaiseCost] = useState("")
  const [raiseTokens, setRaiseTokens] = useState("")
  const [raiseError, setRaiseError] = useState("")

  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  const style = STATUS_STYLES[task.status]
  const StatusIcon = style.Icon
  const statusText = isLight ? style.lightText : style.darkText
  const isBypass = task.permissionMode === "bypass"
  const elapsed = task.status === "running" ? formatElapsed(task.startedAt) : ""
  const mutedText = isLight ? "text-s-50" : "text-slate-400"

  const handleAction = async (action: AgentTaskUiAction) => {
    if (
      action === "play"
      && task.pauseReason === "approval"
      && task.pendingApproval
      && !window.confirm(
        `Allow this task to run "${task.pendingApproval.toolName}"?\n\n${task.pendingApproval.reason}`,
      )
    ) {
      return
    }
    setIsActing(true)
    try {
      await onAction(task.id, action)
    } finally {
      setIsActing(false)
    }
  }

  const playTone = isLight ? "text-emerald-600 hover:bg-emerald-500/15" : "text-emerald-400 hover:bg-emerald-500/20"
  const pauseTone = isLight ? "text-sky-600 hover:bg-sky-500/15" : "text-sky-400 hover:bg-sky-500/20"
  const stopTone = isLight ? "text-orange-600 hover:bg-orange-500/15" : "text-orange-400 hover:bg-orange-500/20"
  const deleteTone = isLight ? "text-s-50 hover:bg-red-500/15 hover:text-red-600" : "text-slate-400 hover:bg-red-500/20 hover:text-red-400"
  const budgetButtonClass = "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
  const budgetInputClass = cn(
    "h-6 rounded-md border px-1.5 text-[10px] tabular-nums outline-none transition-colors focus:border-accent",
    isLight ? "border-[#d5dce8] bg-white text-s-90" : "border-white/10 bg-black/40 text-slate-100",
  )

  const budgetPaused = task.status === "paused" && task.pauseReason === "budget"
  const budgetSpend = taskBudgetSpend(task)
  const budget = task.budget
  const budgetShare = budgetFraction(budgetSpend, budget)
  const canResumeBudget = hasBudgetHeadroom(budgetSpend, budget)
  const budgetStyle = task.budgetState !== "ok" ? BUDGET_STATE_STYLES[task.budgetState] : null
  const showBudget = Boolean(budget?.active) && (budgetShare > 0 || budgetStyle !== null)
  const economyModel = task.budgetLive?.economyModel ?? null

  const openRaiseForm = () => {
    setRaiseCost(suggestedCostBudget(budget.costUsd, budgetSpend.spentUsd))
    setRaiseTokens(suggestedTokenBudget(budget.tokens, budgetSpend.spentTokens))
    setRaiseError("")
    setRaiseOpen(true)
  }

  const submitRaise = async (event: FormEvent) => {
    event.preventDefault()
    const input: RaiseAgentTaskBudgetInput = {}
    if (raiseCost.trim()) input.costBudgetUsd = Number(raiseCost)
    if (raiseTokens.trim()) input.tokenBudget = Number(raiseTokens)
    if (input.costBudgetUsd === undefined && input.tokenBudget === undefined) {
      setRaiseError("Enter a new cost or token budget.")
      return
    }
    setIsActing(true)
    setRaiseError("")
    try {
      const result = await onRaiseBudget(task.id, input)
      if (result.ok) setRaiseOpen(false)
      else setRaiseError(result.error)
    } finally {
      setIsActing(false)
    }
  }

  const canPlay = !budgetPaused && (task.status === "paused" || task.status === "failed" || task.status === "cancelled")
  const canPause = task.status === "running" || task.status === "queued"
  // A budget pause shows its own Resume / Raise budget / Abort row instead of the header play and stop controls.
  const canStop = !budgetPaused && (task.status === "running" || task.status === "queued" || task.status === "paused")

  return (
    <div
      className={cn(
        "home-spotlight-card home-border-glow min-w-0 rounded-md border px-2.5 py-2 transition-opacity",
        subPanelClass,
        isActing && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusText, task.status === "running" && "animate-spin")} />
        <h3 className={cn("min-w-0 flex-1 truncate text-[12px] font-semibold", isLight ? "text-s-90" : "text-slate-100")} title={task.name}>
          {task.name}
        </h3>
        <div className="flex shrink-0 items-center gap-0.5">
          {canPlay ? (
            <ControlButton
              title={
                task.pauseReason === "approval" && task.pendingApproval
                  ? `Approve ${task.pendingApproval.toolName} and resume`
                  : task.status === "paused"
                    ? "Resume task"
                    : "Retry task"
              }
              tone={playTone}
              disabled={isActing}
              onClick={() => void handleAction("play")}
              Icon={Play}
            />
          ) : null}
          {canPause ? (
            <ControlButton title="Pause task" tone={pauseTone} disabled={isActing} onClick={() => void handleAction("pause")} Icon={Pause} />
          ) : null}
          {canStop ? (
            <ControlButton title="Stop task" tone={stopTone} disabled={isActing} onClick={() => void handleAction("stop")} Icon={Square} />
          ) : null}
          <ControlButton title="Delete task" tone={deleteTone} disabled={isActing} onClick={() => void handleAction("delete")} Icon={Trash2} />
        </div>
      </div>

      <div className={cn("mt-0.5 flex items-center justify-between gap-2 pl-[1.375rem] text-[10px]", mutedText)}>
        <span className="min-w-0 truncate">
          {task.agent} · {task.model}
          {task.contextId ? (
            <span className={cn("ml-1.5 inline-flex items-center gap-0.5", isLight ? "text-amber-600" : "text-amber-400")} title="In a context group">
              · <Bookmark className="h-2.5 w-2.5 fill-current" />
            </span>
          ) : null}
          {task.branchName ? (
            <span className={cn("ml-1.5 inline-flex items-center gap-0.5", isLight ? "text-s-60" : "text-slate-400")}>
              · <GitBranch className="h-2.5 w-2.5" /> {task.branchName}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {task.permissionMode !== "default" ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[9px] font-medium uppercase tracking-wide",
                isBypass
                  ? "border-red-500/50 bg-red-500/10 text-red-500"
                  : isLight
                    ? "border-[#cdd9ea] text-s-60"
                    : "border-white/15 text-slate-300",
              )}
            >
              {isBypass ? <ShieldAlert className="h-2.5 w-2.5" /> : null}
              {PERMISSION_MODE_LABELS[task.permissionMode]}
            </span>
          ) : null}
          {budgetStyle ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 text-[9px] font-medium uppercase tracking-wide",
                budgetStyle.chip,
                isLight ? budgetStyle.lightText : budgetStyle.darkText,
              )}
              title={
                task.budgetState === "degraded" && economyModel
                  ? `${budgetStyle.hint} Now using ${economyModel}.`
                  : budgetStyle.hint
              }
            >
              {budgetStyle.label}
            </span>
          ) : null}
          <span className={cn("font-medium", statusText)}>{style.label}</span>
          {elapsed ? <span className="tabular-nums">· {elapsed}</span> : null}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 pl-[1.375rem]">
        <div
          className={cn("h-1 min-w-0 flex-1 overflow-hidden rounded-full", isLight ? "bg-black/10" : "bg-white/10")}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={task.progress}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", style.bar, task.status === "running" && "animate-pulse")}
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <span className={cn("shrink-0 text-[10px] tabular-nums", mutedText)}>
          {task.progress}% · {formatTokens(task.tokensIn + task.tokensOut)} tok ·{" "}
          <span className={cn("font-medium", isLight ? "text-s-80" : "text-slate-200")}>{formatCost(task.costUsd)}</span>
        </span>
      </div>

      {showBudget ? (
        <div className="mt-1 flex items-center gap-2 pl-[1.375rem]" title={budgetStyle?.hint ?? "Budget used"}>
          <div
            className={cn("h-1 min-w-8 flex-1 overflow-hidden rounded-full", isLight ? "bg-black/10" : "bg-white/10")}
            role="meter"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(1, budgetShare) * 100)}
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", budgetStyle?.bar ?? (isLight ? "bg-s-40" : "bg-slate-400"))}
              style={{ width: `${Math.min(100, budgetShare * 100)}%` }}
            />
          </div>
          <span className={cn("shrink-0 text-[10px] tabular-nums", mutedText)}>
            {budget.costUsd !== null ? `${formatCost(budgetSpend.spentUsd)}/${formatCost(budget.costUsd)}` : null}
            {budget.costUsd !== null && budget.tokens !== null ? " · " : null}
            {budget.tokens !== null ? `${formatBudgetTokens(budgetSpend.spentTokens)}/${formatBudgetTokens(budget.tokens)} tok` : null}
          </span>
        </div>
      ) : null}

      {task.error ? (
        <p className={cn("mt-1.5 line-clamp-2 pl-[1.375rem] text-[10px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{task.error}</p>
      ) : null}

      {budgetPaused ? (
        <div className="mt-1.5 space-y-1.5 pl-[1.375rem]">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={isActing || !canResumeBudget}
              onClick={() => void handleAction("play")}
              title={canResumeBudget ? "Resume task" : "This task already spent its budget. Raise the budget to resume."}
              className={cn(budgetButtonClass, playTone)}
            >
              <Play className="h-3 w-3" />
              Resume
            </button>
            <button
              type="button"
              disabled={isActing}
              onClick={() => (raiseOpen ? setRaiseOpen(false) : openRaiseForm())}
              aria-expanded={raiseOpen}
              className={cn(budgetButtonClass, isLight ? "text-amber-600 hover:bg-amber-500/15" : "text-amber-400 hover:bg-amber-500/20")}
            >
              Raise budget
            </button>
            <button
              type="button"
              disabled={isActing}
              onClick={() => void handleAction("stop")}
              className={cn(budgetButtonClass, stopTone)}
            >
              <Square className="h-3 w-3" />
              Abort
            </button>
          </div>
          {raiseOpen ? (
            <form onSubmit={(event) => void submitRaise(event)} className="flex flex-wrap items-center gap-1.5">
              {budget.costUsd !== null || budget.tokens === null ? (
                <label className={cn("inline-flex items-center gap-1 text-[10px]", mutedText)}>
                  $
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    max={MAX_COST_BUDGET_USD}
                    step={0.01}
                    value={raiseCost}
                    onChange={(event) => setRaiseCost(event.target.value)}
                    aria-label="New cost budget in USD"
                    placeholder="Cost"
                    className={cn(budgetInputClass, "w-16")}
                  />
                </label>
              ) : null}
              {budget.tokens !== null || budget.costUsd === null ? (
                <label className={cn("inline-flex items-center gap-1 text-[10px]", mutedText)}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1_000}
                    max={MAX_TOKEN_BUDGET}
                    step={1_000}
                    value={raiseTokens}
                    onChange={(event) => setRaiseTokens(event.target.value)}
                    aria-label="New token budget"
                    placeholder="Tokens"
                    className={cn(budgetInputClass, "w-20")}
                  />
                  tok
                </label>
              ) : null}
              <button type="submit" disabled={isActing} className={cn(budgetButtonClass, playTone)}>
                Raise &amp; resume
              </button>
              <button
                type="button"
                disabled={isActing}
                onClick={() => setRaiseOpen(false)}
                className={cn(budgetButtonClass, mutedText, isLight ? "hover:bg-black/5" : "hover:bg-white/10")}
              >
                Cancel
              </button>
              {raiseError ? (
                <p className={cn("basis-full text-[10px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{raiseError}</p>
              ) : null}
            </form>
          ) : null}
          <p className={cn("text-[10px] leading-4", mutedText)}>
            {canResumeBudget ? RESUME_NOTE : `Its budget is spent: raise it to resume. ${RESUME_NOTE}`}
          </p>
        </div>
      ) : null}
      {task.result ? (
        <p
          className={cn("mt-1.5 line-clamp-3 whitespace-pre-wrap pl-[1.375rem] text-[10px] leading-4", isLight ? "text-s-70" : "text-slate-300")}
          title={task.result}
        >
          {task.result}
        </p>
      ) : null}
    </div>
  )
}
