"use client"

import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"
import type { NotificationSchedule } from "../types"

interface DeleteMissionDialogProps {
  isLight: boolean
  mission: NotificationSchedule
  busy: boolean
  panelStyle?: CSSProperties
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteMissionDialog({
  isLight,
  mission,
  busy,
  panelStyle,
  onCancel,
  onConfirm,
}: DeleteMissionDialogProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onCancel}
        aria-label="Close delete confirmation"
      />
      <div
        style={panelStyle}
        className={cn(
          "relative z-10 w-full max-w-md rounded-2xl border p-4",
          isLight
            ? "border-[#d9e0ea] bg-white shadow-none"
            : "border-white/12 bg-[#0b111a]/95 backdrop-blur-xl",
        )}
      >
        <h3 className={cn("text-sm uppercase tracking-[0.18em] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
          Delete Mission
        </h3>
        <p className={cn("mt-2 text-sm", isLight ? "text-s-60" : "text-slate-300")}>
          This will permanently delete{" "}
          <span className={cn("font-medium", isLight ? "text-s-90" : "text-slate-100")}>
            {mission.label || "Untitled mission"}
          </span>
          .
        </p>
        <p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>
          Scheduled delivery for this mission will stop immediately.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className={cn(
              "h-8 px-3 rounded-md border text-xs transition-colors",
              isLight
                ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:bg-[#eef3fb]"
                : "border-white/12 bg-white/6 text-slate-200 hover:bg-white/10",
            )}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="h-8 px-3 rounded-md border border-rose-300/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/25 text-xs transition-colors disabled:opacity-60"
          >
            {busy ? "Deleting..." : "Delete Mission"}
          </button>
        </div>
      </div>
    </div>
  )
}
