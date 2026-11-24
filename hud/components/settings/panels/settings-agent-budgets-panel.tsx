"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { FluidSelect } from "@/components/ui/fluid-select"
import { getSettingsCardClass, SettingInput } from "@/components/settings/settings-primitives"
import type {
  AgentTaskBudgetProvider,
  AgentTaskBudgetSettings,
  AgentTaskBudgetSettingsResponse,
  AgentTaskBudgetSettingsUpdate,
} from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"

const BUDGET_SETTINGS_URL = "/api/agent-tasks/budget-settings"

const PROVIDERS: { id: AgentTaskBudgetProvider; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
]

type BudgetSettingsApiResponse = Partial<AgentTaskBudgetSettingsResponse> & { ok?: boolean; error?: string }

interface Props {
  isLight: boolean
}

function toText(value: number | null): string {
  return value === null ? "" : String(value)
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

/** A complete settings response, or null (an older server without `defaults` gets the built-in values). */
function toSettingsResponse(body: BudgetSettingsApiResponse): AgentTaskBudgetSettingsResponse | null {
  if (!body.ok || !body.settings || !body.candidates || !body.limits) return null
  return {
    settings: body.settings,
    candidates: body.candidates,
    limits: body.limits,
    defaults: body.defaults ?? { costUsd: 2, tokens: null },
  }
}

/** "" = no default limit (null); otherwise a number the server range-checks. */
function parseLimit(text: string): number | null {
  const trimmed = text.trim()
  return trimmed ? Number(trimmed) : null
}

export function SettingsAgentBudgetsPanel({ isLight }: Props) {
  const [data, setData] = useState<AgentTaskBudgetSettingsResponse | null>(null)
  const [costText, setCostText] = useState("")
  const [tokensText, setTokensText] = useState("")
  const [economyModels, setEconomyModels] = useState<AgentTaskBudgetSettings["economyModels"] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")

  const applyResponse = useCallback((response: AgentTaskBudgetSettingsResponse) => {
    setData(response)
    setCostText(toText(response.settings.defaultCostBudgetUsd))
    setTokensText(toText(response.settings.defaultTokenBudget))
    setEconomyModels(response.settings.economyModels)
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(BUDGET_SETTINGS_URL, { cache: "no-store", credentials: "include" })
        const body = (await res.json()) as BudgetSettingsApiResponse
        const response = res.ok ? toSettingsResponse(body) : null
        if (!response) throw new Error(body.error || "Failed to load agent budgets.")
        if (!cancelled) applyResponse(response)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load agent budgets.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [applyResponse])

  const save = async () => {
    if (!economyModels) return
    const defaultCostBudgetUsd = parseLimit(costText)
    const defaultTokenBudget = parseLimit(tokensText)
    if (Number.isNaN(defaultCostBudgetUsd) || Number.isNaN(defaultTokenBudget)) {
      setError("Budgets must be numbers. Leave a field empty for no limit.")
      return
    }
    const update: AgentTaskBudgetSettingsUpdate = { defaultCostBudgetUsd, defaultTokenBudget, economyModels }
    setSaving(true)
    setError(null)
    setStatus("")
    try {
      const res = await fetch(BUDGET_SETTINGS_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      })
      const body = (await res.json()) as BudgetSettingsApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "Failed to save agent budgets.")
      applyResponse(response)
      setStatus("Saved")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save agent budgets.")
    } finally {
      setSaving(false)
    }
  }

  const markDirty = () => {
    setDirty(true)
    setStatus("")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!data || !economyModels) {
    return <p className="text-xs text-rose-400">{error || "Failed to load agent budgets."}</p>
  }

  const { limits, defaults } = data
  const mutedText = isLight ? "text-s-30" : "text-slate-500"
  const defaultCostText = defaults.costUsd === null ? "no limit" : formatUsd(defaults.costUsd)

  return (
    <div className="space-y-5">
      <p className={cn("text-xs leading-5", isLight ? "text-s-50" : "text-slate-400")}>
        Each agent task has a cost budget. At 80% it is flagged; before it would go over, older tool results are trimmed
        and it switches to the provider&apos;s economy model; if that is still not enough, it pauses and asks you.
      </p>

      <SettingInput
        label="Default cost budget (USD)"
        description={`Per task, $${limits.cost.min}–$${limits.cost.max}. Built-in default ${defaultCostText}: about 5× a typical task on the most expensive model (GPT-6 Astra or Claude Fable 5.1, ~$0.40 with no caching), so normal tasks never reach it. Leave empty for no cost limit. A task can set its own when you create it.`}
        value={costText}
        onChange={(value) => {
          setCostText(value)
          markDirty()
        }}
        placeholder="No limit"
        maxLength={12}
        isLight={isLight}
      />

      <SettingInput
        label="Default token budget (optional)"
        description={`Off by default: budgets are on cost. Cached input counts as tokens but costs about 10% of normal input on most providers, so a token limit trips long before the money it is meant to protect. Set one (${limits.tokens.min.toLocaleString("en-US")}–${limits.tokens.max.toLocaleString("en-US")} tokens, input incl. cached plus output) to also cap tokens, e.g. for a custom model Nova has no price for, where a cost limit cannot stop a task.`}
        value={tokensText}
        onChange={(value) => {
          setTokensText(value)
          markDirty()
        }}
        placeholder="No limit"
        maxLength={12}
        isLight={isLight}
      />

      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <p className={cn("mb-0.5 text-sm", isLight ? "text-s-70" : "text-slate-200")}>Economy models</p>
        <p className={cn("mb-3 text-xs", mutedText)}>
          The cheaper model a task switches to when it nears its budget. Model routing also uses it. Always the same provider, so no other key is needed.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const options = data.candidates[provider.id] ?? []
            const selected = options.find((option) => option.value === economyModels[provider.id])
            return (
              <div key={provider.id} className="min-w-0">
                <p className={cn("mb-1 text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")}>
                  {provider.label}
                </p>
                <FluidSelect
                  value={economyModels[provider.id]}
                  options={options.map(({ value, label }) => ({ value, label }))}
                  isLight={isLight}
                  onChange={(value) => {
                    setEconomyModels((current) => (current ? { ...current, [provider.id]: value } : current))
                    markDirty()
                  }}
                />
                {selected?.priceHint ? <p className={cn("mt-1 text-[11px]", mutedText)}>{selected.priceHint}</p> : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {error ? (
          <p className="text-xs text-rose-400">{error}</p>
        ) : dirty ? (
          <p className={cn("text-xs", isLight ? "text-amber-700" : "text-amber-300")}>Unsaved changes</p>
        ) : status ? (
          <p className={cn("text-xs", isLight ? "text-emerald-700" : "text-emerald-300")}>{status}</p>
        ) : null}
        <Button
          onClick={() => void save()}
          disabled={saving || !dirty}
          size="sm"
          className={cn(
            "fx-spotlight-card fx-border-glow h-9 w-24 border text-white disabled:opacity-60",
            isLight
              ? "bg-emerald-600 border-emerald-700 hover:bg-emerald-700"
              : "bg-emerald-500/80 border-emerald-300/60 hover:bg-emerald-500",
          )}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
