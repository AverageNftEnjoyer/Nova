"use client"

import { ChevronDown, File, Loader2, ShieldAlert, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"

import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
} from "@/app/integrations/constants"
import { FluidSelect } from "@/components/ui/fluid-select"
import type {
  AgentPermissionMode,
  AgentProvider,
  AgentTaskBudgetSettings,
  AgentTaskPriority,
  CreateAgentTaskInput,
} from "@/lib/agents/types"
import { cn } from "@/lib/shared/utils"
import { PERMISSION_MODE_LABELS } from "./task-card"

interface CreateTaskModalProps {
  open: boolean
  isLight: boolean
  onClose: () => void
  onCreate: (input: CreateAgentTaskInput) => Promise<{ ok: true } | { ok: false; error: string }>
}

const PROMPT_MAX_LENGTH = 4000
const NAME_MAX_LENGTH = 80

const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "grok", label: "Grok" },
]

const MODEL_OPTIONS_BY_PROVIDER: Record<AgentProvider, { value: string; label: string }[]> = {
  claude: CLAUDE_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  openai: OPENAI_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  gemini: GEMINI_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  grok: GROK_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
}

const PRIORITY_OPTIONS: AgentTaskPriority[] = ["low", "normal", "high"]

const PERMISSION_OPTIONS = (Object.keys(PERMISSION_MODE_LABELS) as AgentPermissionMode[]).map((value) => ({
  value,
  label: PERMISSION_MODE_LABELS[value],
}))

function defaultModelFor(provider: AgentProvider): string {
  return MODEL_OPTIONS_BY_PROVIDER[provider][0]?.value ?? ""
}

const BUDGET_SETTINGS_URL = "/api/agent-tasks/budget-settings"

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

export function CreateTaskModal({ open, isLight, onClose, onCreate }: CreateTaskModalProps) {
  const [agent, setAgent] = useState<AgentProvider>("claude")
  const [model, setModel] = useState(() => defaultModelFor("claude"))
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
  const [selectedContext, setSelectedContext] = useState<string>("")
  const [newContextName, setNewContextName] = useState("")
  const [showNewContextInput, setShowNewContextInput] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [costBudget, setCostBudget] = useState("")
  const [tokenBudget, setTokenBudget] = useState("")
  const [budgetDefaults, setBudgetDefaults] = useState<AgentTaskBudgetSettings | null>(null)

  const modelOptions = useMemo(() => MODEL_OPTIONS_BY_PROVIDER[agent], [agent])

  // Clear a stale error when the modal closes (adjusting state during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setError("")
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, pending, onClose])

  useEffect(() => {
    if (!open) return
    // Load contexts when modal opens
    fetch("/api/task-contexts")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.contexts)) {
          setContexts(data.contexts)
        }
      })
      .catch(() => {
        // Ignore errors - contexts are optional
      })
  }, [open])

  useEffect(() => {
    if (!open) return
    // The user's default budgets, shown as placeholders. Optional: on failure the placeholders stay generic.
    let cancelled = false
    fetch(BUDGET_SETTINGS_URL, { cache: "no-store", credentials: "include" })
      .then((res) => res.json())
      .then((data: { ok?: boolean; settings?: AgentTaskBudgetSettings }) => {
        if (!cancelled && data.ok && data.settings) setBudgetDefaults(data.settings)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const unsubscribe = window.electronAPI?.onFileDrop?.((data) => {
      const filePath = String(data?.filePath || "").trim()
      if (!filePath) return
      setAttachedFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]))
    })
    return () => {
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }, [open])

  const removeFile = useCallback((filePath: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f !== filePath))
  }, [])

  if (!open || typeof document === "undefined") return null

  const handleAgentChange = (value: string) => {
    const next = value as AgentProvider
    setAgent(next)
    setModel(defaultModelFor(next))
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

    // Create new context if requested
    if (showNewContextInput && newContextName.trim()) {
      try {
        const contextRes = await fetch("/api/task-contexts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newContextName.trim() }),
        })
        const contextData = await contextRes.json()
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
    setSelectedContext("")
    setNewContextName("")
    setShowNewContextInput(false)
    setCostBudget("")
    setTokenBudget("")
    setBudgetOpen(false)
    onClose()
  }

  const labelClass = cn("mb-1 block text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")
  const fieldClass = cn(
    "w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-accent",
    isLight ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-50" : "border-white/10 bg-black/40 text-slate-100 placeholder:text-slate-500",
  )

  return createPortal(
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/56 p-4">
      <button type="button" className="absolute inset-0" onClick={() => !pending && onClose()} aria-label="Close create task dialog" />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Create task"
        onSubmit={(event) => void handleSubmit(event)}
        className={cn(
          "relative z-10 max-h-full w-full max-w-lg overflow-y-auto rounded-[1.25rem] border shadow-[0_28px_84px_-34px_rgba(0,0,0,0.68)]",
          isLight ? "border-[#d5dce8] bg-white/96" : "border-white/10 bg-[#05070a]/95",
        )}
      >
        <div className={cn("flex items-center justify-between border-b px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
          <div>
            <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-400")}>Agent Tasks</p>
            <h2 className={cn("text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>Create Task</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className={cn("rounded p-1.5 transition-colors", isLight ? "text-s-70 hover:bg-black/5" : "text-slate-300 hover:bg-white/10")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelClass}>Agent</span>
              <FluidSelect value={agent} options={PROVIDER_OPTIONS} onChange={handleAgentChange} isLight={isLight} />
            </div>
            <div>
              <span className={labelClass}>Model</span>
              <FluidSelect value={model} options={modelOptions} onChange={setModel} isLight={isLight} />
            </div>
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
            <label className={labelClass} htmlFor="agent-task-prompt">Prompt</label>
            <textarea
              id="agent-task-prompt"
              value={prompt}
              maxLength={PROMPT_MAX_LENGTH}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="What should the agent do?"
              className={cn(fieldClass, "resize-none")}
            />
            <p className={cn("mt-1 text-right text-[11px] tabular-nums", isLight ? "text-s-50" : "text-slate-500")}>
              {prompt.length}/{PROMPT_MAX_LENGTH}
            </p>
          </div>

          <div>
            <label className={labelClass}>Attached files (optional)</label>
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-3 text-center transition-colors",
                isDragging
                  ? "border-accent bg-accent/10"
                  : isLight
                    ? "border-[#d5dce8] bg-white/50"
                    : "border-white/10 bg-black/20",
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
              <File className={cn("mx-auto h-5 w-5 mb-1", isLight ? "text-s-50" : "text-slate-400")} />
              <p className={cn("text-[11px]", isLight ? "text-s-70" : "text-slate-300")}>
                Drag files here to attach as context
              </p>
            </div>
            {attachedFiles.length > 0 ? (
              <div className="mt-2 space-y-1">
                {attachedFiles.map((file) => (
                  <div
                    key={file}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
                      isLight ? "border-[#d5dce8] bg-white/50" : "border-white/10 bg-black/20",
                    )}
                  >
                    <File className={cn("h-3 w-3 flex-shrink-0", isLight ? "text-s-50" : "text-slate-400")} />
                    <span className={cn("flex-1 truncate", isLight ? "text-s-90" : "text-slate-100")}>
                      {basename(file)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(file)}
                      className={cn(
                        "flex-shrink-0 rounded p-0.5 transition-colors",
                        isLight ? "text-s-50 hover:bg-black/10 hover:text-s-90" : "text-slate-400 hover:bg-white/10 hover:text-slate-100",
                      )}
                      aria-label={`Remove ${basename(file)}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <label className={labelClass}>Context (optional)</label>
            {!showNewContextInput ? (
              <div className="flex gap-2">
                <select
                  value={selectedContext}
                  onChange={(e) => setSelectedContext(e.target.value)}
                  className={cn(fieldClass, "flex-1")}
                >
                  <option value="">None</option>
                  {contexts.map((ctx) => (
                    <option key={ctx.id} value={ctx.id}>
                      {ctx.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewContextInput(true)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs transition-colors whitespace-nowrap",
                    isLight
                      ? "border-[#d5dce8] text-s-70 hover:bg-black/5"
                      : "border-white/10 text-slate-300 hover:bg-white/10",
                  )}
                >
                  + New
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={newContextName}
                  onChange={(e) => setNewContextName(e.target.value)}
                  placeholder="Enter context name"
                  className={cn(fieldClass, "flex-1")}
                  maxLength={60}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowNewContextInput(false)
                    setNewContextName("")
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs transition-colors",
                    isLight
                      ? "border-[#d5dce8] text-s-70 hover:bg-black/5"
                      : "border-white/10 text-slate-300 hover:bg-white/10",
                  )}
                >
                  Cancel
                </button>
              </div>
            )}
            <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-500")}>
              Group related tasks to share context
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelClass}>Priority</span>
              <div className={cn("flex rounded-lg border p-0.5", isLight ? "border-[#d5dce8]" : "border-white/10")}>
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPriority(option)}
                    aria-pressed={priority === option}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 text-xs capitalize transition-colors",
                      priority === option
                        ? "bg-accent-20 text-accent"
                        : isLight
                          ? "text-s-70 hover:bg-black/5"
                          : "text-slate-300 hover:bg-white/10",
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
                value={permissionMode}
                options={PERMISSION_OPTIONS}
                onChange={(value) => setPermissionMode(value as AgentPermissionMode)}
                isLight={isLight}
              />
            </div>
          </div>

          {permissionMode === "bypass" ? (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Bypass allows elevated operations without confirmation. Workspace confinement and platform-level dangerous-operation blocks still apply.
            </p>
          ) : null}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
              className={cn(
                "h-4 w-4 rounded border transition-colors",
                isLight
                  ? "border-[#d5dce8] bg-white checked:bg-accent"
                  : "border-white/10 bg-black/40 checked:bg-accent",
              )}
            />
            <span className={cn("text-xs", isLight ? "text-s-70" : "text-slate-300")}>
              Use isolated git worktree (enables parallel agent tasks)
            </span>
          </label>

          <div className={cn("rounded-lg border", isLight ? "border-[#d5dce8]" : "border-white/10")}>
            <button
              type="button"
              onClick={() => setBudgetOpen((value) => !value)}
              aria-expanded={budgetOpen}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.16em] transition-colors",
                isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/5",
              )}
            >
              Budget (optional)
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", budgetOpen && "rotate-180")} />
            </button>
            {budgetOpen ? (
              <div className="space-y-2 px-3 pb-3">
                <div className="grid grid-cols-2 gap-3">
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
                            ? `Default $${budgetDefaults.defaultCostBudgetUsd.toFixed(2)}`
                            : "Default: no limit"
                          : "Your default"
                      }
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="agent-task-token-budget">Tokens (optional)</label>
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
                            ? `Default ${budgetDefaults.defaultTokenBudget.toLocaleString("en-US")}`
                            : "Default: no limit"
                          : "Your default"
                      }
                      className={fieldClass}
                    />
                  </div>
                </div>
                <p className={cn("text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-500")}>
                  Empty uses your default (Settings, Agent budgets). Budgets are on cost; a token limit is optional, since
                  cached tokens count in full but cost about a tenth. Near the limit the task switches to an economy
                  model, then pauses and asks.
                </p>
              </div>
            ) : null}
          </div>

          {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p> : null}
        </div>

        <div className={cn("flex justify-end gap-2 border-t px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", isLight ? "text-s-70 hover:bg-black/5" : "text-slate-300 hover:bg-white/10")}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-20 px-3 py-1.5 text-sm font-medium text-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create task
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
