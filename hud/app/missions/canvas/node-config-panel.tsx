"use client"

import { useCallback } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { MissionNode, ScheduleTriggerNode, WebSearchNode, AiSummarizeNode, AiGenerateNode, HttpRequestNode, ConditionNode } from "@/lib/missions/types"
import { getNodeCatalogEntry } from "@/lib/missions/catalog"
import { FluidSelect } from "@/components/ui/fluid-select"

interface NodeConfigPanelProps {
  node: MissionNode
  onUpdate: (nodeId: string, updates: Partial<MissionNode>) => void
  onClose: () => void
  className?: string
}

export function NodeConfigPanel({ node, onUpdate, onClose, className }: NodeConfigPanelProps) {
  const entry = getNodeCatalogEntry(node.type)
  const update = useCallback((updates: Partial<MissionNode>) => onUpdate(node.id, updates), [node.id, onUpdate])

  return (
    <aside
      className={cn(
        "flex h-full w-80 flex-col border-l border-white/10 bg-gradient-to-b from-slate-950/92 via-slate-950/84 to-black/72 backdrop-blur-xl",
        className,
      )}
    >
      <div className="border-b border-white/10 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", entry?.textColor || "text-white/50")}>
              {entry?.category || node.type}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white/90">{entry?.label || node.type}</div>
            <p className="mt-1 text-[11px] text-white/45">Edit node properties</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-none">
        <ConfigFields node={node} update={update} />
      </div>
    </aside>
  )
}

function ConfigFields({ node, update }: { node: MissionNode; update: (updates: Partial<MissionNode>) => void }) {
  switch (node.type) {
    case "schedule-trigger":
      return <ScheduleTriggerConfig node={node} update={update} />
    case "web-search":
      return <WebSearchConfig node={node} update={update} />
    case "ai-summarize":
    case "ai-generate":
      return <AiConfig node={node} update={update} />
    case "http-request":
      return <HttpRequestConfig node={node} update={update} />
    case "condition":
      return <ConditionConfig node={node} update={update} />
    default:
      return <GenericLabelConfig node={node} update={update} />
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4.5">
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-white/52">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, multiline }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const cls =
    "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs text-white/88 placeholder:text-white/28 outline-none transition-colors focus:border-cyan-300/30 focus:bg-white/[0.06]"
  if (multiline) {
    return (
      <textarea
        className={cn(cls, "min-h-24 resize-y")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    )
  }
  return <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
}

function ScheduleTriggerConfig({ node, update }: { node: ScheduleTriggerNode; update: (u: Partial<MissionNode>) => void }) {
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} placeholder="Schedule Trigger" />
      </Field>
      <Field label="Trigger Mode">
        <FluidSelect
          isLight={false}
          value={node.triggerMode || "daily"}
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "interval", label: "Interval" },
            { value: "once", label: "Once" },
          ]}
          onChange={(v) => update({ triggerMode: v as ScheduleTriggerNode["triggerMode"] } as Partial<MissionNode>)}
        />
      </Field>
      {(node.triggerMode === "daily" || node.triggerMode === "weekly" || node.triggerMode === "once") && (
        <Field label="Time (HH:MM)">
          <TextInput value={node.triggerTime || ""} onChange={(v) => update({ triggerTime: v } as Partial<MissionNode>)} placeholder="09:00" />
        </Field>
      )}
      {node.triggerMode === "interval" && (
        <Field label="Interval (minutes)">
          <TextInput value={String(node.triggerIntervalMinutes || 30)} onChange={(v) => update({ triggerIntervalMinutes: Number(v) || 30 } as Partial<MissionNode>)} placeholder="30" />
        </Field>
      )}
      <Field label="Timezone">
        <TextInput value={node.triggerTimezone || ""} onChange={(v) => update({ triggerTimezone: v } as Partial<MissionNode>)} placeholder="America/New_York" />
      </Field>
    </>
  )
}

function WebSearchConfig({ node, update }: { node: WebSearchNode; update: (u: Partial<MissionNode>) => void }) {
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Search Query">
        <TextInput value={node.query} onChange={(v) => update({ query: v } as Partial<MissionNode>)} multiline placeholder="What to search for..." />
      </Field>
      <Field label="Max Results">
        <TextInput value={String(node.maxResults || 5)} onChange={(v) => update({ maxResults: Number(v) || 5 } as Partial<MissionNode>)} placeholder="5" />
      </Field>
    </>
  )
}

function AiConfig({ node, update }: { node: AiSummarizeNode | AiGenerateNode; update: (u: Partial<MissionNode>) => void }) {
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="AI Model">
        <FluidSelect
          isLight={false}
          value={node.integration || "claude"}
          options={[
            { value: "claude", label: "Claude" },
            { value: "openai", label: "OpenAI" },
            { value: "grok", label: "Grok" },
            { value: "gemini", label: "Gemini" },
          ]}
          onChange={(v) => update({ integration: v as "claude" | "openai" | "grok" | "gemini" } as Partial<MissionNode>)}
        />
      </Field>
      <Field label="Prompt">
        <TextInput value={node.prompt} onChange={(v) => update({ prompt: v } as Partial<MissionNode>)} multiline placeholder="Write your AI prompt here..." />
      </Field>
      {"detailLevel" in node && (
        <Field label="Detail Level">
          <FluidSelect
            isLight={false}
            value={(node as AiSummarizeNode).detailLevel || "standard"}
            options={[
              { value: "concise", label: "Concise" },
              { value: "standard", label: "Standard" },
              { value: "detailed", label: "Detailed" },
            ]}
            onChange={(v) => update({ detailLevel: v as "concise" | "standard" | "detailed" } as Partial<MissionNode>)}
          />
        </Field>
      )}
    </>
  )
}

function HttpRequestConfig({ node, update }: { node: HttpRequestNode; update: (u: Partial<MissionNode>) => void }) {
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Method">
        <FluidSelect
          isLight={false}
          value={node.method || "GET"}
          options={[
            { value: "GET", label: "GET" },
            { value: "POST", label: "POST" },
            { value: "PUT", label: "PUT" },
            { value: "PATCH", label: "PATCH" },
            { value: "DELETE", label: "DELETE" },
          ]}
          onChange={(v) => update({ method: v as HttpRequestNode["method"] } as Partial<MissionNode>)}
        />
      </Field>
      <Field label="URL">
        <TextInput value={node.url} onChange={(v) => update({ url: v } as Partial<MissionNode>)} placeholder="https://api.example.com/endpoint" />
      </Field>
    </>
  )
}

function ConditionConfig({ node, update }: { node: ConditionNode; update: (u: Partial<MissionNode>) => void }) {
  const rule = node.rules?.[0]
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Check Field / Expression">
        <TextInput
          value={rule?.field || ""}
          onChange={(v) =>
            update({
              rules: [{ ...rule, field: v, operator: rule?.operator || "exists" }],
            } as Partial<MissionNode>)
          }
          placeholder="{{$nodes.Step.output.text}}"
        />
      </Field>
      <Field label="Operator">
        <FluidSelect
          isLight={false}
          value={rule?.operator || "exists"}
          options={[
            { value: "exists", label: "Exists" },
            { value: "contains", label: "Contains" },
            { value: "equals", label: "Equals" },
            { value: "not_equals", label: "Not Equals" },
            { value: "greater_than", label: "Greater Than" },
            { value: "less_than", label: "Less Than" },
            { value: "regex", label: "Regex Match" },
          ]}
          onChange={(v) =>
            update({
              rules: [{ ...rule, field: rule?.field || "", operator: v as ConditionNode["rules"][0]["operator"] }],
            } as Partial<MissionNode>)
          }
        />
      </Field>
      {rule?.operator !== "exists" && rule?.operator !== "not_exists" && (
        <Field label="Value">
          <TextInput
            value={rule?.value || ""}
            onChange={(v) =>
              update({
                rules: [{ ...rule, field: rule?.field || "", operator: rule?.operator || "exists", value: v }],
              } as Partial<MissionNode>)
            }
            placeholder="Expected value"
          />
        </Field>
      )}
    </>
  )
}

function GenericLabelConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  return (
    <Field label="Label">
      <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
    </Field>
  )
}
