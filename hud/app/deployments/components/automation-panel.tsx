"use client"

import { ArrowUpRight, ListChecks, Workflow } from "lucide-react"

import { cn } from "@/lib/shared/utils"

interface AutomationPanelProps {
  isLight: boolean
  subPanelClass: string
  onOpenBuilder: () => void
  onOpenCanvas: () => void
  onViewAutomations: () => void
}

export function AutomationPanel({
  isLight,
  subPanelClass,
  onOpenBuilder,
  onOpenCanvas,
  onViewAutomations,
}: AutomationPanelProps) {
  const mutedText = isLight ? "text-s-50" : "text-slate-400"
  const strongText = isLight ? "text-s-90" : "text-slate-100"
  const optionClass = cn(
    "group flex min-h-36 flex-col items-start rounded-lg p-4 text-left transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
    subPanelClass,
  )

  return (
    <div className="module-hover-scroll flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-1 py-4">
        <div>
          <h3 className={cn("text-lg font-semibold tracking-tight", strongText)}>Build an automation</h3>
          <p className={cn("mt-1 max-w-xl text-sm leading-6", mutedText)}>
            Automations run on a schedule or an event, as a graph of deterministic steps with retries and review.
            Start guided, or lay the steps out yourself.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onOpenBuilder} className={optionClass}>
            <ListChecks className="h-5 w-5 text-accent" />
            <span className={cn("mt-3 text-sm font-semibold", strongText)}>Use guided builder</span>
            <span className={cn("mt-1 text-xs leading-5", mutedText)}>
              Answer a few questions about the trigger, the steps and where results go.
            </span>
          </button>
          <button type="button" onClick={onOpenCanvas} className={optionClass}>
            <Workflow className="h-5 w-5 text-accent" />
            <span className={cn("mt-3 text-sm font-semibold", strongText)}>Open automation canvas</span>
            <span className={cn("mt-1 text-xs leading-5", mutedText)}>
              Drag triggers, AI steps and outputs onto a graph, then save it as a draft or run it now.
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onViewAutomations}
          className={cn("inline-flex items-center gap-1 self-start text-xs font-medium transition-colors hover:text-accent", mutedText)}
        >
          View existing automations
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
