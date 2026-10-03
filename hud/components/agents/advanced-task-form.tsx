"use client"

import { ChevronDown, FilePlus2, Loader2, Plus, Rocket, ShieldAlert, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"
import { getSettingsFieldClass } from "@/components/settings/settings-primitives"
import type {
  AgentPermissionMode,
  AgentProvider,
  AgentTaskBudgetSettings,
  AgentTaskOptionsResponse,
  AgentTaskPriority,
  AgentTaskProviderOption,
  CreateAgentTaskInput,
} from "@/lib/agents/types"
import { primaryButtonClass, selectedSurfaceClass } from "@/lib/shared/surfaces"
import { cn } from "@/lib/shared/utils"
import { PERMISSION_MODE_LABELS } from "./task-card"

export interface AdvancedTaskFormProps {
  isLight: boolean
  onCreate: (input: CreateAgentTaskInput) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Called after a successful submit, once the form has been reset. */
  onCreated?: () => void
  /** "holo": drawn on the Depot hologram screen; the pickers get hard-edged hologram classes (pixel-ui.css ".holo-select*"). */
  tone?: "default" | "holo"
}

const PROMPT_MAX_LENGTH = 4000
const NAME_MAX_LENGTH = 80
const CONTEXT_NAME_MAX_LENGTH = 60

const PRIORITY_OPTIONS: AgentTaskPriority[] = ["low", "normal", "high"]

const PERMISSION_OPTIONS = (Object.keys(PERMISSION_MODE_LABELS) as AgentPermissionMode[]).map((value) => ({
  value,
  label: PERMISSION_MODE_LABELS[value],
}))

const BUDGET_SETTINGS_URL = "/api/agent-tasks/budget-settings"
const TASK_OPTIONS_URL = "/api/agent-tasks/options"
const TASK_CONTEXTS_URL = "/api/task-contexts"
const NO_CONTEXT = ""

/** "" = use the default (undefined); otherwise a number the server range-checks. NaN = not a number. */
function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  return trimmed ? Number(trimmed) : undefined
}

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const parts = normalized.split("/")
  return parts[parts.length - 1] || filePath
}

/**
 * The Advanced one-off task form (provider, model, permissions, budget). Rendered inside the Deployments
 * composer; the caller decides what a created task becomes (a Deployment plus its first run).
 */
export function AdvancedTaskForm({ isLight, onCreate, onCreated, tone = "default" }: AdvancedTaskFormProps) {
  const selectClasses =
    tone === "holo" ? { buttonClassName: "holo-select", menuClassName: "holo-select-menu", optionClassName: "holo-select-option" } : {}
  const [agent, setAgent] = useState<AgentProvider>("openai")
  const [model, setModel] = useState("")
  const [providerOptions, setProviderOptions] = useState<AgentTaskProviderOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [prompt, setPrompt] = useState("")
  const [name, setName] = useState("")
  const [priority, setPriority] = useState<AgentTaskPriority>("normal")
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("default")
  const [useWorktree, setUseWorktree] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [contexts, setContexts] = useState<{ id: string; name: string }[]>([])
  const [selectedContext, setSelectedContext] = useState<string>(NO_CONTEXT)
  const [newContextName, setNewContextName] = useState("")
  const [showNewContextInput, setShowNewContextInput] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [costBudget, setCostBudget] = useState("")
  const [tokenBudget, setTokenBudget] = useState("")
  const [budgetDefaults, setBudgetDefaults] = useState<AgentTaskBudgetSettings | null>(null)

  const selectedProvider = useMemo(
    () => providerOptions.find((option) => option.provider === agent),
    [agent, providerOptions],
  )
  const modelOptions = selectedProvider?.models ?? []
  const providerSelectOptions = useMemo(
    () => providerOptions.map((option) => ({ value: option.provider, label: option.label })),
    [providerOptions],
  )
  const contextOptions = useMemo(
    () => [{ value: NO_CONTEXT, label: "None" }, ...contexts.map((ctx) => ({ value: ctx.id, label: ctx.name }))],
    [contexts],
  )

  // The three option requests are independent, so they start together on mount instead of in sequence.
  useEffect(() => {
    let cancelled = false
    fetch(TASK_OPTIONS_URL, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = (await res.json()) as AgentTaskOptionsResponse & { error?: string }
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load configured providers.")
        if (cancelled) return
        setProviderOptions(data.providers)
        const initial = data.active
          ? data.providers.find((option) => option.provider === data.active?.provider)
          : data.providers[0]
        if (initial) {
          setAgent(initial.provider)
          setModel(
            initial.models.some((option) => option.value === data.active?.model)
              ? data.active?.model ?? initial.defaultModel
              : initial.defaultModel,
          )
          setError("")
        } else {
          setModel("")
          setError("Connect an LLM provider in Integrations before creating a task.")
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setProviderOptions([])
          setModel("")
          setError(loadError instanceof Error ? loadError.message : "Failed to load configured providers.")
        }
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })

    fetch(TASK_CONTEXTS_URL, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { ok?: boolean; contexts?: { id: string; name: string }[] }) => {
        if (!cancelled && data.ok && Array.isArray(data.contexts)) setContexts(data.contexts)
      })
      .catch(() => {
        // Contexts are optional: without them the picker only offers "None" and "New".
      })

    // The user's default budgets, shown as placeholders. Optional: on failure the placeholders stay generic.
    fetch(BUDGET_SETTINGS_URL, { cache: "no-store", credentials: "include" })
      .then((res) => res.json())
      .then((data: { ok?: boolean; settings?: AgentTaskBudgetSettings }) => {
        if (!cancelled && data.ok && data.settings) setBudgetDefaults(data.settings)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFileDrop?.((data) => {
      const filePath = String(data?.filePath || "").trim()
      if (!filePath) return
      setAttachedFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]))
    })
    return () => {
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }, [])

  const removeFile = useCallback((filePath: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f !== filePath))
  }, [])

  const handleAgentChange = (value: string) => {
    const next = value as AgentProvider
    setAgent(next)
    const provider = providerOptions.find((option) => option.provider === next)
    setModel(provider?.defaultModel ?? provider?.models[0]?.value ?? "")
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || pending) return
    const costBudgetUsd = parseOptionalNumber(costBudget)
    const tokenBudgetValue = parseOptionalNumber(tokenBudget)
    if (Number.isNaN(costBudgetUsd) || Number.isNaN(tokenBudgetValue)) {
      setBudgetOpen(true)
      setError("Budgets must be numbers. Leave a field empty to use your default.")
      return
    }
    setPending(true)
    setError("")

    let finalContextId = selectedContext

    if (showNewContextInput && newContextName.trim()) {
      try {
        const contextRes = await fetch(TASK_CONTEXTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newContextName.trim() }),
        })
        const contextData = (await contextRes.json()) as { ok?: boolean; context?: { id: string }; error?: string }
        if (contextData.ok && contextData.context) {
          finalContextId = contextData.context.id
        } else {
          setError(contextData.error || "Failed to create context")
          setPending(false)
          return
        }
      } catch {
        setError("Failed to create context")
        setPending(false)
        return
      }
    }

    const result = await onCreate({
      name: name.trim() || undefined,
      prompt: trimmedPrompt,
      agent,
      model,
      priority,
      permissionMode,
      attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
      contextId: finalContextId || undefined,
      useWorktree,
      costBudgetUsd,
      tokenBudget: tokenBudgetValue,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPrompt("")
    setName("")
    setPriority("normal")
    setPermissionMode("default")
    setAttachedFiles([])
    setUseWorktree(false)
    setSelectedContext(NO_CONTEXT)
    setNewContextName("")
    setShowNewContextInput(false)
    setCostBudget("")
    setTokenBudget("")
    setBudgetOpen(false)
    onCreated?.()
  }

  const labelClass = cn("mb-1.5 block text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")
  const hintClass = cn("mt-1 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-500")
  const fieldClass = getSettingsFieldClass(isLight)
  const groupClass = cn(
    "rounded-lg border p-3",
    isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "home-subpanel-surface backdrop-blur-md",
  )
  const ghostButtonClass = cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
    isLight
      ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]"
      : "border-white/10 bg-black/25 text-slate-300 hover:bg-white/[0.06]",
  )
  const canSubmit = !pending && !optionsLoading && Boolean(model) && Boolean(prompt.trim())

  return (
    <form
      aria-label="Advanced task settings"
      onSubmit={(event) => void handleSubmit(event)}
      className="@container flex h-full min-h-0 flex-col"
    >
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-1">
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
          {/* What the agent should do */}
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <label className={labelClass} htmlFor="agent-task-prompt">Prompt</label>
              <textarea
                id="agent-task-prompt"
                value={prompt}
                maxLength={PROMPT_MAX_LENGTH}
                onChange={(event) => setPrompt(event.target.value)}
                rows={7}
                placeholder="What should the agent do? Describe the result and any constraints."
                className={cn(fieldClass, "resize-none leading-6")}
              />
              <p className={cn(hintClass, "text-right tabular-nums")}>
                {prompt.length.toLocaleString("en-US")} / {PROMPT_MAX_LENGTH.toLocaleString("en-US")}
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="agent-task-name">Name (optional)</label>
              <input
                id="agent-task-name"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="Defaults to the start of the prompt"
                className={fieldClass}
              />
            </div>

            <div>
              <span className={labelClass}>Files (optional)</span>
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-colors",
                  isDragging
                    ? "border-accent bg-accent-10"
                    : isLight
                      ? "border-[#cdd7e6] bg-white/60"
                      : "border-white/12 bg-black/15",
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(false)
                  const paths = Array.from(e.dataTransfer?.files ?? [])
                    .map((file) => {
                      try {
                        return window.electronAPI?.getPathForFile(file) || ""
                      } catch {
                        return ""
                      }
                    })
                    .map((filePath) => filePath.trim())
                    .filter(Boolean)
                  if (paths.length === 0) return
                  setAttachedFiles((prev) => [...prev, ...paths.filter((filePath) => !prev.includes(filePath))])
                }}
              >
                <FilePlus2 className={cn("h-4 w-4 shrink-0", isLight ? "text-s-50" : "text-slate-400")} />
                <p className={cn("text-xs", isLight ? "text-s-60" : "text-slate-400")}>
                  Drop files here to give the agent their contents as context.
                </p>
              </div>
              {attachedFiles.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {attachedFiles.map((file) => (
                    <li
                      key={file}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-md border py-1 pl-2 pr-1 text-xs",
                        isLight ? "border-[#d5dce8] bg-white text-s-80" : "border-white/10 bg-black/25 text-slate-200",
                      )}
                      title={file}
                    >
                      <span className="truncate">{basename(file)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(file)}
                        className={cn(
                          "shrink-0 rounded p-0.5 transition-colors",
                          isLight ? "text-s-50 hover:bg-black/5 hover:text-s-90" : "text-slate-400 hover:bg-white/10 hover:text-slate-100",
                        )}
                        aria-label={`Remove ${basename(file)}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* How it runs */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className={cn(groupClass, "grid gap-3 @md:grid-cols-2 @3xl:grid-cols-1")}>
              <div>
                <span className={labelClass}>Provider</span>
                <FluidSelect
                  {...selectClasses}
                  value={agent}
                  options={providerSelectOptions}
                  onChange={handleAgentChange}
                  isLight={isLight}
                  placeholder={optionsLoading ? "Loading…" : "No providers connected"}
                  disabled={optionsLoading || providerSelectOptions.length === 0}
                />
              </div>
              <div>
                <span className={labelClass}>Model</span>
                <FluidSelect
                  {...selectClasses}
                  value={model}
                  options={modelOptions}
                  onChange={setModel}
                  isLight={isLight}
                  placeholder={optionsLoading ? "Loading…" : "No models available"}
                  disabled={optionsLoading || modelOptions.length === 0}
                />
              </div>
              <div>
                <span className={labelClass}>Priority</span>
                <div
                  role="group"
                  aria-label="Priority"
                  className={cn("flex h-10 rounded-lg border p-0.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25")}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPriority(option)}
                      aria-pressed={priority === option}
                      className={cn(
                        "flex-1 rounded-md px-2 text-xs capitalize transition-colors",
                        priority === option
                          ? cn("border font-medium", selectedSurfaceClass(isLight))
                          : isLight
                            ? "text-s-60 hover:text-s-90"
                            : "text-slate-400 hover:text-slate-100",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={labelClass}>Permission mode</span>
                <FluidSelect
                  {...selectClasses}
                  value={permissionMode}
                  options={PERMISSION_OPTIONS}
                  onChange={(value) => setPermissionMode(value as AgentPermissionMode)}
                  isLight={isLight}
                />
              </div>
            </div>

            {permissionMode === "bypass" ? (
              <p className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-400">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Bypass allows elevated operations without confirmation. Workspace confinement and platform-level
                dangerous-operation blocks still apply.
              </p>
            ) : null}

            <div className={groupClass}>
              <span className={labelClass}>Context (optional)</span>
              {!showNewContextInput ? (
                <div className="flex gap-2">
                  <FluidSelect
                    {...selectClasses}
                    value={selectedContext}
                    options={contextOptions}
                    onChange={setSelectedContext}
                    isLight={isLight}
                    className="min-w-0 flex-1"
                  />
                  <button type="button" onClick={() => setShowNewContextInput(true)} className={ghostButtonClass}>
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={newContextName}
                    onChange={(e) => setNewContextName(e.target.value)}
                    placeholder="Name the new context"
                    aria-label="New context name"
                    className={cn(fieldClass, "min-w-0 flex-1")}
                    maxLength={CONTEXT_NAME_MAX_LENGTH}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewContextInput(false)
                      setNewContextName("")
                    }}
                    className={ghostButtonClass}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <p className={hintClass}>Tasks in the same context share what they learn.</p>

              <div className={cn("mt-3 flex items-center justify-between gap-3 border-t pt-3", isLight ? "border-[#dfe5ef]" : "border-white/8")}>
                <div className="min-w-0">
                  <p id="agent-task-worktree-label" className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>
                    Isolated git worktree
                  </p>
                  <p className={hintClass}>Lets several agent tasks edit the repo in parallel.</p>
                </div>
                <NovaSwitch checked={useWorktree} onChange={setUseWorktree} size="sm" />
              </div>
            </div>

            <div className={cn("rounded-lg border", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "home-subpanel-surface backdrop-blur-md")}>
              <button
                type="button"
                onClick={() => setBudgetOpen((value) => !value)}
                aria-expanded={budgetOpen}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors",
                  isLight ? "text-s-50 hover:text-s-80" : "text-slate-400 hover:text-slate-200",
                )}
              >
                Budget (optional)
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", budgetOpen && "rotate-180")} />
              </button>
              {budgetOpen ? (
                <div className="space-y-2 px-3 pb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClass} htmlFor="agent-task-cost-budget">Cost (USD)</label>
                      <input
                        id="agent-task-cost-budget"
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={costBudget}
                        onChange={(event) => setCostBudget(event.target.value)}
                        placeholder={
                          budgetDefaults
                            ? budgetDefaults.defaultCostBudgetUsd !== null
                              ? `$${budgetDefaults.defaultCostBudgetUsd.toFixed(2)}`
                              : "No limit"
                            : "Default"
                        }
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="agent-task-token-budget">Tokens</label>
                      <input
                        id="agent-task-token-budget"
                        type="number"
                        inputMode="numeric"
                        min={1000}
                        max={10000000}
                        step={1000}
                        value={tokenBudget}
                        onChange={(event) => setTokenBudget(event.target.value)}
                        placeholder={
                          budgetDefaults
                            ? budgetDefaults.defaultTokenBudget !== null
                              ? budgetDefaults.defaultTokenBudget.toLocaleString("en-US")
                              : "No limit"
                            : "Default"
                        }
                        className={fieldClass}
                      />
                    </div>
                  </div>
                  <p className={hintClass}>
                    Empty uses your default (Settings, Agent budgets). Budgets are on cost; a token limit is optional,
                    since cached tokens count in full but cost about a tenth. Near the limit the task switches to an
                    economy model, then pauses and asks.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-3 flex shrink-0 flex-wrap items-center justify-end gap-3 border-t pt-3",
          isLight ? "border-[#dfe5ef]" : "border-white/8",
        )}
      >
        {error ? (
          <p role="alert" className="mr-auto min-w-0 flex-1 text-xs leading-5 text-rose-400">
            {error}
          </p>
        ) : (
          <p className={cn("mr-auto min-w-0 flex-1 text-xs", isLight ? "text-s-50" : "text-slate-500")}>
            Runs once with the model you pick. Progress shows under Runs.
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
            "home-spotlight-card home-border-glow home-spotlight-card--hover disabled:cursor-not-allowed disabled:opacity-45",
            primaryButtonClass(isLight),
          )}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4 text-accent" />}
          Create task
        </button>
      </div>
    </form>
  )
}
