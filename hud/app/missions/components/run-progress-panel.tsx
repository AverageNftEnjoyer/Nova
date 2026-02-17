"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Clock3, Loader2, X, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { MissionRunProgress } from "../types"

interface RunProgressPanelProps {
  isLight: boolean
  runProgress: MissionRunProgress
  onClose: () => void
  onOpenChat?: () => void
}

function formatStepTiming(step: MissionRunProgress["steps"][number], nowMs: number): string | null {
  if (!step.startedAt) return null
  const startMs = Date.parse(step.startedAt)
  if (!Number.isFinite(startMs)) return null
  if (!step.endedAt && step.status !== "running") return null
  const endMs = step.endedAt ? Date.parse(step.endedAt) : nowMs
  if (!Number.isFinite(endMs)) return null
  const seconds = Math.max(0, Math.round((endMs - startMs) / 100) / 10)
  return `${seconds}s`
}

export function RunProgressPanel({ isLight, runProgress, onClose, onOpenChat }: RunProgressPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!runProgress.running) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [runProgress.running])

  return (
    <div className="fixed right-4 top-16 z-75 w-[min(420px,calc(100vw-1.5rem))]">
      <div
        className={cn(
          "rounded-xl border px-3 py-3 backdrop-blur-lg",
          runProgress.success
            ? "border-emerald-300/35 bg-emerald-500/10"
            : runProgress.running
              ? "border-sky-300/35 bg-sky-500/10"
              : "border-rose-300/35 bg-rose-500/10",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-300")}>Mission Run Trace</p>
            <p className={cn("text-sm font-semibold truncate", isLight ? "text-s-90" : "text-slate-100")}>{runProgress.missionLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "h-7 w-7 rounded-md border inline-flex items-center justify-center transition-colors",
              isLight ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]" : "border-white/20 bg-black/20 text-slate-300 hover:bg-white/8",
            )}
            aria-label="Close run trace"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-2.5 space-y-1.5 max-h-[44vh] overflow-y-auto overflow-x-hidden pr-1">
          {runProgress.steps.map((step, index) => (
            (() => {
              const stepTiming = formatStepTiming(step, nowMs)
              return (
                <div
                  key={`${step.stepId}-${index}`}
                  className={cn(
                    "rounded-md border px-2.5 py-2 transition-all duration-300",
                    isLight ? "border-[#d5dce8] bg-white/90" : "border-white/14 bg-black/20",
                    step.status === "running" ? (isLight ? "ring-1 ring-sky-300/60 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]" : "ring-1 ring-sky-300/35 bg-sky-500/10") : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-start gap-2 min-w-0">
                      {step.status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300" />}
                      {step.status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
                      {step.status === "failed" && <XCircle className="w-3.5 h-3.5 text-rose-300" />}
                      {step.status === "pending" && <Clock3 className="w-3.5 h-3.5 text-slate-400" />}
                      {step.status === "skipped" && <Clock3 className="w-3.5 h-3.5 text-amber-300" />}
                      <p className={cn("min-w-0 whitespace-normal wrap-break-word text-xs font-medium leading-snug", isLight ? "text-s-90" : "text-slate-100")}>
                        {index + 1}. {step.title}
                      </p>
                    </div>
                    {stepTiming && (
                      <p className={cn("shrink-0 text-[10px] uppercase tracking-[0.08em] pt-[1px]", isLight ? "text-s-40" : "text-slate-500")}>
                        {stepTiming}
                      </p>
                    )}
                  </div>
                  {step.detail && (
                    <p className={cn("mt-1 pl-5 text-[11px] whitespace-normal break-all leading-snug", isLight ? "text-s-60" : "text-slate-300")}>{step.detail}</p>
                  )}
                </div>
              )
            })()
          ))}
        </div>
        {runProgress.reason && (
          <p className={cn("mt-2 text-[11px] whitespace-normal break-all leading-snug", isLight ? "text-s-60" : "text-slate-300")}>{runProgress.reason}</p>
        )}
        {runProgress.novachatQueued && onOpenChat && (
          <button
            type="button"
            onClick={onOpenChat}
            className={cn(
              "mt-2 h-8 w-full rounded-md border text-xs font-medium transition-colors",
              isLight ? "border-[#d5dce8] bg-white text-s-80 hover:bg-[#eef3fb]" : "border-white/14 bg-black/25 text-slate-200 hover:bg-white/10",
            )}
          >
            Open in Chat
          </button>
        )}
      </div>
    </div>
  )
}
