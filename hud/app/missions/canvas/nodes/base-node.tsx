"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"

import { StatusDot } from "@/components/ui"
import type { NodeCatalogEntry } from "@/lib/missions/catalog"
import { cn } from "@/lib/shared/utils"
import { CATEGORY_ICON, CATEGORY_TONE } from "../category-tone"

export interface MissionNodeData extends Record<string, unknown> {
  nodeConfig: Record<string, unknown>
  catalogEntry: NodeCatalogEntry
  isSelected?: boolean
  isRunning?: boolean
  hasError?: boolean
  hasCompleted?: boolean
  label: string
}

const HANDLE_CLASS = "size-2! rounded-full! border! border-border-strong! bg-surface-3! hover:border-accent! hover:bg-accent!"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
}

/** One line that tells the node apart from others of the same type (schedule, query, URL, prompt...). */
function summarize(cfg: Record<string, unknown>): string {
  const type = text(cfg.type)
  if (type === "schedule-trigger") {
    const mode = text(cfg.triggerMode) || "daily"
    if (mode === "interval") return `Every ${text(cfg.triggerIntervalMinutes) || "30"} min`
    return `${mode.charAt(0).toUpperCase()}${mode.slice(1)} ${text(cfg.triggerTime) || "09:00"}`
  }
  if (type === "webhook-trigger") return `${text(cfg.method) || "POST"} ${text(cfg.path)}`
  if (type === "http-request") return `${text(cfg.method) || "GET"} ${text(cfg.url)}`
  if (type === "webhook-output") return `${text(cfg.method) || "POST"} ${text(cfg.url)}`
  if (type === "condition" && Array.isArray(cfg.rules)) {
    const rule = (cfg.rules[0] || {}) as Record<string, unknown>
    return [text(rule.field), text(rule.operator), text(rule.value)].filter(Boolean).join(" ")
  }
  if (type === "email-output" && Array.isArray(cfg.recipients)) return cfg.recipients.join(", ") || "No recipients"
  if (type === "agent-handoff") return [text(cfg.fromAgentId), text(cfg.toAgentId)].filter(Boolean).join(" to ")
  const candidates = ["query", "prompt", "url", "eventName", "goal", "key", "expression", "template", "messageTemplate", "content", "missionId", "agentId"]
  for (const key of candidates) {
    const value = text(cfg[key])
    if (value) return value
  }
  return ""
}

export const BaseNode = memo(function BaseNode({ data, selected }: NodeProps) {
  const { catalogEntry, isRunning, hasError, hasCompleted, label, nodeConfig } = data as MissionNodeData
  const Icon = CATEGORY_ICON[catalogEntry.category]
  const tone = CATEGORY_TONE[catalogEntry.category]
  const summary = summarize((nodeConfig || {}) as Record<string, unknown>)
  const status = isRunning ? { tone: "running" as const, label: "Running" } : hasError ? { tone: "danger" as const, label: "Failed" } : hasCompleted ? { tone: "success" as const, label: "Done" } : null

  return (
    <div
      className={cn(
        "relative w-56 rounded-md border border-l-2 bg-surface text-left transition-[border-color,box-shadow] duration-150",
        selected ? "border-accent ring-1 ring-accent" : isRunning ? "border-accent-border" : hasError ? "border-danger" : "border-border",
      )}
      style={{ borderLeftColor: tone }}
    >
      {catalogEntry.inputs.map((port, i) => (
        <Handle
          key={`in-${port}`}
          type="target"
          position={Position.Left}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.inputs.length - 1) / 2) * 24}%` }}
          className={HANDLE_CLASS}
        />
      ))}

      <div className="flex items-start gap-2 px-2.5 py-2">
        <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color: tone }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-fg">{label}</div>
          <div className="mt-0.5 truncate text-2xs text-muted">{catalogEntry.label}</div>
        </div>
        {status ? <StatusDot tone={status.tone} label={status.label} className="mt-1" /> : null}
      </div>

      {summary ? (
        <div className="truncate border-t border-border-subtle px-2.5 py-1.5 font-mono text-2xs text-faint">{summary}</div>
      ) : null}

      {catalogEntry.outputs.length > 1 ? (
        <div className="flex flex-wrap justify-end gap-1 border-t border-border-subtle px-2.5 py-1.5">
          {catalogEntry.outputs.map((port) => (
            <span key={port} className="rounded-sm bg-surface-3 px-1 font-mono text-2xs text-muted">{port}</span>
          ))}
        </div>
      ) : null}

      {catalogEntry.outputs.map((port, i) => (
        <Handle
          key={`out-${port}`}
          type="source"
          position={Position.Right}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.outputs.length - 1) / 2) * 24}%` }}
          className={HANDLE_CLASS}
        />
      ))}
    </div>
  )
})
