"use client"

import { cn } from "@/lib/utils"

export interface SetupInstructionsProps {
  title?: string
  steps: string[]
  isLight: boolean
  subPanelClass: string
}

export function SetupInstructions({
  title = "Setup Instructions",
  steps,
  isLight,
  subPanelClass,
}: SetupInstructionsProps) {
  return (
    <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
      <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
        {title}
      </p>
      <ol className={cn("space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
        {steps.map((step, index) => (
          <li key={index}>{`${index + 1}. ${step}`}</li>
        ))}
      </ol>
    </div>
  )
}
