"use client"

import { FilePlus2, Plus, Rocket, ShieldAlert, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

import { Button, Field, IconButton, Input, Select, Switch, Tabs, TabsList, TabsTrigger, Textarea } from "@/components/ui"
import type {
  AgentPermissionMode,
  AgentProvider,
  AgentTaskBudgetSettings,
  AgentTaskOptionsResponse,
  AgentTaskPriority,
  AgentTaskProviderOption,
  CreateAgentTaskInput,
} from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { PERMISSION_MODE_LABELS } from "./permission-modes"

export interface AdvancedTaskFormProps {
  onCreate: (input: CreateAgentTaskInput) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Called after a successful submit, once the form has been reset. */
  onCreated?: () => void
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
const NO_CONTEXT = "none"

/** "" = use the default (undefined); otherwise a number the server range-checks. NaN = not a number. */
function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  return trimmed ? Number(trimmed) : undefined
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || filePath
}

/**
 * The Advanced one-off task form (provider, model, permissions, context, budget). The caller decides what a created
 * task becomes (a Deployment plus its first run).
 */
export function AdvancedTaskForm({ onCreate, onCreated }: AdvancedTaskFormProps) {
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
  const [costBudget, setCostBudget] = useState("")
  const [tokenBudget, setTokenBudget] = useState("")
  const [budgetDefaults, setBudgetDefaults] = useState<AgentTaskBudgetSettings | null>(null)

  const selectedProvider = useMemo(() => providerOptions.find((option) => option.provider === agent), [agent, providerOptions])
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
        const initial = data.active ? data.providers.find((option) => option.provider === data.active?.provider) : data.providers[0]
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
      setError("Budgets must be numbers. Leave a field empty to use your default.")
      return
    }
    setPending(true)
    setError("")

    let finalContextId = selectedContext === NO_CONTEXT ? "" : selectedContext
    if (showNewContextInput && newContextName.trim()) {
      try {
        const contextRes = await fetch(TASK_CONTEXTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newContextName.trim() }),
        })
        const contextData = (await contextRes.json()) as { ok?: boolean; context?: { id: string }; error?: string }
        if (!contextData.ok || !contextData.context) {
          setError(contextData.error || "Failed to create context")
          setPending(false)
          return
        }
        finalContextId = contextData.context.id
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
    onCreated?.()
  }

  const canSubmit = !pending && !optionsLoading && Boolean(model) && Boolean(prompt.trim())
  const costPlaceholder = budgetDefaults
    ? budgetDefaults.defaultCostBudgetUsd !== null
      ? `$${budgetDefaults.defaultCostBudgetUsd.toFixed(2)} default`
      : "No limit"
    : "Default"
  const tokenPlaceholder = budgetDefaults
    ? budgetDefaults.defaultTokenBudget !== null
      ? `${budgetDefaults.defaultTokenBudget.toLocaleString("en-US")} default`
      : "No limit"
    : "Default"

  return (
    <form aria-label="One-off task" onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Prompt" required aside={<span className="font-mono tabular-nums">{`${prompt.length.toLocaleString("en-US")} / ${PROMPT_MAX_LENGTH.toLocaleString("en-US")}`}</span>}>
            <Textarea
              value={prompt}
              maxLength={PROMPT_MAX_LENGTH}
              onChange={(event) => setPrompt(event.target.value)}
              autoGrow
              minRows={7}
              maxRows={18}
              placeholder="What should the agent do? Describe the result and any constraints."
              className="leading-6"
            />
          </Field>

          <Field label="Name" hint="Defaults to the start of the prompt.">
            <Input value={name} maxLength={NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Files</span>
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-colors",
                isDragging ? "border-accent-border bg-accent-muted" : "border-border-strong bg-surface-2",
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
              <FilePlus2 className="size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-xs text-muted">Drop files here to give the agent their contents as context (desktop app).</p>
            </div>
            {attachedFiles.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {attachedFiles.map((file) => (
                  <li key={file} title={file} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-surface-3 py-0.5 pr-0.5 pl-2 font-mono text-xs text-fg">
                    <span className="truncate">{basename(file)}</span>
                    <IconButton aria-label={`Remove ${basename(file)}`} size="sm" className="size-5" onClick={() => removeFile(file)}>
                      <X />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-border-subtle lg:pl-6">
          <Field label="Provider">
            <Select
              value={agent}
              options={providerSelectOptions}
              onValueChange={handleAgentChange}
              placeholder={optionsLoading ? "Loading" : "No providers connected"}
              disabled={optionsLoading || providerSelectOptions.length === 0}
            />
          </Field>
          <Field label="Model">
            <Select
              value={model}
              options={modelOptions}
              onValueChange={setModel}
              mono
              placeholder={optionsLoading ? "Loading" : "No models available"}
              disabled={optionsLoading || modelOptions.length === 0}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Priority</span>
            <Tabs value={priority} onValueChange={(value) => setPriority(value as AgentTaskPriority)} variant="segmented">
              <TabsList aria-label="Priority" className="w-full">
                {PRIORITY_OPTIONS.map((option) => (
                  <TabsTrigger key={option} value={option} className="flex-1 justify-center capitalize">
                    {option}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <Field label="Permission mode">
            <Select value={permissionMode} options={PERMISSION_OPTIONS} onValueChange={(value) => setPermissionMode(value as AgentPermissionMode)} />
          </Field>
          {permissionMode === "bypass" ? (
            <p className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-xs text-fg">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
              Bypass allows elevated operations without confirmation. Workspace confinement and platform-level dangerous-operation
              blocks still apply.
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Context</span>
            {!showNewContextInput ? (
              <div className="flex gap-2">
                <Select value={selectedContext} options={contextOptions} onValueChange={setSelectedContext} className="min-w-0 flex-1" aria-label="Context" />
                <Button type="button" variant="outline" onClick={() => setShowNewContextInput(true)}>
                  <Plus />
                  New
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={newContextName}
                  onChange={(e) => setNewContextName(e.target.value)}
                  placeholder="Name the new context"
                  aria-label="New context name"
                  maxLength={CONTEXT_NAME_MAX_LENGTH}
                  className="min-w-0 flex-1"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowNewContextInput(false)
                    setNewContextName("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
            <p className="text-xs text-muted">Tasks in the same context share what they learn.</p>
          </div>

          <Field label="Isolated git worktree" hint="Lets several agent tasks edit the repo in parallel." inline>
            <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost budget (USD)">
              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                max={100}
                step={0.01}
                mono
                value={costBudget}
                onChange={(event) => setCostBudget(event.target.value)}
                placeholder={costPlaceholder}
              />
            </Field>
            <Field label="Token budget">
              <Input
                type="number"
                inputMode="numeric"
                min={1000}
                max={10000000}
                step={1000}
                mono
                value={tokenBudget}
                onChange={(event) => setTokenBudget(event.target.value)}
                placeholder={tokenPlaceholder}
              />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted">
            Empty uses your default (Settings, Agent budgets). Near the limit the task switches to an economy model, then pauses
            and asks.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-4">
        {error ? (
          <p role="alert" className="mr-auto min-w-0 flex-1 text-sm text-danger">
            {error}
          </p>
        ) : (
          <p className="mr-auto min-w-0 flex-1 text-xs text-muted">Runs once with the model you pick. You land on its run when it starts.</p>
        )}
        <Button type="submit" disabled={!canSubmit} loading={pending}>
          <Rocket />
          Create task
        </Button>
      </div>
    </form>
  )
}
