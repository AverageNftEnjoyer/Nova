"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/shared/utils"

type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

const TONE_CLASSES: Record<Tone, { light: string; dark: string; dot: string }> = {
  neutral: { light: "border-[#d5dce8] bg-white text-s-60", dark: "border-white/10 bg-white/[0.04] text-slate-400", dot: "bg-slate-400" },
  accent: { light: "border-accent-30 bg-[#edf3ff] text-s-80", dark: "border-accent-30 bg-white/8 text-slate-200", dot: "bg-accent" },
  info: { light: "border-sky-300 bg-sky-50 text-sky-700", dark: "border-sky-400/30 bg-sky-400/10 text-sky-300", dot: "bg-sky-400" },
  success: { light: "border-emerald-300 bg-emerald-50 text-emerald-700", dark: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" },
  warning: { light: "border-amber-300 bg-amber-50 text-amber-700", dark: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  danger: { light: "border-rose-300 bg-rose-50 text-rose-700", dark: "border-rose-400/30 bg-rose-400/10 text-rose-300", dot: "bg-rose-400" },
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
