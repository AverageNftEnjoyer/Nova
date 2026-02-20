import { RefreshCcw, Settings } from "lucide-react"

import { cn } from "@/lib/shared/utils"
import { ANALYTICS_MODULES } from "../constants"
import type { AnalyticsModuleKey } from "../types"

interface ModuleSettingsMenuProps {
  open: boolean
  isLight: boolean
  enabledModules: Record<AnalyticsModuleKey, boolean>
  onToggle: (key: AnalyticsModuleKey) => void
  onReset: () => void
  onClose: () => void
}

export function ModuleSettingsMenu({ open, isLight, enabledModules, onToggle, onReset, onClose }: ModuleSettingsMenuProps) {
  if (!open) return null

  return (
    <div className="absolute right-0 top-11 z-40 w-80" role="dialog" aria-label="Analytics module settings">
      <div className={`home-spotlight-shell rounded-xl border p-3 backdrop-blur-xl ${isLight ? "border-[#d5dce8] bg-white/95" : "border-white/15 bg-black/60"}`}>
        <div className="mb-2 flex items-center justify-between">
          <div className="inline-flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent" />
            <h4 className={isLight ? "text-sm font-semibold text-s-90" : "text-sm font-semibold text-slate-100"}>Module Settings</h4>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-[border-color,box-shadow,background-color]",
              isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-50 hover:border-accent-30 hover:bg-white" : "border-white/10 bg-black/25 backdrop-blur-md text-slate-300 hover:border-accent-30 hover:bg-black/30",
              "hover:shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.26)]",
            )}
          >
            Close
          </button>
        </div>

        <div className="space-y-1.5">
          {ANALYTICS_MODULES.map((module) => (
            <label
              key={module.key}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2 transition-[border-color,box-shadow,background-color]",
                isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:border-accent-30 hover:bg-white" : "border-white/10 bg-black/25 backdrop-blur-md hover:border-accent-30 hover:bg-black/30",
                enabledModules[module.key] ? "border-accent-30" : "",
                "hover:shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.26)]",
              )}
            >
              <span>
                <p className={isLight ? "text-sm text-s-90" : "text-sm text-slate-100"}>{module.label}</p>
                <p className="text-xs text-s-50">{module.description}</p>
              </span>
              <input
                type="checkbox"
                checked={Boolean(enabledModules[module.key])}
                onChange={() => onToggle(module.key)}
                className="h-4 w-4"
                style={{ accentColor: "var(--accent-primary)" }}
              />
            </label>
          ))}
        </div>

        <button
          onClick={onReset}
          className={cn(
            "mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-[border-color,box-shadow,background-color]",
            isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-60 hover:border-accent-30 hover:bg-white" : "border-white/10 bg-black/25 backdrop-blur-md text-slate-200 hover:border-accent-30 hover:bg-black/30",
            "hover:shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.26)]",
          )}
        >
          <RefreshCcw className="h-3.5 w-3.5 text-accent" /> Reset default layout
        </button>
      </div>
    </div>
  )
}
