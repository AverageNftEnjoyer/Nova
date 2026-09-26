"use client"

import { CheckCircle2, Loader2, Rocket, Send, Sparkles } from "lucide-react"
import { useEffect, useRef } from "react"

import { primaryButtonClass, selectedSurfaceClass } from "@/lib/shared/surfaces"
import { cn } from "@/lib/shared/utils"
import type { DeploymentManager } from "../hooks/use-deployment-manager"
import { StatusChip } from "./deployment-ui"

const EXAMPLE_OUTCOMES = [
  "Research three accounting tools, compare them against my requirements, and send me a recommendation.",
  "Every weekday at 8am, summarize my unread email and send the highlights to Telegram.",
  "Review the open TODOs in my notes and draft a prioritized plan for this week.",
]

const RISK_TONE = { low: "success", medium: "warning", high: "danger" } as const

interface ManagerPanelProps {
  isLight: boolean
  subPanelClass: string
  manager: DeploymentManager
}

export function ManagerPanel({ isLight, subPanelClass, manager }: ManagerPanelProps) {
  const { input, setInput, requests, busy, plan, plannedDeployment, launching, error, connected, novaState, thinkingStatus } = manager
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const mutedText = isLight ? "text-s-50" : "text-slate-400"
  const strongText = isLight ? "text-s-90" : "text-slate-100"
  const hasConversation = requests.length > 0

  // Keep the newest request / plan in view as the conversation grows.
  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [requests.length, plan, busy, error])

  const applyExample = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!hasConversation ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 py-6 text-center">
            <span className={cn("grid h-11 w-11 place-items-center rounded-xl border", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25")}>
              <Sparkles className="h-5 w-5 text-accent" />
            </span>
            <h3 className={cn("mt-4 text-lg font-semibold tracking-tight", strongText)}>What should Nova deploy?</h3>
            <p className={cn("mt-1.5 max-w-lg text-sm leading-6", mutedText)}>
              Describe the result you want. Nova decides whether it is a one-off task or a reusable automation, picks
              the tools, and asks for your review before sensitive work.
            </p>
            <div className="mt-5 grid w-full gap-1.5">
              {EXAMPLE_OUTCOMES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => applyExample(example)}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-[12px] leading-5 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
                    subPanelClass,
                    isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-white",
                  )}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-1 py-2">
            {requests.map((request, index) => (
              <article
                key={`${request}-${index}`}
                className={cn(
                  "ml-auto max-w-[85%] rounded-lg border px-3.5 py-2.5 text-sm leading-6",
                  selectedSurfaceClass(isLight),
                )}
              >
                {request}
              </article>
            ))}

            {busy || novaState === "thinking" ? (
              <div className={cn("flex items-center gap-2 text-sm", mutedText)} role="status">
                <Loader2 className="h-4 w-4 animate-spin" />
                {busy ? "Nova is building and validating the deployment plan…" : thinkingStatus || "Nova is planning…"}
              </div>
            ) : null}

            {plan && plannedDeployment ? (
              <article className={cn("max-w-[92%] rounded-lg p-4 home-spotlight-card home-border-glow", subPanelClass)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn("text-[11px] font-medium", mutedText)}>Validated manager plan</p>
                    <h4 className={cn("mt-0.5 text-[15px] font-semibold leading-6", strongText)}>{plannedDeployment.title}</h4>
                  </div>
                  <StatusChip isLight={isLight} tone="accent">
                    {plan.kind === "automation" ? "Automation" : "One-off task"}
                  </StatusChip>
                </div>

                {plan.acceptanceCriteria.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {plan.acceptanceCriteria.map((criterion) => (
                      <li key={criterion} className={cn("flex items-start gap-2 text-sm leading-5", isLight ? "text-s-70" : "text-slate-300")}>
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        {criterion}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <StatusChip isLight={isLight} tone={RISK_TONE[plan.risk]}>
                    {plan.risk} risk
                  </StatusChip>
                  <StatusChip isLight={isLight} tone={plan.reviewRequired ? "warning" : "neutral"}>
                    {plan.reviewRequired ? "Review required" : "No review needed"}
                  </StatusChip>
                  {plan.budgetEstimate.costUsd !== null ? (
                    <StatusChip isLight={isLight} tone="neutral">
                      About ${plan.budgetEstimate.costUsd.toFixed(2)}
                    </StatusChip>
                  ) : null}
                </div>
                {plan.specialists.length > 0 ? (
                  <p className={cn("mt-2 text-xs leading-5", mutedText)}>Specialists: {plan.specialists.join(", ")}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void manager.launch()}
                  disabled={launching}
                  className={cn(
                    "mt-4 inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50",
                    "home-spotlight-card home-border-glow home-spotlight-card--hover",
                    primaryButtonClass(isLight),
                  )}
                >
                  {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4 text-accent" />}
                  {plan.kind === "automation" ? "Deploy automation" : "Queue task"}
                </button>
              </article>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-400">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <form onSubmit={manager.submit} className="mt-3 shrink-0">
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border p-2 transition-colors focus-within:border-accent-30",
            isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/30",
          )}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={2}
            aria-label="Deployment outcome"
            placeholder="Describe an outcome, not implementation steps…"
            className={cn(
              "min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none",
              isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500",
            )}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send deployment request"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              primaryButtonClass(isLight),
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className={cn("mt-1.5 flex items-center gap-1.5 px-1 text-[11px]", mutedText)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-yellow-500")} aria-hidden="true" />
          {connected
            ? "Enter to send, Shift+Enter for a new line"
            : "Nova's runtime is offline. The server still plans and validates your request."}
        </p>
      </form>
    </div>
  )
}
