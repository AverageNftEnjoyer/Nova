"use client"

import type { ReactNode } from "react"

import type { DeploymentRunStatus, DeploymentStatus } from "@/lib/deployments/types"
import { cn } from "@/lib/shared/utils"

type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

const TONE_CLASSES: Record<Tone, { light: string; dark: string; dot: string }> = {
  neutral: { light: "border-[#d5dce8] bg-white text-s-60", dark: "border-white/10 bg-white/[0.04] text-slate-400", dot: "bg-slate-400" },
  accent: { light: "border-accent-30 bg-accent-10 text-s-80", dark: "border-accent-30 bg-accent-10 text-slate-200", dot: "bg-accent" },
  info: { light: "border-sky-300 bg-sky-50 text-sky-700", dark: "border-sky-400/30 bg-sky-400/10 text-sky-300", dot: "bg-sky-400" },
  success: { light: "border-emerald-300 bg-emerald-50 text-emerald-700", dark: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" },
  warning: { light: "border-amber-300 bg-amber-50 text-amber-700", dark: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  danger: { light: "border-rose-300 bg-rose-50 text-rose-700", dark: "border-rose-400/30 bg-rose-400/10 text-rose-300", dot: "bg-rose-400" },
}

const RUN_TONE: Record<DeploymentRunStatus, Tone> = {
  pending: "neutral",
  queued: "accent",
  running: "info",
  paused: "warning",
  succeeded: "success",
  failed: "danger",
  dead: "danger",
  cancelled: "neutral",
}

const RUN_LABEL: Record<DeploymentRunStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  succeeded: "Succeeded",
  failed: "Failed",
  dead: "Failed",
  cancelled: "Cancelled",
}

const DEPLOYMENT_TONE: Record<DeploymentStatus, Tone> = {
  draft: "neutral",
  ready: "accent",
  active: "success",
  paused: "warning",
  archived: "neutral",
}

interface ChipProps {
  isLight: boolean
  tone: Tone
  children: ReactNode
  pulse?: boolean
  className?: string
}

export function StatusChip({ isLight, tone, children, pulse = false, className }: ChipProps) {
  const toneClass = TONE_CLASSES[tone]
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10px] font-medium leading-none whitespace-nowrap",
        isLight ? toneClass.light : toneClass.dark,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", toneClass.dot, pulse && "animate-pulse")} aria-hidden="true" />
      {children}
    </span>
  )
}

export function RunStatusChip({
  isLight,
  status,
  needsReview = false,
}: {
  isLight: boolean
  status: DeploymentRunStatus
  needsReview?: boolean
}) {
  if (needsReview) {
    return (
      <StatusChip isLight={isLight} tone="warning" pulse>
        Needs review
      </StatusChip>
    )
  }
  return (
    <StatusChip isLight={isLight} tone={RUN_TONE[status]} pulse={status === "running"}>
      {RUN_LABEL[status]}
    </StatusChip>
  )
}

export function DeploymentStatusChip({ isLight, status }: { isLight: boolean; status: DeploymentStatus }) {
  return (
    <StatusChip isLight={isLight} tone={DEPLOYMENT_TONE[status]} className="capitalize">
      {status}
    </StatusChip>
  )
}

/** Mirrors Home's module header: icon left, centered tracked title, actions right. */
export function PanelHeader({
  isLight,
  icon,
  title,
  action,
}: {
  isLight: boolean
  icon: ReactNode
  title: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="grid shrink-0 grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
      <div className="flex items-center gap-2">{icon}</div>
      <h2
        className={cn(
          "flex min-w-0 items-center justify-center gap-2 truncate text-sm font-semibold uppercase tracking-[0.18em]",
          isLight ? "text-s-90" : "text-slate-200",
        )}
      >
        {title}
      </h2>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{action}</div>
    </div>
  )
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]
const relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "short" })

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  const ts = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(ts)) return ""
  const diff = ts - now
  if (Math.abs(diff) < 45_000) return "just now"
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms || unit === "minute") return relativeFormatter.format(Math.round(diff / ms), unit)
  }
  return ""
}
