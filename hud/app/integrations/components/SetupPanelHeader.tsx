"use client"

import { Save } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SetupPanelHeaderProps {
  title: string
  description: string
  isConnected: boolean
  isSaving: boolean
  isSavingAny: boolean
  onToggle: () => void
  onSave: () => void
  toggleLabel?: { enable: string; disable: string }
  isLight: boolean
}

export function SetupPanelHeader({
  title,
  description,
  isConnected,
  isSaving,
  isSavingAny,
  onToggle,
  onSave,
  toggleLabel = { enable: "Enable", disable: "Disable" },
  isLight,
}: SetupPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
          {title}
        </h2>
        <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
          {description}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          disabled={isSavingAny}
          className={cn(
            "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
            isConnected
              ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
              : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20"
          )}
        >
          {isConnected ? toggleLabel.disable : toggleLabel.enable}
        </button>
        <button
          onClick={onSave}
          disabled={isSavingAny}
          className={cn(
            "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60"
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  )
}
