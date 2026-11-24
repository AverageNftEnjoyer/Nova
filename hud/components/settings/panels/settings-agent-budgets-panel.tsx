"use client"

import { useCallback, useEffect, useState } from "react"
import { Button, Input, Select, Switch, toast } from "@/components/ui"
import { SettingRow, SettingsGroup, SettingsLoadError, SettingsLoading } from "@/components/settings/settings-primitives"
import type {
  AgentTaskBudgetProvider,
  AgentTaskBudgetSettings,
  AgentTaskBudgetSettingsResponse,
  AgentTaskBudgetSettingsUpdate,
} from "@/lib/agents/types"

const BUDGET_SETTINGS_URL = "/api/agent-tasks/budget-settings"

const PROVIDERS: { id: AgentTaskBudgetProvider; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
]

/** What happens as a task spends its budget (src/runtime agent-task budget enforcement), in order. */
const ENFORCEMENT_STEPS = [
  { at: "80% spent", text: "The task is marked as nearing its budget. Nothing changes for the model yet." },
  { at: "Would go over", text: "Once, older tool results are trimmed and the task switches to the provider's economy model." },
  { at: "Still over", text: "The task pauses before that call and waits for you to raise the budget." },
] as const

type BudgetSettingsApiResponse = Partial<AgentTaskBudgetSettingsResponse> & { ok?: boolean; error?: string }

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

function toText(value: number | null): string {
  return value === null ? "" : String(value)
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

/** "" = no limit (null); otherwise a number the server range-checks. */
function parseLimit(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replace(/,/g, "")
  return trimmed ? Number(trimmed) : null
}

interface Draft {
  cost: string
  tokensOn: boolean
  tokens: string
  economyModels: AgentTaskBudgetSettings["economyModels"]
}

function draftFrom(response: AgentTaskBudgetSettingsResponse): Draft {
  return {
    cost: response.settings.defaultCostBudgetUsd === null ? "" : response.settings.defaultCostBudgetUsd.toFixed(2),
    tokensOn: response.settings.defaultTokenBudget !== null,
    tokens: toText(response.settings.defaultTokenBudget),
    economyModels: response.settings.economyModels,
  }
}

export function SettingsAgentBudgetsPanel() {
  const [data, setData] = useState<AgentTaskBudgetSettingsResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyResponse = useCallback((response: AgentTaskBudgetSettingsResponse) => {
    setData(response)
    setDraft(draftFrom(response))
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(BUDGET_SETTINGS_URL, { cache: "no-store", credentials: "include" })
      const body = (await res.json()) as BudgetSettingsApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "The budget settings could not be read.")
      applyResponse(response)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "The budget settings could not be read.")
    } finally {
      setLoading(false)
    }
  }, [applyResponse])

  useEffect(() => {
    void load()
  }, [load])

  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    const defaultCostBudgetUsd = parseLimit(draft.cost)
    const defaultTokenBudget = draft.tokensOn ? parseLimit(draft.tokens) : null
    if (Number.isNaN(defaultCostBudgetUsd) || Number.isNaN(defaultTokenBudget)) {
      setError("Budgets must be numbers. Leave the cost empty for no limit.")
      return
    }
    if (draft.tokensOn && defaultTokenBudget === null) {
      setError("Enter a token budget, or turn the token budget off.")
      return
    }
    const update: AgentTaskBudgetSettingsUpdate = { defaultCostBudgetUsd, defaultTokenBudget, economyModels: draft.economyModels }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(BUDGET_SETTINGS_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      })
      const body = (await res.json()) as BudgetSettingsApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "The budget settings were not saved.")
      applyResponse(response)
      toast.success("Agent budgets saved")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The budget settings were not saved.")
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <SettingsLoading label="Loading agent budgets" />
  if (!data || !draft) {
    return <SettingsLoadError title="Agent budgets did not load" message={loadError ?? "Try again."} onRetry={() => void load()} />
  }

  const { limits, defaults } = data
  const builtInDefault = defaults.costUsd === null ? "no limit" : formatUsd(defaults.costUsd)

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="Default limits" description="Apply to every new agent task unless the task sets its own.">
        <SettingRow
          label="Cost budget per task"
          hint={`${formatUsd(limits.cost.min)} to ${formatUsd(limits.cost.max)}. Built-in default ${builtInDefault}, about five times a typical task on the most expensive model. Empty means no cost limit.`}
        >
          <div className="relative w-32">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-faint">$</span>
            <Input
              value={draft.cost}
              onChange={(e) => edit({ cost: e.target.value })}
              inputMode="decimal"
              placeholder="No limit"
              maxLength={12}
              mono
              className="pl-5 text-right tabular-nums"
            />
          </div>
        </SettingRow>
        <SettingRow
          label="Token budget"
          hint="Off by default. Cached input counts as tokens but costs far less, so a token cap trips long before the cost cap. Turn it on for a model Nova has no price for."
        >
          <Switch checked={draft.tokensOn} onCheckedChange={(on) => edit({ tokensOn: on })} />
        </SettingRow>
        {draft.tokensOn ? (
          <SettingRow
            label="Tokens per task"
            hint={`${limits.tokens.min.toLocaleString("en-US")} to ${limits.tokens.max.toLocaleString("en-US")}, input (including cached) plus output.`}
          >
            <Input
              value={draft.tokens}
              onChange={(e) => edit({ tokens: e.target.value })}
              inputMode="numeric"
              placeholder={limits.tokens.min.toLocaleString("en-US")}
              maxLength={12}
              mono
              className="w-32 text-right tabular-nums"
            />
          </SettingRow>
        ) : null}
      </SettingsGroup>

      <section aria-labelledby="budget-enforcement-title" className="rounded-lg border border-border bg-surface-2 px-4 py-3">
        <h3 id="budget-enforcement-title" className="text-sm font-medium text-fg">
          When a task nears its budget
        </h3>
        <ol className="mt-2 flex flex-col gap-1.5">
          {ENFORCEMENT_STEPS.map((step) => (
            <li key={step.at} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-xs">
              <span className="text-muted">{step.at}</span>
              <span className="text-fg">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <SettingsGroup
        title="Economy models"
        description="The cheaper model of the same provider a task switches to near its budget. Model routing uses the same one."
      >
        {PROVIDERS.map((provider) => {
          const options = data.candidates[provider.id] ?? []
          const selected = options.find((option) => option.value === draft.economyModels[provider.id])
          return (
            <SettingRow key={provider.id} label={provider.label} hint={selected?.priceHint}>
              <Select
                value={draft.economyModels[provider.id]}
                options={options.map(({ value, label }) => ({ value, label }))}
                onValueChange={(value) => edit({ economyModels: { ...draft.economyModels, [provider.id]: value } })}
                placeholder="Choose a model"
                mono
                className="w-60"
              />
            </SettingRow>
          )
        })}
      </SettingsGroup>

      <div className="sticky bottom-0 -mt-4 flex items-center justify-end gap-3 border-t border-border bg-surface py-3">
        {error ? (
          <p className="mr-auto text-xs text-danger" role="alert">
            {error}
          </p>
        ) : dirty ? (
          <p className="mr-auto text-xs text-warning">Unsaved changes</p>
        ) : null}
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => applyResponse(data)}>
          Discard
        </Button>
        <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save budgets
        </Button>
      </div>
    </div>
  )
}
