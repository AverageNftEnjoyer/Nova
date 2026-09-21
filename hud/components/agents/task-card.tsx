"use client"

import { Ban, Bookmark, CheckCircle2, Clock, GitBranch, Loader2, Pause, PauseCircle, Play, ShieldAlert, Square, Trash2, XCircle } from "lucide-react"
import { useEffect, useState, type ComponentType } from "react"

import type { AgentPermissionMode, AgentTask, AgentTaskStatus, AgentTaskUiAction } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"

interface TaskCardProps {
  task: AgentTask
  isLight: boolean
  subPanelClass: string
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
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

export function TaskCard({ task, isLight, subPanelClass, onAction }: TaskCardProps) {
  const [isActing, setIsActing] = useState(false)
  const [, setClockTick] = useState(0)

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

  const canPlay = task.status === "paused" || task.status === "failed" || task.status === "cancelled"
  const canPause = task.status === "running" || task.status === "queued"
  const canStop = task.status === "running" || task.status === "queued" || task.status === "paused"

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
              title={task.status === "paused" ? "Resume task" : "Retry task"}
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

      {task.error ? (
        <p className={cn("mt-1.5 line-clamp-2 pl-[1.375rem] text-[10px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{task.error}</p>
      ) : null}
    </div>
  )
}
