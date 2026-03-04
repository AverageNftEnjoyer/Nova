"use client"

import { useCallback } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { MissionNode, ScheduleTriggerNode, WebSearchNode, AiSummarizeNode, AiGenerateNode, HttpRequestNode, ConditionNode, EmailOutputNode } from "@/lib/missions/types"
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
        "flex h-full w-80 flex-col border-l border-white/10 bg-linear-to-b from-slate-950/92 via-slate-950/84 to-black/72 backdrop-blur-xl",
        className,
      )}
    >
      <div className="border-b border-white/10 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("text-[9px] font-semibold uppercase tracking-widest", entry?.textColor || "text-white/50")}>
              {entry?.category || node.type}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white">{entry?.label || node.type}</div>
            <p className="mt-0.5 text-[11px] text-white/40">Configure node</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/4 p-1.5 text-white/45 transition-colors hover:bg-white/8 hover:text-white/80"
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
  const nodeType = node.type as string
  switch (nodeType) {
    case "schedule-trigger":
      return <ScheduleTriggerConfig node={node as ScheduleTriggerNode} update={update} />
    case "web-search":
      return <WebSearchConfig node={node as WebSearchNode} update={update} />
    case "ai-summarize":
    case "ai-generate":
      return <AiConfig node={node as AiSummarizeNode | AiGenerateNode} update={update} />
    case "http-request":
      return <HttpRequestConfig node={node as HttpRequestNode} update={update} />
    case "condition":
      return <ConditionConfig node={node as ConditionNode} update={update} />
    case "email-output":
      return <EmailOutputConfig node={node as EmailOutputNode} update={update} />
    case "agent-supervisor":
    case "agent-worker":
    case "agent-audit":
      return <AgentConfig node={node} update={update} />
    case "agent-handoff":
      return <HandoffConfig node={node} update={update} />
    case "agent-state-read":
      return <StateReadConfig node={node} update={update} />
    case "agent-state-write":
      return <StateWriteConfig node={node} update={update} />
    case "provider-selector":
      return <ProviderSelectorConfig node={node} update={update} />
    default:
      return <GenericLabelConfig node={node} update={update} />
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-white/62">{label}</label>
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
    "w-full rounded-xl border border-white/14 bg-white/[0.06] px-3 py-2 text-xs text-white/90 placeholder:text-white/30 outline-none transition-colors focus:border-cyan-300/35 focus:bg-white/[0.09]"
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
        <TextInput value={node.triggerTimezone || ""} onChange={(v) => update({ triggerTimezone: v } as Partial<MissionNode>)} placeholder="IANA timezone (e.g. Asia/Hong_Kong)" />
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

function EmailOutputConfig({ node, update }: { node: EmailOutputNode; update: (u: Partial<MissionNode>) => void }) {
  const recipients = node.recipients ?? []
  const subject = node.subject ?? ""
  const messageTemplate = node.messageTemplate ?? ""
  const format = node.format ?? "text"
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Recipients">
        <TextInput
          value={recipients.join(", ")}
          onChange={(v) => update({ recipients: v.split(",").map((r) => r.trim()).filter(Boolean) } as Partial<MissionNode>)}
          placeholder="you@example.com, team@example.com"
        />
      </Field>
      <Field label="Subject">
        <TextInput value={subject} onChange={(v) => update({ subject: v } as Partial<MissionNode>)} placeholder="Daily Briefing: {{date}}" />
      </Field>
      <Field label="Message Template">
        <TextInput value={messageTemplate} onChange={(v) => update({ messageTemplate: v } as Partial<MissionNode>)} multiline placeholder="{{$nodes.Step.output.text}}" />
      </Field>
      <Field label="Format">
        <FluidSelect
          isLight={false}
          value={format}
          options={[
            { value: "text", label: "Plain Text" },
            { value: "html", label: "HTML" },
          ]}
          onChange={(v) => update({ format: v as "text" | "html" } as Partial<MissionNode>)}
        />
      </Field>
    </>
  )
}

function AgentConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  const reads = Array.isArray((node as unknown as Record<string, unknown>).reads)
    ? ((node as unknown as Record<string, unknown>).reads as unknown[]).map(String)
    : []
  const writes = Array.isArray((node as unknown as Record<string, unknown>).writes)
    ? ((node as unknown as Record<string, unknown>).writes as unknown[]).map(String)
    : []
  const goal = String((node as unknown as Record<string, unknown>).goal || "")
  const agentId = String((node as unknown as Record<string, unknown>).agentId || "")
  const role = String((node as unknown as Record<string, unknown>).role || "")
  const workerRoleOptions = [
    { value: "routing-council", label: "Routing Council" },
    { value: "policy-council", label: "Policy Council" },
    { value: "memory-council", label: "Memory Council" },
    { value: "planning-council", label: "Planning Council" },
    { value: "media-manager", label: "Media Manager" },
    { value: "finance-manager", label: "Finance Manager" },
    { value: "productivity-manager", label: "Productivity Manager" },
    { value: "comms-manager", label: "Comms Manager" },
    { value: "system-manager", label: "System Manager" },
    { value: "worker-agent", label: "Worker Agent" },
  ]

  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Agent ID">
        <TextInput value={agentId} onChange={(v) => update({ agentId: v } as Partial<MissionNode>)} placeholder="operator" />
      </Field>
      {node.type === "agent-worker" && (
        <Field label="Role">
          <FluidSelect
            isLight={false}
            value={role || "worker-agent"}
            options={workerRoleOptions}
            onChange={(v) => update({ role: v } as Partial<MissionNode>)}
          />
        </Field>
      )}
      {node.type === "agent-audit" && (
        <Field label="Role">
          <TextInput value="audit-council" onChange={() => {}} />
        </Field>
      )}
      <Field label="Goal">
        <TextInput
          value={goal}
          onChange={(v) => update({ goal: v } as Partial<MissionNode>)}
          multiline
          placeholder="Describe this role objective and constraints."
        />
      </Field>
      <Field label="Reads (CSV keys)">
        <TextInput
          value={reads.join(", ")}
          onChange={(v) => update({ reads: v.split(",").map((item) => item.trim()).filter(Boolean) } as Partial<MissionNode>)}
          placeholder="brief, context.summary"
        />
      </Field>
      <Field label="Writes (CSV keys)">
        <TextInput
          value={writes.join(", ")}
          onChange={(v) => update({ writes: v.split(",").map((item) => item.trim()).filter(Boolean) } as Partial<MissionNode>)}
          placeholder="analysis, final_report"
        />
      </Field>
    </>
  )
}

function HandoffConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  const fromAgentId = String((node as unknown as Record<string, unknown>).fromAgentId || "")
  const toAgentId = String((node as unknown as Record<string, unknown>).toAgentId || "")
  const reason = String((node as unknown as Record<string, unknown>).reason || "")
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="From Agent ID">
        <TextInput value={fromAgentId} onChange={(v) => update({ fromAgentId: v } as Partial<MissionNode>)} placeholder="operator" />
      </Field>
      <Field label="To Agent ID">
        <TextInput value={toAgentId} onChange={(v) => update({ toAgentId: v } as Partial<MissionNode>)} placeholder="routing-council-1" />
      </Field>
      <Field label="Reason">
        <TextInput value={reason} onChange={(v) => update({ reason: v } as Partial<MissionNode>)} placeholder="Why this handoff happens" />
      </Field>
    </>
  )
}

function StateReadConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  const key = String((node as unknown as Record<string, unknown>).key || "")
  const required = (node as unknown as Record<string, unknown>).required !== false
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="State Key">
        <TextInput
          value={key}
          onChange={(v) => update({ key: v } as Partial<MissionNode>)}
          placeholder="task.plan"
        />
      </Field>
      <Field label="Required">
        <FluidSelect
          isLight={false}
          value={required ? "true" : "false"}
          options={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          onChange={(v) => update({ required: v === "true" } as Partial<MissionNode>)}
        />
      </Field>
    </>
  )
}

function StateWriteConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  const key = String((node as unknown as Record<string, unknown>).key || "")
  const valueExpression = String((node as unknown as Record<string, unknown>).valueExpression || "{{$input}}")
  const writeMode = String((node as unknown as Record<string, unknown>).writeMode || "replace")
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="State Key">
        <TextInput
          value={key}
          onChange={(v) => update({ key: v } as Partial<MissionNode>)}
          placeholder="task.result"
        />
      </Field>
      <Field label="Value Expression">
        <TextInput
          value={valueExpression}
          onChange={(v) => update({ valueExpression: v } as Partial<MissionNode>)}
          placeholder="{{$input}}"
        />
      </Field>
      <Field label="Write Mode">
        <FluidSelect
          isLight={false}
          value={writeMode}
          options={[
            { value: "replace", label: "Replace" },
            { value: "merge", label: "Merge" },
            { value: "append", label: "Append" },
          ]}
          onChange={(v) => update({ writeMode: v as "replace" | "merge" | "append" } as Partial<MissionNode>)}
        />
      </Field>
    </>
  )
}

function ProviderSelectorConfig({ node, update }: { node: MissionNode; update: (u: Partial<MissionNode>) => void }) {
  const allowedProviders = Array.isArray((node as unknown as Record<string, unknown>).allowedProviders)
    ? ((node as unknown as Record<string, unknown>).allowedProviders as unknown[]).map(String).filter(Boolean)
    : []
  const defaultProvider = String((node as unknown as Record<string, unknown>).defaultProvider || "claude")
  const strategy = String((node as unknown as Record<string, unknown>).strategy || "policy")
  return (
    <>
      <Field label="Label">
        <TextInput value={node.label} onChange={(v) => update({ label: v } as Partial<MissionNode>)} />
      </Field>
      <Field label="Allowed Providers (CSV)">
        <TextInput
          value={allowedProviders.join(", ")}
          onChange={(v) => update({ allowedProviders: v.split(",").map((item) => item.trim()).filter(Boolean) } as Partial<MissionNode>)}
          placeholder="claude, openai"
        />
      </Field>
      <Field label="Default Provider">
        <TextInput value={defaultProvider} onChange={(v) => update({ defaultProvider: v } as Partial<MissionNode>)} placeholder="claude" />
      </Field>
      <Field label="Strategy">
        <FluidSelect
          isLight={false}
          value={strategy}
          options={[
            { value: "policy", label: "Policy" },
            { value: "latency", label: "Latency" },
            { value: "cost", label: "Cost" },
            { value: "quality", label: "Quality" },
          ]}
          onChange={(v) => update({ strategy: v as "policy" | "latency" | "cost" | "quality" } as Partial<MissionNode>)}
        />
      </Field>
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
