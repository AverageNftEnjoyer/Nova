"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { getSettingsCardClass, playClickSound } from "@/components/settings/settings-primitives"
import type { AgentTaskBudgetProvider } from "@/lib/agents/types"
import type {
  ModelRoutingMode,
  ModelRoutingSettingsResponse,
  ModelRoutingSettingsUpdate,
} from "@/lib/settings/model-routing/types"
import { cn } from "@/lib/shared/utils"

const MODEL_ROUTING_URL = "/api/model-routing"

const PROVIDERS: { id: AgentTaskBudgetProvider; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
]

const MODE_OPTIONS: { id: ModelRoutingMode; label: string; description: string }[] = [
  {
    id: "off",
    label: "Off",
    description: "Every model call uses your selected model.",
  },
  {
    id: "trivial",
    label: "Trivial calls only",
    description:
      "Small helper calls use your provider's economy model: output-format fixes, empty-reply retries, Spotify command parsing, mission classify / extract steps, step suggestions and the Gmail digest. Your questions are still answered by your selected model. Nova keeps a call on your selected model when its prompt cache makes that cheaper. These calls are rare, so the saving is small.",
  },
  {
    id: "cost-saving",
    label: "Cost-saving",
    description:
      "Also answers ordinary chat and routed lookups (web research, email triage) with the economy model. Agent tasks, multi-step reasoning and open-ended tool use keep your selected model (an agent task near its budget can still switch, see Agent budgets). Cheaper, but everyday answers may be less capable, and how much it saves depends on your provider's prices.",
  },
]

type ModelRoutingApiResponse = Partial<ModelRoutingSettingsResponse> & { ok?: boolean; error?: string }

interface Props {
  isLight: boolean
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

export function SettingsModelRoutingPanel({ isLight, onNavigateToAgentBudgets }: Props) {
  const [data, setData] = useState<ModelRoutingSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMode, setSavingMode] = useState<ModelRoutingMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(MODEL_ROUTING_URL, { cache: "no-store", credentials: "include" })
        const body = (await res.json()) as ModelRoutingApiResponse
        const response = res.ok ? toSettingsResponse(body) : null
        if (!response) throw new Error(body.error || "Failed to load model routing.")
        if (!cancelled) setData(response)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load model routing.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const selectMode = async (mode: ModelRoutingMode) => {
    if (!data || savingMode || mode === data.settings.mode) return
    playClickSound()
    const update: ModelRoutingSettingsUpdate = { mode }
    setSavingMode(mode)
    setError(null)
    setStatus("")
    try {
      const res = await fetch(MODEL_ROUTING_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      })
      const body = (await res.json()) as ModelRoutingApiResponse
      const response = res.ok ? toSettingsResponse(body) : null
      if (!response) throw new Error(body.error || "Failed to save model routing.")
      setData(response)
      setStatus("Saved")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save model routing.")
    } finally {
      setSavingMode(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!data) {
    return <p className="text-xs text-rose-400">{error || "Failed to load model routing."}</p>
  }

  const mutedText = isLight ? "text-s-30" : "text-slate-500"
  const currentMode = data.settings.mode

  return (
    <div className="space-y-5">
      <p className={cn("text-xs leading-5", isLight ? "text-s-50" : "text-slate-400")}>
        Nova can send some of its own model calls to your provider&apos;s economy model instead of your selected model.
        It never switches provider, so no other key is needed, and it only routes a call when that is estimated to be
        cheaper, counting what your selected model already has in its prompt cache. Mission generation always uses
        your selected model, and a mission step that names its own model always uses that one.
      </p>

      <div role="radiogroup" aria-label="Model routing mode" className="space-y-2.5">
        {MODE_OPTIONS.map((option) => {
          const checked = option.id === currentMode
          const saving = savingMode === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={savingMode !== null}
              onClick={() => void selectMode(option.id)}
              className={cn(
                getSettingsCardClass(isLight),
                "group flex w-full items-start gap-3 p-4 text-left disabled:cursor-wait",
                checked && (isLight ? "border-accent-30 bg-[#edf3ff]" : "border-accent-30 bg-white/[0.06]"),
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-accent" : isLight ? "border-[#b9c3d6]" : "border-white/25",
                )}
              >
                {checked ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-sm", isLight ? "text-s-70 group-hover:text-s-90" : "text-slate-200 group-hover:text-white")}>
                    {option.label}
                  </span>
                  {option.id === data.defaultMode ? (
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-px text-[10px] uppercase tracking-[0.12em]",
                        isLight ? "border-[#d5dce8] text-s-40" : "border-white/15 text-slate-400",
                      )}
                    >
                      Default
                    </span>
                  ) : null}
                  {saving ? <span className={cn("text-[11px]", mutedText)}>Saving...</span> : null}
                </span>
                <span className={cn("mt-1 block text-xs leading-5", isLight ? "text-s-40" : "text-slate-400")}>
                  {option.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("mb-0.5 text-sm", isLight ? "text-s-70" : "text-slate-200")}>Economy models</p>
            <p className={cn("text-xs", mutedText)}>
              The same per-provider models agent tasks switch to near their budget. If your key can&apos;t use one, the
              call is retried once on your selected model.
            </p>
          </div>
          {onNavigateToAgentBudgets ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onNavigateToAgentBudgets}
              className={cn(
                "fx-spotlight-card fx-border-glow h-8 shrink-0 border px-3 text-xs",
                isLight
                  ? "border-[#d5dce8] text-s-60 hover:text-s-90"
                  : "border-white/10 text-slate-300 hover:text-white",
              )}
            >
              Change it in Agent budgets
            </Button>
          ) : (
            <p className={cn("text-xs", mutedText)}>Change it in Agent budgets.</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const active = provider.id === data.activeProvider
            return (
              <div
                key={provider.id}
                className={cn(
                  "min-w-0 rounded-lg border px-3 py-2.5",
                  active
                    ? isLight
                      ? "border-accent-30 bg-[#edf3ff]"
                      : "border-accent-30 bg-white/[0.06]"
                    : isLight
                      ? "border-[#e2e8f2] bg-white/60"
                      : "border-white/[0.06] bg-black/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")}>
                    {provider.label}
                  </p>
                  {active ? <span className="text-[10px] uppercase tracking-[0.12em] text-accent">Active</span> : null}
                </div>
                <p
                  className={cn("mt-1 truncate text-sm", isLight ? "text-s-80" : "text-slate-100")}
                  title={data.economyModels[provider.id]}
                >
                  {data.economyModelLabels[provider.id]}
                </p>
                {active && data.activeModel ? (
                  <p className={cn("mt-0.5 truncate text-[11px]", mutedText)} title={data.activeModel}>
                    Selected model: {data.activeModel}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-4 flex-wrap items-center justify-end gap-3">
        {error ? (
          <p className="text-xs text-rose-400">{error}</p>
        ) : status ? (
          <p className={cn("text-xs", isLight ? "text-emerald-700" : "text-emerald-300")}>{status}</p>
        ) : null}
      </div>
    </div>
  )
}
