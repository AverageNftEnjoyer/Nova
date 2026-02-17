"use client"

import { Copy, Pencil, Play, Trash2 } from "lucide-react"
import type { RefObject } from "react"

import { cn } from "@/lib/utils"
import type { MissionActionMenuState } from "../types"

interface MissionActionMenuProps {
  isLight: boolean
  menu: MissionActionMenuState
  menuRef: RefObject<HTMLDivElement | null>
  onEdit: () => void
  onDuplicate: () => void
  onRunNow: () => void
  onDelete: () => void
}

export function MissionActionMenu({
  isLight,
  menu,
  menuRef,
  onEdit,
  onDuplicate,
  onRunNow,
  onDelete,
}: MissionActionMenuProps) {
  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-80 w-45 rounded-xl border p-1.5 shadow-lg backdrop-blur-xl",
        isLight
          ? "border-[#d5dce8] bg-[#f4f7fd]/95 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]"
          : "border-white/10 bg-black/25 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)]",
      )}
      style={{ left: menu.left, top: menu.top }}
    >
      <button
        onClick={onEdit}
        className={cn(
          "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
          "home-spotlight-card home-border-glow home-spotlight-card--hover",
          isLight
            ? "text-s-80 hover:bg-[#eef3fb]"
            : "text-slate-200 hover:bg-white/8",
        )}
      >
        <Pencil className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
        Edit Mission
      </button>
      <button
        onClick={onDuplicate}
        className={cn(
          "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
          "home-spotlight-card home-border-glow home-spotlight-card--hover",
          isLight
            ? "text-s-80 hover:bg-[#eef3fb]"
            : "text-slate-200 hover:bg-white/8",
        )}
      >
        <Copy className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
        Duplicate
      </button>
      <button
        onClick={onRunNow}
        className={cn(
          "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
          "home-spotlight-card home-border-glow home-spotlight-card--hover",
          isLight
            ? "text-s-80 hover:bg-[#eef3fb]"
            : "text-slate-200 hover:bg-white/8",
        )}
      >
        <Play className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
        Run Now
      </button>
      <div className={cn("my-1 border-t", isLight ? "border-[#e6ebf3]" : "border-white/12")} />
      <button
        onClick={onDelete}
        className={cn(
          "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
          "home-spotlight-card home-border-glow home-spotlight-card--hover",
          isLight
            ? "text-rose-600 hover:bg-rose-500/10"
            : "text-rose-300 hover:bg-rose-500/12",
        )}
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>
    </div>
  )
}
