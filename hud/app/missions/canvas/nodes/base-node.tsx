"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/shared/utils"
import type { NodeCatalogEntry } from "@/lib/missions/catalog"
import { FluidSelect } from "@/components/ui/fluid-select"

export interface MissionNodeData extends Record<string, unknown> {
  nodeConfig: Record<string, unknown>
  catalogEntry: NodeCatalogEntry
  isSelected?: boolean
  isRunning?: boolean
  hasError?: boolean
  hasCompleted?: boolean
  label: string
}

const FIELD_INPUT =
  "nodrag nopan w-full rounded-md border border-white/12 bg-white/[0.06] px-2 py-1 text-[10px] text-white/88 placeholder:text-white/36 outline-none transition-colors focus:border-white/25"

function InlineFields({
  nodeId,
  nodeConfig,
}: {
  nodeId: string
  nodeConfig: Record<string, unknown>
}) {
  const { setNodes } = useReactFlow()

  const updateNodeConfig = (updates: Record<string, unknown>) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== nodeId) return node
        const currentData = (node.data || {}) as MissionNodeData
        const currentConfig = (currentData.nodeConfig || {}) as Record<string, unknown>
        const nextConfig = { ...currentConfig, ...updates }
        return {
          ...node,
          data: {
            ...currentData,
            label: typeof nextConfig.label === "string" ? nextConfig.label : currentData.label,
            nodeConfig: nextConfig,
          },
        }
      }),
    )
  }

  const label = typeof nodeConfig.label === "string" ? nodeConfig.label : ""
  const integration = typeof nodeConfig.integration === "string" ? nodeConfig.integration : ""
  const prompt = typeof nodeConfig.prompt === "string" ? nodeConfig.prompt : ""
  const query = typeof nodeConfig.query === "string" ? nodeConfig.query : ""
  const eventName = typeof nodeConfig.eventName === "string" ? nodeConfig.eventName : ""
  const path = typeof nodeConfig.path === "string" ? nodeConfig.path : ""
  const intent = typeof nodeConfig.intent === "string" ? nodeConfig.intent : ""
  const outputSchema = typeof nodeConfig.outputSchema === "string" ? nodeConfig.outputSchema : ""
  const messageTemplate = typeof nodeConfig.messageTemplate === "string" ? nodeConfig.messageTemplate : ""
  const expression = typeof nodeConfig.expression === "string" ? nodeConfig.expression : ""
  const field = typeof nodeConfig.field === "string" ? nodeConfig.field : ""
  const content = typeof nodeConfig.content === "string" ? nodeConfig.content : ""
  const missionId = typeof nodeConfig.missionId === "string" ? nodeConfig.missionId : ""
  const categories = Array.isArray(nodeConfig.categories) ? (nodeConfig.categories as string[]) : []
  const url = typeof nodeConfig.url === "string" ? nodeConfig.url : ""
  const method = typeof nodeConfig.method === "string" ? nodeConfig.method : ""
  const maxResults = nodeConfig.maxResults
  const triggerMode = typeof nodeConfig.triggerMode === "string" ? nodeConfig.triggerMode : ""
  const triggerTime = typeof nodeConfig.triggerTime === "string" ? nodeConfig.triggerTime : ""
  const triggerTimezone = typeof nodeConfig.triggerTimezone === "string" ? nodeConfig.triggerTimezone : ""
  const triggerInterval = nodeConfig.triggerIntervalMinutes

  const rules = Array.isArray(nodeConfig.rules) ? (nodeConfig.rules as Array<Record<string, unknown>>) : []
  const firstRule = rules[0] || {}

  return (
    <div className="mt-2.5 space-y-1.5">
      <input
        className={FIELD_INPUT}
        value={label}
        onChange={(event) => updateNodeConfig({ label: event.target.value })}
        placeholder="Label"
      />

      {integration ? (
        <FluidSelect
          isLight={false}
          value={integration}
          options={[
            { value: "claude", label: "Claude" },
            { value: "openai", label: "OpenAI" },
            { value: "grok", label: "Grok" },
            { value: "gemini", label: "Gemini" },
          ]}
          onChange={(value) => updateNodeConfig({ integration: value })}
          buttonClassName="h-7 border-white/12 bg-white/[0.06] px-2 text-[10px] text-white/88"
        />
      ) : null}

      {prompt ? (
        <textarea
          className={cn(FIELD_INPUT, "min-h-16 resize-y")}
          value={prompt}
          onChange={(event) => updateNodeConfig({ prompt: event.target.value })}
          placeholder="Prompt"
        />
      ) : null}

      {query ? (
        <textarea
          className={cn(FIELD_INPUT, "min-h-12 resize-y")}
          value={query}
          onChange={(event) => updateNodeConfig({ query: event.target.value })}
          placeholder="Search query"
        />
      ) : null}

      {eventName ? (
        <input
          className={FIELD_INPUT}
          value={eventName}
          onChange={(event) => updateNodeConfig({ eventName: event.target.value })}
          placeholder="Event name"
        />
      ) : null}

      {path ? (
        <input
          className={FIELD_INPUT}
          value={path}
          onChange={(event) => updateNodeConfig({ path: event.target.value })}
          placeholder="Path"
        />
      ) : null}

      {intent ? (
        <input
          className={FIELD_INPUT}
          value={intent}
          onChange={(event) => updateNodeConfig({ intent: event.target.value })}
          placeholder="Intent"
        />
      ) : null}

      {method ? (
        <div className="grid grid-cols-[84px_1fr] gap-1.5">
          <FluidSelect
            isLight={false}
            value={method}
            options={[
              { value: "GET", label: "GET" },
              { value: "POST", label: "POST" },
              { value: "PUT", label: "PUT" },
              { value: "PATCH", label: "PATCH" },
              { value: "DELETE", label: "DELETE" },
            ]}
            onChange={(value) => updateNodeConfig({ method: value })}
            buttonClassName="h-7 border-white/12 bg-white/[0.06] px-2 text-[10px] text-white/88"
          />
          <input
            className={FIELD_INPUT}
            value={url}
            onChange={(event) => updateNodeConfig({ url: event.target.value })}
            placeholder="https://api.example.com"
          />
        </div>
      ) : null}

      {typeof maxResults === "number" || typeof maxResults === "string" ? (
        <input
          className={FIELD_INPUT}
          type="number"
          value={String(maxResults ?? "")}
          onChange={(event) => updateNodeConfig({ maxResults: Number(event.target.value) || 5 })}
          placeholder="Max results"
        />
      ) : null}

      {categories.length ? (
        <input
          className={FIELD_INPUT}
          value={categories.join(", ")}
          onChange={(event) =>
            updateNodeConfig({
              categories: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
            })
          }
          placeholder="Category A, Category B"
        />
      ) : null}

      {outputSchema ? (
        <textarea
          className={cn(FIELD_INPUT, "min-h-12 resize-y")}
          value={outputSchema}
          onChange={(event) => updateNodeConfig({ outputSchema: event.target.value })}
          placeholder="Output schema"
        />
      ) : null}

      {messageTemplate ? (
        <textarea
          className={cn(FIELD_INPUT, "min-h-12 resize-y")}
          value={messageTemplate}
          onChange={(event) => updateNodeConfig({ messageTemplate: event.target.value })}
          placeholder="Message template"
        />
      ) : null}

      {expression ? (
        <input
          className={FIELD_INPUT}
          value={expression}
          onChange={(event) => updateNodeConfig({ expression: event.target.value })}
          placeholder="Expression"
        />
      ) : null}

      {field ? (
        <input
          className={FIELD_INPUT}
          value={field}
          onChange={(event) => updateNodeConfig({ field: event.target.value })}
          placeholder="Field"
        />
      ) : null}

      {content ? (
        <textarea
          className={cn(FIELD_INPUT, "min-h-12 resize-y")}
          value={content}
          onChange={(event) => updateNodeConfig({ content: event.target.value })}
          placeholder="Content"
        />
      ) : null}

      {missionId ? (
        <input
          className={FIELD_INPUT}
          value={missionId}
          onChange={(event) => updateNodeConfig({ missionId: event.target.value })}
          placeholder="Mission ID"
        />
      ) : null}

      {triggerMode ? (
        <>
          <FluidSelect
            isLight={false}
            value={triggerMode}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "interval", label: "Interval" },
              { value: "once", label: "Once" },
            ]}
            onChange={(value) => updateNodeConfig({ triggerMode: value })}
            buttonClassName="h-7 border-white/12 bg-white/[0.06] px-2 text-[10px] text-white/88"
          />
          {triggerMode === "interval" ? (
            <input
              className={FIELD_INPUT}
              type="number"
              value={String(triggerInterval ?? 30)}
              onChange={(event) => updateNodeConfig({ triggerIntervalMinutes: Number(event.target.value) || 30 })}
              placeholder="Interval minutes"
            />
          ) : (
            <input
              className={FIELD_INPUT}
              value={triggerTime}
              onChange={(event) => updateNodeConfig({ triggerTime: event.target.value })}
              placeholder="HH:MM"
            />
          )}
          <input
            className={FIELD_INPUT}
            value={triggerTimezone}
            onChange={(event) => updateNodeConfig({ triggerTimezone: event.target.value })}
            placeholder="Timezone"
          />
        </>
      ) : null}

      {rules.length > 0 ? (
        <>
          <input
            className={FIELD_INPUT}
            value={String(firstRule.field || "")}
            onChange={(event) =>
              updateNodeConfig({
                rules: [{ ...firstRule, field: event.target.value, operator: firstRule.operator || "exists" }],
              })
            }
            placeholder="Field / expression"
          />
          <FluidSelect
            isLight={false}
            value={String(firstRule.operator || "exists")}
            options={[
              { value: "exists", label: "Exists" },
              { value: "contains", label: "Contains" },
              { value: "equals", label: "Equals" },
              { value: "not_equals", label: "Not Equals" },
              { value: "greater_than", label: "Greater Than" },
              { value: "less_than", label: "Less Than" },
              { value: "regex", label: "Regex" },
            ]}
            onChange={(value) =>
              updateNodeConfig({
                rules: [{ ...firstRule, field: firstRule.field || "", operator: value }],
              })
            }
            buttonClassName="h-7 border-white/12 bg-white/[0.06] px-2 text-[10px] text-white/88"
          />
          {String(firstRule.operator || "exists") !== "exists" && String(firstRule.operator || "exists") !== "not_exists" ? (
            <input
              className={FIELD_INPUT}
              value={String(firstRule.value || "")}
              onChange={(event) =>
                updateNodeConfig({
                  rules: [{ ...firstRule, field: firstRule.field || "", operator: firstRule.operator || "exists", value: event.target.value }],
                })
              }
              placeholder="Value"
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export const BaseNode = memo(function BaseNode({ id, data, selected }: NodeProps) {
  const { catalogEntry, isRunning, hasError, hasCompleted, label, nodeConfig } = data as MissionNodeData

  const statusRing = isRunning
    ? "ring-2 ring-white/28"
    : hasError
      ? "ring-2 ring-rose-300/55"
      : hasCompleted
        ? "ring-2 ring-emerald-300/55"
        : selected
          ? "ring-2 ring-white/24"
          : ""

  const statusTone = isRunning
    ? "border-white/24 bg-white/[0.08] text-white/82"
    : hasError
      ? "border-rose-300/34 bg-rose-500/14 text-rose-100"
      : hasCompleted
        ? "border-emerald-300/34 bg-emerald-500/14 text-emerald-100"
        : "border-white/12 bg-white/[0.04] text-white/60"

  const statusLabel = isRunning ? "Running" : hasError ? "Error" : hasCompleted ? "Done" : "Idle"

  return (
    <div
      className={cn(
        "relative min-w-[280px] max-w-[360px] rounded-2xl border px-3 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.58)] backdrop-blur-xl transition-all",
        catalogEntry.borderColor,
        "bg-black/58",
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

      <InlineFields nodeId={id} nodeConfig={(nodeConfig || {}) as Record<string, unknown>} />

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
