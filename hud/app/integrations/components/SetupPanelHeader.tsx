"use client"

import { Save } from "lucide-react"
import { cn } from "@/lib/shared/utils"

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
            "pixel-btn",
            isConnected
              ? "pixel-btn--red"
              : "pixel-btn--teal"
          )}
        >
          {isConnected ? toggleLabel.disable : toggleLabel.enable}
        </button>
        <button
          onClick={onSave}
          disabled={isSavingAny}
          className={cn(
            "pixel-btn pixel-btn--gold"
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  )
}
