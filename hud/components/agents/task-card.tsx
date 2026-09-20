"use client"

import { Ban, CheckCircle2, Clock, Loader2, Pause, PauseCircle, Play, ShieldAlert, Square, Trash2, XCircle } from "lucide-react"
import { useEffect, useState, type ComponentType } from "react"

import type { AgentPermissionMode, AgentTask, AgentTaskStatus, AgentTaskUiAction } from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"

interface TaskCardProps {
  task: AgentTask
  isLight: boolean
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
}

interface StatusStyle {
  label: string
  Icon: ComponentType<{ className?: string }>
  badge: string
  bar: string
}

const STATUS_STYLES: Record<AgentTaskStatus, StatusStyle> = {
  running: { label: "Running", Icon: Loader2, badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", bar: "bg-emerald-500" },
  queued: { label: "Queued", Icon: Clock, badge: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600", bar: "bg-yellow-500" },
  paused: { label: "Paused", Icon: PauseCircle, badge: "border-sky-500/40 bg-sky-500/10 text-sky-600", bar: "bg-sky-500" },
  completed: { label: "Completed", Icon: CheckCircle2, badge: "border-emerald-600/40 bg-emerald-600/10 text-emerald-600", bar: "bg-emerald-600" },
  failed: { label: "Failed", Icon: XCircle, badge: "border-red-500/40 bg-red-500/10 text-red-500", bar: "bg-red-500" },
  cancelled: { label: "Cancelled", Icon: Ban, badge: "border-slate-500/40 bg-slate-500/10 text-slate-500", bar: "bg-slate-500" },
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

function formatStartedAgo(startedAt: string | undefined): string {
  if (!startedAt) return "Not started"
  const ts = Date.parse(startedAt)
  if (!Number.isFinite(ts)) return "Not started"
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `Started ${seconds}s ago`
  if (seconds < 3_600) return `Started ${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `Started ${Math.floor(seconds / 3_600)}h ago`
  return `Started ${Math.floor(seconds / 86_400)}d ago`
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
      className={cn("rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50", tone)}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

export function TaskCard({ task, isLight, onAction }: TaskCardProps) {
  const [isActing, setIsActing] = useState(false)
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  const style = STATUS_STYLES[task.status]
  const StatusIcon = style.Icon
  const isBypass = task.permissionMode === "bypass"

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
  const deleteTone = isLight ? "text-red-600 hover:bg-red-500/15" : "text-red-400 hover:bg-red-500/20"

  const canPlay = task.status === "paused" || task.status === "failed" || task.status === "cancelled"
  const canPause = task.status === "running" || task.status === "queued"
  const canStop = task.status === "running" || task.status === "queued" || task.status === "paused"

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-3 transition-opacity",
        isLight ? "border-gray-200 bg-white" : "border-slate-700 bg-slate-900/50",
        isActing && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className={cn("truncate text-sm font-semibold", isLight ? "text-gray-900" : "text-white")} title={task.name}>
            {task.name}
          </h3>
          <p className={cn("truncate text-xs", isLight ? "text-gray-600" : "text-slate-400")}>
            {task.agent} · {task.model}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", style.badge)}>
          <StatusIcon className={cn("h-3 w-3", task.status === "running" && "animate-spin")} />
          {style.label}
        </span>
        {task.permissionMode !== "default" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              isBypass
                ? "border-red-500/50 bg-red-500/10 text-red-500"
                : isLight
                  ? "border-gray-300 text-gray-600"
                  : "border-slate-600 text-slate-300",
            )}
          >
            {isBypass ? <ShieldAlert className="h-3 w-3" /> : null}
            {PERMISSION_MODE_LABELS[task.permissionMode]}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div
          className={cn("h-1.5 flex-1 overflow-hidden rounded-full", isLight ? "bg-gray-200" : "bg-slate-700")}
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
        <span className={cn("w-8 text-right text-[11px] tabular-nums", isLight ? "text-gray-600" : "text-slate-400")}>{task.progress}%</span>
      </div>

      <div className={cn("mt-2 flex items-center justify-between gap-2 text-xs", isLight ? "text-gray-600" : "text-slate-400")}>
        <span className="min-w-0 truncate">{formatStartedAgo(task.startedAt)}</span>
        <span className="flex flex-shrink-0 items-center gap-2 tabular-nums">
          <span>{formatTokens(task.tokensIn + task.tokensOut)} tok</span>
          <span className={cn("font-medium", isLight ? "text-gray-900" : "text-white")}>{formatCost(task.costUsd)}</span>
        </span>
      </div>

      {task.error ? <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-500">{task.error}</div> : null}
    </div>
  )
}
