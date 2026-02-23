"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "@/lib/shared/utils"
import type { NodeCatalogEntry } from "@/lib/missions/catalog"

export interface MissionNodeData extends Record<string, unknown> {
  nodeConfig: Record<string, unknown>
  catalogEntry: NodeCatalogEntry
  isSelected?: boolean
  isRunning?: boolean
  hasError?: boolean
  hasCompleted?: boolean
  label: string
}

export const BaseNode = memo(function BaseNode({ data, selected }: NodeProps) {
  const { catalogEntry, isRunning, hasError, hasCompleted, label } = data as MissionNodeData

  const statusRing = isRunning
    ? "ring-2 ring-cyan-300/60"
    : hasError
      ? "ring-2 ring-rose-400/65"
      : hasCompleted
        ? "ring-2 ring-emerald-400/65"
        : selected
          ? "ring-2 ring-white/35"
          : ""

  const statusTone = isRunning
    ? "border-cyan-300/35 bg-cyan-500/15 text-cyan-100"
    : hasError
      ? "border-rose-300/30 bg-rose-500/15 text-rose-100"
      : hasCompleted
        ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
        : "border-white/12 bg-white/[0.04] text-white/60"

  const statusLabel = isRunning ? "Running" : hasError ? "Error" : hasCompleted ? "Done" : "Idle"

  return (
    <div
      className={cn(
        "relative min-w-[220px] max-w-[290px] rounded-2xl border px-3 py-3 shadow-[0_18px_44px_rgba(2,6,23,0.45)] backdrop-blur-xl transition-all",
        catalogEntry.color,
        catalogEntry.borderColor,
        "bg-gradient-to-b from-slate-900/72 via-slate-950/66 to-black/62",
        statusRing,
      )}
    >
      {catalogEntry.inputs.map((port, i) => (
        <Handle
          key={`in-${port}`}
          type="target"
          position={Position.Left}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.inputs.length - 1) / 2) * 24}%` }}
          className="!h-3 !w-3 !rounded-full !border-2 !border-white/25 !bg-[hsl(var(--mission-flow-handle)/0.85)]"
        />
      ))}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]", catalogEntry.textColor, catalogEntry.borderColor)}>
            {catalogEntry.category}
          </span>
          <div className="mt-1.5 truncate text-sm font-semibold text-white/92">{label}</div>
        </div>
        <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-medium", statusTone)}>{statusLabel}</span>
      </div>

      {catalogEntry.outputs.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {catalogEntry.outputs.map((port) => (
            <span key={port} className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/55">
              {port}
            </span>
          ))}
        </div>
      )}

      {catalogEntry.outputs.map((port, i) => (
        <Handle
          key={`out-${port}`}
          type="source"
          position={Position.Right}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.outputs.length - 1) / 2) * 24}%` }}
          className="!h-3 !w-3 !rounded-full !border-2 !border-white/25 !bg-[hsl(var(--mission-flow-handle)/0.85)]"
        />
      ))}
    </div>
  )
})
