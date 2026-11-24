"use client"

import { useState, type FormEvent } from "react"

import { Button, Field, Input } from "@/components/ui"
import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"

export type RaiseBudgetResult = { ok: true } | { ok: false; error: string }

const MAX_COST_BUDGET_USD = 100
const MAX_TOKEN_BUDGET = 10_000_000

/** Prefill: twice the current limit (or the spend, if higher), capped at the allowed maximum. */
function suggestedCost(limit: number | null, spent: number): string {
  if (limit === null) return ""
  return Math.min(MAX_COST_BUDGET_USD, Math.ceil(Math.max(limit, spent) * 2 * 100) / 100).toFixed(2)
}

function suggestedTokens(limit: number | null, spent: number): string {
  if (limit === null) return ""
  return String(Math.min(MAX_TOKEN_BUDGET, Math.ceil((Math.max(limit, spent) * 2) / 1_000) * 1_000))
}

interface RaiseBudgetFormProps {
  limitUsd: number | null
  limitTokens: number | null
  spentUsd: number
  spentTokens: number
  /** A budget-paused run resumes after the raise; otherwise the new limit just applies. */
  resumes: boolean
  onSubmit: (input: RaiseAgentTaskBudgetInput) => Promise<RaiseBudgetResult>
  onCancel: () => void
}

/** New cost and/or token limit for a task-backed run. Shows the fields that have a limit (cost when neither has). */
export function RaiseBudgetForm({ limitUsd, limitTokens, spentUsd, spentTokens, resumes, onSubmit, onCancel }: RaiseBudgetFormProps) {
  const [cost, setCost] = useState(() => suggestedCost(limitUsd, spentUsd))
  const [tokens, setTokens] = useState(() => suggestedTokens(limitTokens, spentTokens))
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const showCost = limitUsd !== null || limitTokens === null
  const showTokens = limitTokens !== null || limitUsd === null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const input: RaiseAgentTaskBudgetInput = {}
    if (showCost && cost.trim()) input.costBudgetUsd = Number(cost)
    if (showTokens && tokens.trim()) input.tokenBudget = Number(tokens)
    if (input.costBudgetUsd === undefined && input.tokenBudget === undefined) {
      setError("Enter a new cost or token budget.")
      return
    }
    if (Number.isNaN(input.costBudgetUsd) || Number.isNaN(input.tokenBudget)) {
      setError("Budgets must be numbers.")
      return
    }
    setPending(true)
    setError("")
    const result = await onSubmit(input)
    setPending(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" aria-label="Raise budget">
      <div className="grid grid-cols-2 gap-3">
        {showCost ? (
          <Field label="Cost limit (USD)" hint={`Up to $${MAX_COST_BUDGET_USD}`}>
            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={MAX_COST_BUDGET_USD}
              step={0.01}
              mono
              size="sm"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              data-autofocus
            />
          </Field>
        ) : null}
        {showTokens ? (
          <Field label="Token limit" hint="Input and output, cached included">
            <Input
              type="number"
              inputMode="numeric"
              min={1_000}
              max={MAX_TOKEN_BUDGET}
              step={1_000}
              mono
              size="sm"
              value={tokens}
              onChange={(event) => setTokens(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {resumes ? "Raise and resume" : "Raise budget"}
        </Button>
      </div>
    </form>
  )
}
