"use client"

import { ArrowUp, Check, Rocket } from "lucide-react"
import { useEffect, useRef } from "react"

import { Badge, Button, IconButton, Kbd, Spinner, StatusDot, Textarea } from "@/components/ui"
import { formatUsd } from "@/components/agents/run-format"
import type { DeploymentManager } from "../hooks/use-deployment-manager"

const EXAMPLE_OUTCOMES = [
  "Research three accounting tools, compare them against my requirements, and send me a recommendation.",
  "Every weekday at 8am, summarize my unread email and send the highlights to Telegram.",
  "Review the open TODOs in my notes and draft a prioritized plan for this week.",
]

const RISK_TONE = { low: "success", medium: "warning", high: "danger" } as const

interface ManagerPanelProps {
  manager: DeploymentManager
}

/** Simple mode: describe an outcome, Nova returns a validated plan, you launch it. */
export function ManagerPanel({ manager }: ManagerPanelProps) {
  const { input, setInput, requests, busy, plan, plannedDeployment, launching, error, connected, novaState, thinkingStatus } = manager
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasConversation = requests.length > 0

  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [])

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <form onSubmit={manager.submit} className="flex flex-col gap-2">
          <label htmlFor="deployment-outcome" className="text-md font-medium text-fg">
            What should Nova get done?
          </label>
          <div className="relative">
            <Textarea
              id="deployment-outcome"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              autoGrow
              minRows={4}
              maxRows={12}
              placeholder="Describe the result you want, not the steps."
              className="pb-11 text-sm leading-6"
            />
            <IconButton
              type="submit"
              variant="primary"
              size="sm"
              aria-label="Plan this deployment"
              disabled={busy || !input.trim()}
              className="absolute right-2 bottom-2"
            >
              <ArrowUp />
            </IconButton>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <StatusDot tone={connected ? "success" : "warning"} size="sm" />
            {connected ? (
              <>
                <Kbd>Enter</Kbd> to plan, <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> for a new line
              </>
            ) : (
              "The runtime is offline. The server still plans and validates your request."
            )}
          </p>
        </form>

        {hasConversation ? (
          <ol className="flex flex-col gap-2" aria-label="Requests">
            {requests.map((request, index) => (
              <li key={`${request}-${index}`} className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-fg">
                {request}
              </li>
            ))}
          </ol>
        ) : null}

        {busy || novaState === "thinking" ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner size="sm" />
            {busy ? "Building and validating the plan" : thinkingStatus || "Planning"}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger-muted px-3.5 py-2.5 text-sm text-fg">
            {error}
          </p>
        ) : null}

        {plan && plannedDeployment ? (
          <article className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" aria-label="Validated plan">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted">Validated plan</p>
                <h3 className="mt-0.5 text-md font-medium text-fg">{plannedDeployment.title}</h3>
              </div>
              <Badge tone="accent">{plan.kind === "automation" ? "Automation" : "One-off task"}</Badge>
            </header>

            {plan.acceptanceCriteria.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {plan.acceptanceCriteria.map((criterion) => (
                  <li key={criterion} className="flex items-start gap-2 text-sm text-fg">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                    {criterion}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              <Badge tone={RISK_TONE[plan.risk]}>{`${plan.risk[0].toUpperCase()}${plan.risk.slice(1)} risk`}</Badge>
              <Badge tone={plan.reviewRequired ? "warning" : "neutral"}>{plan.reviewRequired ? "Review required" : "No review needed"}</Badge>
              {plan.budgetEstimate.costUsd !== null ? <Badge mono>{`About ${formatUsd(plan.budgetEstimate.costUsd)}`}</Badge> : null}
            </div>

            {plan.specialists.length > 0 || plan.tools.length > 0 ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                {plan.specialists.length > 0 ? (
                  <>
                    <dt className="text-muted">Specialists</dt>
                    <dd className="font-mono text-fg">{plan.specialists.join(", ")}</dd>
                  </>
                ) : null}
                {plan.tools.length > 0 ? (
                  <>
                    <dt className="text-muted">Tools</dt>
                    <dd className="font-mono text-fg">{plan.tools.join(", ")}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {plan.rationale ? <p className="text-xs text-muted">{plan.rationale}</p> : null}

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
              {plan.reviewRequired ? <p className="mr-auto text-xs text-muted">Launching counts as your approval of this plan.</p> : null}
              <Button onClick={() => void manager.launch()} loading={launching}>
                <Rocket />
                {plan.kind === "automation" ? "Deploy automation" : "Queue task"}
              </Button>
            </div>
          </article>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3 lg:border-l lg:border-border-subtle lg:pl-6">
        <h3 className="text-sm font-medium text-fg">How it works</h3>
        <p className="text-sm text-muted">
          Nova decides whether this is a one-off task or a reusable automation, picks the tools, and asks for your review
          before sensitive work. Nothing runs until you launch the plan.
        </p>
        <h3 className="mt-3 text-sm font-medium text-fg">Try one</h3>
        <ul className="flex flex-col gap-1">
          {EXAMPLE_OUTCOMES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setInput(example)
                  inputRef.current?.focus()
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
