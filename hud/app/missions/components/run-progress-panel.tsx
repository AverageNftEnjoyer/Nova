"use client"

import { useEffect, useState } from "react"
import { MessageSquare, X } from "lucide-react"

import { Badge, Button, IconButton, StatusDot, type StatusTone } from "@/components/ui"
import { cn } from "@/lib/shared/utils"
import type { MissionRunProgress, MissionRunStepTrace } from "../types"

interface RunProgressPanelProps {
  runProgress: MissionRunProgress
  onClose: () => void
  onOpenChat?: () => void
}

const STEP_TONE: Record<MissionRunStepTrace["status"], StatusTone> = {
  pending: "idle",
  running: "running",
  completed: "success",
  failed: "danger",
  skipped: "warning",
}

const STEP_LABEL: Record<MissionRunStepTrace["status"], string> = {
  pending: "Pending",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  skipped: "Skipped",
}

function formatStepTiming(step: MissionRunStepTrace, nowMs: number): string | null {
  if (!step.startedAt) return null
  const startMs = Date.parse(step.startedAt)
  if (!Number.isFinite(startMs)) return null
  if (!step.endedAt && step.status !== "running") return null
  const endMs = step.endedAt ? Date.parse(step.endedAt) : nowMs
  if (!Number.isFinite(endMs)) return null
  const seconds = Math.max(0, Math.round((endMs - startMs) / 100) / 10)
  return `${seconds.toFixed(1)}s`
}

/** Floating run trace: one row per step with status, duration and output detail. */
export function RunProgressPanel({ runProgress, onClose, onOpenChat }: RunProgressPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!runProgress.running) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [runProgress.running])

  const overall = runProgress.running
    ? { tone: "accent" as const, label: "Running", dot: "pulse" as const }
    : runProgress.success
      ? { tone: "success" as const, label: "Completed", dot: true as const }
      : { tone: "danger" as const, label: "Failed", dot: true as const }
  const doneCount = runProgress.steps.filter((step) => step.status === "completed" || step.status === "skipped").length

  return (
    <section
      aria-label="Mission run trace"
      aria-live="polite"
      className="fixed top-14 right-4 z-120 flex max-h-[calc(100vh-5rem)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-overlay animate-pop-in"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-md font-medium text-fg">{runProgress.missionLabel}</h2>
            <Badge tone={overall.tone} dot={overall.dot}>{overall.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {doneCount} of {runProgress.steps.length} steps finished
          </p>
        </div>
        <IconButton aria-label="Close run trace" size="sm" onClick={onClose} className="-mr-1.5">
          <X />
        </IconButton>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {runProgress.steps.map((step, index) => {
          const timing = formatStepTiming(step, nowMs)
          const last = index === runProgress.steps.length - 1
          return (
            <li key={`${step.stepId}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
              {!last ? <span aria-hidden className="absolute top-4 bottom-0 left-[0.3125rem] w-px bg-border" /> : null}
              <span className="relative z-10 mt-1 flex size-2.5 shrink-0 items-center justify-center bg-surface">
                <StatusDot tone={STEP_TONE[step.status]} label={STEP_LABEL[step.status]} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={cn("min-w-0 text-sm wrap-break-word", step.status === "pending" ? "text-muted" : "text-fg")}>
                    {step.title}
                  </p>
                  <span className="shrink-0 font-mono text-2xs text-faint tabular-nums">
                    {timing ?? STEP_LABEL[step.status]}
                  </span>
                </div>
                {step.retryCount ? (
                  <p className="mt-0.5 text-xs text-muted tabular-nums">Retried {step.retryCount} times</p>
                ) : null}
                {step.detail || step.errorCode ? (
                  <pre
                    className={cn(
                      "mt-1.5 max-h-32 overflow-auto rounded-md border px-2 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-all",
                      step.status === "failed" ? "border-danger-muted bg-danger-muted text-danger" : "border-border-subtle bg-surface-2 text-muted",
                    )}
                  >
                    {[step.errorCode, step.detail].filter(Boolean).join("\n")}
                  </pre>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {runProgress.reason || (runProgress.telegramQueued && onOpenChat) ? (
        <footer className="flex flex-col gap-2 border-t border-border bg-surface-2 px-4 py-3">
          {runProgress.reason ? <p className="text-xs text-muted wrap-break-word">{runProgress.reason}</p> : null}
          {runProgress.telegramQueued && onOpenChat ? (
            <Button variant="secondary" size="sm" onClick={onOpenChat} className="self-start">
              <MessageSquare />
              Open in chat
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}
