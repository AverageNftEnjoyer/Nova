"use client"

import Link from "next/link"
import { ChevronRight, ListChecks, Workflow } from "lucide-react"

interface AutomationPanelProps {
  /** Guided Mission builder (questions about trigger, steps, destination). */
  builderHref: string
  onOpenCanvas: () => void
}

const optionClass =
  "group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

/** Advanced automation: the guided Mission builder or the graph canvas. */
export function AutomationPanel({ builderHref, onOpenCanvas }: AutomationPanelProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-md font-medium text-fg">Build an automation</h2>
        <p className="mt-1 text-sm text-muted">
          Automations run on a schedule or an event, as a graph of deterministic steps with retries and review. Start
          guided, or lay out the steps yourself.
        </p>
      </div>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
        <Link href={builderHref} className={optionClass}>
          <ListChecks className="size-5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-fg">Guided builder</span>
            <span className="block text-xs text-muted">Answer a few questions about the trigger, the steps and where results go.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" aria-hidden />
        </Link>
        <button type="button" onClick={onOpenCanvas} className={optionClass}>
          <Workflow className="size-5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-fg">Automation canvas</span>
            <span className="block text-xs text-muted">
              Drag triggers, AI steps and outputs onto a graph, then save it as a draft or run it now.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" aria-hidden />
        </button>
      </div>
      <Link href="/missions" className="self-start text-xs text-accent-text hover:underline">
        View existing automations in Missions
      </Link>
    </div>
  )
}
