"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import { ExternalLink, Pause, Play, ShieldCheck, Square } from "lucide-react"
import { WORKPLACE_NAME, agentLook, personSheetArt, workplaceForTools, type CityWorkplace } from "@/components/pixel-city"
import { budgetFraction, hasBudgetHeadroom, taskBudgetSpend } from "@/lib/agents/task-budget"
import type { AgentTask, AgentTaskBudgetState, AgentTaskStatus, AgentTaskUiAction, RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { PixelWindow } from "../pixel/pixel-window"
import { GameBar } from "./game-bar"

type ActionResult = { ok: true } | { ok: false; error: string }

interface AgentCardProps {
  /** The clicked agent's task; null when it has gone (deleted) since the click. */
  task: AgentTask | null
  onClose: () => void
  onAction: (id: string, action: AgentTaskUiAction) => Promise<ActionResult>
  onRaiseBudget: (id: string, input: RaiseAgentTaskBudgetInput) => Promise<ActionResult>
  /** Opens the full Agent Tasks popup. */
  onOpenTasks: () => void
  /** The name the user gave this resident; shown instead of the task's own name. */
  displayName?: string
  /** Rename control (ResidentRename), shown with the task's details. */
  customizer?: ReactNode
}

const STATUS_LABEL: Record<AgentTaskStatus, string> = {
  running: "Running",
  queued: "Queued",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
}

const STATUS_COLOR: Record<AgentTaskStatus, string> = {
  running: "text-(--px-accent-2)",
  queued: "text-(--px-muted)",
  paused: "text-(--px-accent)",
  completed: "text-(--px-green)",
  failed: "text-(--px-red)",
  cancelled: "text-(--px-muted)",
}

const BUDGET_LABEL: Record<AgentTaskBudgetState, string> = {
  ok: "Within budget",
  warning: "80% of budget used",
  degraded: "Near budget: economy model",
  exhausted: "Budget spent",
}

/** How many of the task's latest tool calls the card lists. */
const RECENT_TOOLS = 8
/** Portrait: one 32 px sheet cell drawn at this many screen pixels per art pixel. */
const PORTRAIT_SCALE = 3
const MAX_COST_BUDGET_USD = 100
const MAX_TOKEN_BUDGET = 10_000_000

function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Where the agent is, and why, in the same terms the city uses for its walking figure. */
function whereabouts(task: AgentTask, workplace: CityWorkplace): { place: string; why: string } {
  const building = WORKPLACE_NAME[workplace]
  const tools = task.toolCalls ?? []
  const latest = tools.length > 0 ? tools[tools.length - 1] : null
  switch (task.status) {
    case "queued":
      return { place: WORKPLACE_NAME.hq, why: "Waiting at Nova HQ for a free slot." }
    case "completed":
      return { place: WORKPLACE_NAME.hq, why: "Done, and back at Nova HQ." }
    case "failed":
      return { place: WORKPLACE_NAME.hq, why: "Stopped by an error, back at Nova HQ." }
    case "cancelled":
      return { place: WORKPLACE_NAME.hq, why: "Stopped by you, back at Nova HQ." }
    case "paused":
      return { place: building, why: latest ? `Paused at the ${building} after using ${latest}.` : `Paused at the ${building}.` }
    case "running":
      return {
        place: building,
        why: latest ? `Working at the ${building}: its latest tool was ${latest}.` : `No tool calls yet, so it is thinking at the ${building}.`,
      }
  }
}

function suggestedCost(current: number | null, spent: number): string {
  if (current === null) return ""
  return Math.min(MAX_COST_BUDGET_USD, Math.ceil(Math.max(current, spent) * 2 * 100) / 100).toFixed(2)
}

function suggestedTokens(current: number | null, spent: number): string {
  if (current === null) return ""
  return String(Math.min(MAX_TOKEN_BUDGET, Math.ceil((Math.max(current, spent) * 2) / 1_000) * 1_000))
}

/** The agent's own sprite: the standing, south-facing frame of its outfit's sheet, scaled with hard edges. */
function AgentPortrait({ workplace }: { workplace: CityWorkplace }) {
  const art = personSheetArt(agentLook(workplace).sheet)
  const size = art.cell * PORTRAIT_SCALE
  return (
    <div className="pixel-subpanel grid shrink-0 place-items-end justify-center overflow-hidden" style={{ width: size + 12, height: size + 8 }}>
      <div
        role="img"
        aria-label={`Nova agent in its ${WORKPLACE_NAME[workplace]} outfit`}
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${art.url})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "0 0",
          backgroundSize: `${art.columns * size}px ${art.rows * size}px`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pixel-subpanel px-3 py-2">
      <h3 className="pixel-label text-(--px-muted)">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

/**
 * The agent card: what one Nova agent (one agent task) is doing, where in the city and why, what it has spent and
 * what it needs from you, with the task's own controls. Everything shown is the task's real row from useAgentTasks.
 */
export function AgentCard({ task, onClose, onAction, onRaiseBudget, onOpenTasks, displayName, customizer }: AgentCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseCost, setRaiseCost] = useState("")
  const [raiseTokens, setRaiseTokens] = useState("")

  const openTasks = (
    <button type="button" onClick={onOpenTasks} className="pixel-chip h-7! px-2! text-[13px]!" title="All agent tasks">
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">All tasks</span>
    </button>
  )

  if (!task) {
    return (
      <PixelWindow place="Nova agent" theme="agent" role="Gone" size="sm" onClose={onClose} actions={openTasks}>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="status">
          <p className="font-pixel text-[14px] text-(--px-muted)">This agent&apos;s task no longer exists.</p>
          <button type="button" onClick={onOpenTasks} className="pixel-chip h-8! px-3! text-[13px]!">
            Open Agent Tasks
          </button>
        </div>
      </PixelWindow>
    )
  }

  const workplace = workplaceForTools(task.toolCalls)
  const where = whereabouts(task, workplace)
  const spend = taskBudgetSpend(task)
  const budget = task.budget
  const share = budgetFraction(spend, budget)
  const headroom = hasBudgetHeadroom(spend, budget)
  const budgetPaused = task.status === "paused" && task.pauseReason === "budget"
  const approval = task.status === "paused" && task.pauseReason === "approval" ? task.pendingApproval : undefined
  const recentTools = (task.toolCalls ?? []).slice(-RECENT_TOOLS).reverse()
  const totalTools = task.toolCalls?.length ?? 0
  const canPause = task.status === "running" || task.status === "queued"
  const canResume = task.status === "paused" && !budgetPaused && !approval
  const canRetry = task.status === "failed" || task.status === "cancelled"
  const canStop = task.status === "running" || task.status === "queued" || task.status === "paused"
  const name = displayName || task.name || task.prompt.slice(0, 60) || "Agent task"

  const act = async (action: AgentTaskUiAction) => {
    setBusy(true)
    setError("")
    try {
      const result = await onAction(task.id, action)
      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  const openRaise = () => {
    setRaiseCost(suggestedCost(budget.costUsd, spend.spentUsd))
    setRaiseTokens(suggestedTokens(budget.tokens, spend.spentTokens))
    setError("")
    setRaiseOpen(true)
  }

  const submitRaise = async (event: FormEvent) => {
    event.preventDefault()
    const input: RaiseAgentTaskBudgetInput = {}
    if (raiseCost.trim()) input.costBudgetUsd = Number(raiseCost)
    if (raiseTokens.trim()) input.tokenBudget = Number(raiseTokens)
    if (input.costBudgetUsd === undefined && input.tokenBudget === undefined) {
      setError("Enter a new cost or token budget.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const result = await onRaiseBudget(task.id, input)
      if (result.ok) setRaiseOpen(false)
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  const chip = "pixel-chip h-8! px-3! text-[13px]! disabled:cursor-not-allowed disabled:opacity-50"
  const input = "h-8 w-24 border-2 border-(--px-border) bg-(--px-bg) px-2 font-pixel text-[13px] tabular-nums text-(--px-text) outline-none focus:border-(--px-accent)"

  return (
    <PixelWindow place="Nova agent" theme="agent" role={where.place} size="md" onClose={onClose} actions={openTasks}>
      <div className={cn("flex h-full min-h-0 flex-col gap-2", busy && "opacity-70")} aria-busy={busy}>
        <div className="game-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <div className="flex gap-3">
            <AgentPortrait workplace={workplace} />
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 font-pixel text-[17px] leading-tight text-(--px-text)" title={name}>
                {name}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-pixel text-[13px]">
                <span className={cn("game-tag", STATUS_COLOR[task.status])}>{STATUS_LABEL[task.status]}</span>
                <span className="truncate text-(--px-muted)">
                  {task.agent} · {task.model}
                </span>
              </p>
              <p className="mt-1.5 font-pixel text-[13px] leading-snug text-(--px-text)">{where.why}</p>
              <div className="mt-2 flex items-center gap-2">
                <GameBar value={task.progress / 100} tone={task.status === "completed" ? "done" : "quest"} label="Task progress" className="flex-1" />
                <span className="w-10 shrink-0 text-right font-pixel text-[12px] tabular-nums text-(--px-muted)">{Math.round(task.progress)}%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="pixel-subpanel px-2 py-1.5">
              <p className="pixel-label text-(--px-muted)">Tokens</p>
              <p className="font-pixel text-[15px] tabular-nums text-(--px-text)" title={`${task.tokensIn.toLocaleString("en-US")} in · ${task.tokensOut.toLocaleString("en-US")} out`}>
                {formatTokens(task.tokensIn + task.tokensOut)}
              </p>
            </div>
            <div className="pixel-subpanel px-2 py-1.5">
              <p className="pixel-label text-(--px-muted)">Cost</p>
              <p className="font-pixel text-[15px] tabular-nums text-(--px-text)">{formatCost(spend.spentUsd)}</p>
            </div>
            <div className="pixel-subpanel px-2 py-1.5">
              <p className="pixel-label text-(--px-muted)">Budget</p>
              <p
                className={cn("font-pixel text-[13px] leading-tight", task.budgetState === "ok" ? "text-(--px-text)" : task.budgetState === "exhausted" ? "text-(--px-red)" : "text-(--px-accent)")}
                title={budget.active ? `${Math.round(Math.min(1, share) * 100)}% used` : undefined}
              >
                {budget.active ? BUDGET_LABEL[task.budgetState] : "No limit"}
              </p>
              {budget.active ? (
                <p className="font-pixel text-[11px] tabular-nums text-(--px-muted)">
                  {budget.costUsd !== null ? `${formatCost(spend.spentUsd)} / ${formatCost(budget.costUsd)}` : null}
                  {budget.costUsd !== null && budget.tokens !== null ? " · " : null}
                  {budget.tokens !== null ? `${formatTokens(spend.spentTokens)} / ${formatTokens(budget.tokens)}` : null}
                </p>
              ) : null}
            </div>
          </div>

          {approval ? (
            <Section title="Needs your approval">
              <p className="font-pixel text-[14px] text-(--px-text)">
                Wants to run <span className="text-(--px-accent)">{approval.toolName}</span>
              </p>
              {approval.reason ? <p className="mt-0.5 font-pixel text-[13px] leading-snug text-(--px-muted)">{approval.reason}</p> : null}
            </Section>
          ) : null}

          {budgetPaused ? (
            <Section title="Paused for budget">
              <p className="font-pixel text-[13px] leading-snug text-(--px-muted)">
                {headroom ? "Resume restarts the task; steps that already had side effects are not repeated." : "Its budget is spent: raise it to resume. Raising restarts the task."}
              </p>
              {raiseOpen ? (
                <form onSubmit={(event) => void submitRaise(event)} className="mt-2 flex flex-wrap items-center gap-2">
                  {budget.costUsd !== null || budget.tokens === null ? (
                    <label className="flex items-center gap-1 font-pixel text-[13px] text-(--px-muted)">
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
                        className={input}
                      />
                    </label>
                  ) : null}
                  {budget.tokens !== null || budget.costUsd === null ? (
                    <label className="flex items-center gap-1 font-pixel text-[13px] text-(--px-muted)">
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
                        className={input}
                      />
                      tok
                    </label>
                  ) : null}
                  <button type="submit" disabled={busy} className={chip}>
                    Raise &amp; resume
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRaiseOpen(false)} className={chip}>
                    Cancel
                  </button>
                </form>
              ) : null}
            </Section>
          ) : null}

          <Section title={totalTools > recentTools.length ? `Recent tool calls (last ${recentTools.length} of ${totalTools})` : "Tool calls"}>
            {recentTools.length === 0 ? (
              <p className="font-pixel text-[13px] text-(--px-muted)">None yet.</p>
            ) : (
              <ol className="flex flex-wrap gap-1.5">
                {recentTools.map((tool, index) => (
                  <li
                    key={`${tool}-${index}`}
                    className={cn("border-2 border-(--px-border) bg-(--px-bg) px-1.5 py-0.5 font-pixel text-[12px]", index === 0 ? "text-(--px-accent-2)" : "text-(--px-muted)")}
                    title={index === 0 ? "Latest" : undefined}
                  >
                    {tool}
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {customizer}

          {task.error && !budgetPaused ? (
            <Section title="Error">
              <p className="line-clamp-4 whitespace-pre-wrap font-pixel text-[13px] leading-snug text-(--px-red)">{task.error}</p>
            </Section>
          ) : null}

          {task.result ? (
            <Section title="Result">
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap font-pixel text-[13px] leading-snug text-(--px-text)">{task.result}</p>
            </Section>
          ) : null}
        </div>

        {error ? (
          <p className="font-pixel text-[13px] text-(--px-red)" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-(--px-border) pt-2">
          {approval ? (
            <button type="button" disabled={busy} onClick={() => void act("play")} className={chip}>
              <ShieldCheck className="h-4 w-4" />
              Allow {approval.toolName} &amp; resume
            </button>
          ) : null}
          {budgetPaused ? (
            <>
              <button
                type="button"
                disabled={busy || !headroom}
                onClick={() => void act("play")}
                className={chip}
                title={headroom ? "Resume task" : "This task already spent its budget. Raise the budget to resume."}
              >
                <Play className="h-4 w-4" />
                Resume
              </button>
              {!raiseOpen ? (
                <button type="button" disabled={busy} onClick={openRaise} className={chip}>
                  Raise budget
                </button>
              ) : null}
            </>
          ) : null}
          {canResume ? (
            <button type="button" disabled={busy} onClick={() => void act("play")} className={chip}>
              <Play className="h-4 w-4" />
              Resume
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" disabled={busy} onClick={() => void act("play")} className={chip}>
              <Play className="h-4 w-4" />
              Retry
            </button>
          ) : null}
          {canPause ? (
            <button type="button" disabled={busy} onClick={() => void act("pause")} className={chip}>
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : null}
          {canStop ? (
            <button type="button" disabled={busy} onClick={() => void act("stop")} className={chip}>
              <Square className="h-4 w-4" />
              {budgetPaused ? "Abort" : "Stop"}
            </button>
          ) : null}
          <button type="button" onClick={onOpenTasks} className={cn(chip, "ml-auto")}>
            All agent tasks
          </button>
        </div>
      </div>
    </PixelWindow>
  )
}
