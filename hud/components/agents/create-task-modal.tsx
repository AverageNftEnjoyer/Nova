"use client"

import { Loader2, ShieldAlert, X } from "lucide-react"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"

import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
} from "@/app/integrations/constants"
import { FluidSelect } from "@/components/ui/fluid-select"
import type { AgentPermissionMode, AgentProvider, AgentTaskPriority, CreateAgentTaskInput } from "@/lib/agents/types"
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

export function CreateTaskModal({ open, isLight, onClose, onCreate }: CreateTaskModalProps) {
  const [agent, setAgent] = useState<AgentProvider>("claude")
  const [model, setModel] = useState(() => defaultModelFor("claude"))
  const [prompt, setPrompt] = useState("")
  const [name, setName] = useState("")
  const [priority, setPriority] = useState<AgentTaskPriority>("normal")
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("default")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  const modelOptions = useMemo(() => MODEL_OPTIONS_BY_PROVIDER[agent], [agent])

  useEffect(() => {
    if (!open) {
      setError("")
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, pending, onClose])

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
    setPending(true)
    setError("")
    const result = await onCreate({
      name: name.trim() || undefined,
      prompt: trimmedPrompt,
      agent,
      model,
      priority,
      permissionMode,
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
              Bypass allows every operation without confirmation. Only use it for tasks you fully trust.
            </p>
          ) : null}

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
