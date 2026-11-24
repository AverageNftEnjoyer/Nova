"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Badge, Button, Spinner, Table, TBody, Td, Th, THead, Tr, toast } from "@/components/ui"
import { SettingsGroup, SettingsLoadError, SettingsLoading, playClickSound } from "@/components/settings/settings-primitives"
import type { AgentTaskBudgetProvider } from "@/lib/agents/types"
import type { ModelRoutingMode, ModelRoutingSettingsResponse, ModelRoutingSettingsUpdate } from "@/lib/settings/model-routing/types"
import { cn } from "@/lib/shared/utils"

const MODEL_ROUTING_URL = "/api/model-routing"

const PROVIDERS: { id: AgentTaskBudgetProvider; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
]

const MODE_OPTIONS: { id: ModelRoutingMode; label: string; summary: string; detail: string }[] = [
  {
    id: "off",
    label: "Off",
    summary: "Every call uses your selected model.",
    detail: "Requests are sent exactly as they would be without routing.",
  },
  {
    id: "trivial",
    label: "Helper calls only",
    summary: "Small background calls use the economy model; your questions never do.",
    detail:
      "Output-format fixes, empty-reply retries, Spotify command parsing, mission classify and extract steps, step suggestions and the Gmail digest. These are rare, so the saving is small.",
  },
  {
    id: "cost-saving",
    label: "Cost-saving",
    summary: "Ordinary chat and routed lookups also use the economy model.",
    detail:
      "Agent tasks, multi-step reasoning and open-ended tool use keep your selected model. Cheaper, but everyday answers may be less capable.",
  },
]

type ModelRoutingApiResponse = Partial<ModelRoutingSettingsResponse> & { ok?: boolean; error?: string }

interface Props {
  /** Opens Settings -> Agent budgets, where the economy models are edited. */
  onNavigateToAgentBudgets?: () => void
}

function toSettingsResponse(body: ModelRoutingApiResponse): ModelRoutingSettingsResponse | null {
  if (!body.ok || !body.settings || !body.economyModels || !body.economyModelLabels) return null
  return {
    settings: body.settings,
    defaultMode: body.defaultMode ?? "trivial",
    modes: body.modes ?? MODE_OPTIONS.map((option) => option.id),
    economyModels: body.economyModels,
    economyModelLabels: body.economyModelLabels,
    activeProvider: body.activeProvider ?? null,
    activeModel: body.activeModel ?? null,
  }
}

export function SettingsModelRoutingPanel({ onNavigateToAgentBudgets }: Props) {
  const [data, setData] = useState<ModelRoutingSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingMode, setSavingMode] = useState<ModelRoutingMode | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(MODEL_ROUTING_URL, { cache: "no-store", credentials: "include" })
      const body = (await res.json()) as ModelRoutingApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "The model routing setting could not be read.")
      setData(response)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "The model routing setting could not be read.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectMode = async (mode: ModelRoutingMode) => {
    if (!data || savingMode || mode === data.settings.mode) return
    playClickSound()
    const update: ModelRoutingSettingsUpdate = { mode }
    setSavingMode(mode)
    try {
      const res = await fetch(MODEL_ROUTING_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      })
      const body = (await res.json()) as ModelRoutingApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "The model routing setting was not saved.")
      setData(response)
      toast.success(`Model routing: ${MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode}`)
    } catch (reason) {
      toast.error({
        title: "Model routing was not changed",
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setSavingMode(null)
    }
  }

  if (loading && !data) return <SettingsLoading label="Loading model routing" />
  if (!data) {
    return <SettingsLoadError title="Model routing did not load" message={loadError ?? "Try again."} onRetry={() => void load()} />
  }

  const currentMode = data.settings.mode
  const focusOption = (index: number) => {
    const next = (index + MODE_OPTIONS.length) % MODE_OPTIONS.length
    optionRefs.current[next]?.focus()
    void selectMode(MODE_OPTIONS[next].id)
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Mode"
        description="Routing never switches provider, and only routes a call when it is estimated to be cheaper, counting what your selected model already has cached."
      >
        <div role="radiogroup" aria-label="Model routing mode" className="flex flex-col gap-2 py-3">
          {MODE_OPTIONS.map((option, index) => {
            const checked = option.id === currentMode
            return (
              <button
                key={option.id}
                ref={(el) => {
                  optionRefs.current[index] = el
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                aria-busy={savingMode === option.id || undefined}
                disabled={savingMode !== null && savingMode !== option.id}
                onClick={() => void selectMode(option.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    event.preventDefault()
                    focusOption(index + 1)
                  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                    event.preventDefault()
                    focusOption(index - 1)
                  }
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 ease-out",
                  checked ? "border-accent-border bg-accent-muted" : "border-border bg-surface hover:border-border-strong hover:bg-hover",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    checked ? "border-accent" : "border-border-strong",
                  )}
                >
                  {checked ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{option.label}</span>
                    {option.id === data.defaultMode ? <Badge>Default</Badge> : null}
                    {savingMode === option.id ? <Spinner size="sm" /> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{option.summary}</span>
                  <span className="mt-1 block text-xs text-faint">{option.detail}</span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Economy models"
        description="If your key cannot use one, the call is retried once on your selected model."
        actions={
          onNavigateToAgentBudgets ? (
            <Button variant="ghost" size="sm" onClick={onNavigateToAgentBudgets}>
              Change in Agent budgets
            </Button>
          ) : null
        }
      >
        <Table density="compact">
          <THead>
            <tr>
              <Th>Provider</Th>
              <Th>Economy model</Th>
            </tr>
          </THead>
          <TBody>
            {PROVIDERS.map((provider) => {
              const active = provider.id === data.activeProvider
              return (
                <Tr key={provider.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      {provider.label}
                      {active ? <Badge tone="accent">In use</Badge> : null}
                    </span>
                  </Td>
                  <Td mono title={data.economyModels[provider.id]}>
                    {data.economyModelLabels[provider.id]}
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
        {data.activeProvider && data.activeModel ? (
          <p className="py-2.5 text-xs text-muted">
            Chat currently uses {PROVIDERS.find((p) => p.id === data.activeProvider)?.label} with{" "}
            <span className="font-mono text-fg">{data.activeModel}</span>.
          </p>
        ) : null}
      </SettingsGroup>
    </div>
  )
}
