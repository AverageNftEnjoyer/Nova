"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node as RFNode,
  type Edge,
  type Connection,
  ReactFlowProvider,
  Panel,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { CheckCircle2, Database, Rows4, Save, ShieldAlert, Play } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { Mission, MissionConnection, MissionNode } from "@/lib/missions/types"
import { getNodeCatalogEntry, getPaletteCatalog, PALETTE_CATEGORIES, type NodeCatalogEntry } from "@/lib/missions/catalog"
import {
  buildCommandSpineAgentIds,
  buildProviderSelectorDefaults,
  buildScopedAgentId,
} from "@/lib/missions/workflow/agent-topology"
import { validateMissionGraphForVersioning, type MissionGraphValidationIssue } from "@/lib/missions/workflow/versioning/mission-graph-validation"
import { ACCENT_COLORS, loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { getRuntimeTimezone } from "@/lib/shared/timezone"
import { FluidSelect } from "@/components/ui/fluid-select"
import { BaseNode, type MissionNodeData } from "./nodes/base-node"

type CanvasNodeType = NodeCatalogEntry["type"]

function missionNodesToRFNodes(
  missionNodes: MissionNode[],
  traceStatuses: Record<string, "running" | "completed" | "failed">,
): RFNode<MissionNodeData>[] {
  return missionNodes.map((n) => {
    const entry = getNodeCatalogEntry(n.type)
    if (!entry) return null
    const status = traceStatuses[n.id]
    return {
      id: n.id,
      type: "missionNode",
      position: n.position ?? { x: 200, y: 200 },
      data: {
        nodeConfig: n as unknown as Record<string, unknown>,
        catalogEntry: entry,
        label: n.label,
        isRunning: status === "running",
        hasCompleted: status === "completed",
        hasError: status === "failed",
      },
      selected: false,
    }
  }).filter(Boolean) as RFNode<MissionNodeData>[]
}

function missionConnectionsToRFEdges(connections: MissionConnection[]): Edge[] {
  return connections.map((c) => ({
    id: c.id,
    source: c.sourceNodeId,
    sourceHandle: c.sourcePort,
    target: c.targetNodeId,
    targetHandle: c.targetPort,
    type: "smoothstep",
    animated: true,
    style: { stroke: "hsl(var(--mission-flow-edge) / 0.68)", strokeWidth: 1.7, strokeDasharray: "6 7" },
  }))
}

function rfNodesToMissionNodes(rfNodes: RFNode<MissionNodeData>[], original: MissionNode[]): MissionNode[] {
  const byId = new Map(original.map((n) => [n.id, n]))
  return rfNodes
    .map((rn) => {
      const orig = byId.get(rn.id)
      const nodeConfig = (rn.data?.nodeConfig || {}) as Partial<MissionNode>
      if (!orig) {
        // New node added in canvas — preserve it using nodeConfig as the source
        const base = nodeConfig as MissionNode
        if (!base?.type) return null
        return { ...base, id: rn.id, label: String(nodeConfig.label || rn.data?.label || rn.id), position: rn.position } as MissionNode
      }
      return {
        ...orig,
        ...nodeConfig,
        id: rn.id,
        label: String(nodeConfig.label || rn.data?.label || orig.label),
        position: rn.position,
      } as MissionNode
    })
    .filter(Boolean) as MissionNode[]
}

function rfEdgesToMissionConnections(edges: Edge[]): MissionConnection[] {
  return edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.source,
    sourcePort: e.sourceHandle || "main",
    targetNodeId: e.target,
    targetPort: e.targetHandle || "main",
  }))
}

const NODE_TYPES = { missionNode: BaseNode }

const COUNCIL_ROLES = new Set(["routing-council", "policy-council", "memory-council", "planning-council"])
const DOMAIN_MANAGER_ROLES = new Set(["media-manager", "finance-manager", "productivity-manager", "comms-manager", "system-manager"])

type CommandLaneId = "operator" | "council" | "domain-manager" | "worker" | "audit" | "provider"

const COMMAND_LANES: Array<{ id: CommandLaneId; label: string; y: number }> = [
  { id: "operator", label: "Operator", y: 120 },
  { id: "council", label: "Council", y: 240 },
  { id: "domain-manager", label: "Domain Manager", y: 360 },
  { id: "worker", label: "Worker", y: 480 },
  { id: "audit", label: "Audit", y: 600 },
  { id: "provider", label: "Provider Rail", y: 720 },
]

function getCommandLaneForNode(node: MissionNode): CommandLaneId | null {
  if (node.type === "agent-supervisor") return "operator"
  if (node.type === "agent-audit") return "audit"
  if (node.type === "provider-selector") return "provider"
  if (node.type !== "agent-worker") return null
  if (COUNCIL_ROLES.has(node.role)) return "council"
  if (DOMAIN_MANAGER_ROLES.has(node.role)) return "domain-manager"
  return "worker"
}

function collectAgentStateInspector(mission: Pick<Mission, "nodes">): {
  declaredReads: string[]
  declaredWrites: string[]
  stateReadKeys: string[]
  stateWriteKeys: string[]
  writePolicies: Array<{ key: string; agentIds: string[] }>
  undeclaredReads: string[]
  undeclaredWrites: string[]
} {
  const declaredReadSet = new Set<string>()
  const declaredWriteSet = new Set<string>()
  const writePolicyMap = new Map<string, Set<string>>()

  for (const node of mission.nodes) {
    if (node.type !== "agent-supervisor" && node.type !== "agent-worker" && node.type !== "agent-audit") continue
    for (const key of node.reads || []) {
      const normalized = String(key || "").trim()
      if (normalized) declaredReadSet.add(normalized)
    }
    for (const key of node.writes || []) {
      const normalized = String(key || "").trim()
      if (!normalized) continue
      declaredWriteSet.add(normalized)
      if (!writePolicyMap.has(normalized)) writePolicyMap.set(normalized, new Set<string>())
      const agentId = String(node.agentId || "").trim()
      if (agentId) writePolicyMap.get(normalized)?.add(agentId)
    }
  }

  const stateReadKeys = mission.nodes
    .filter((node): node is Extract<MissionNode, { type: "agent-state-read" }> => node.type === "agent-state-read")
    .map((node) => String(node.key || "").trim())
    .filter(Boolean)
  const stateWriteKeys = mission.nodes
    .filter((node): node is Extract<MissionNode, { type: "agent-state-write" }> => node.type === "agent-state-write")
    .map((node) => String(node.key || "").trim())
    .filter(Boolean)

  const undeclaredReads = stateReadKeys.filter((key) => !declaredReadSet.has(key))
  const undeclaredWrites = stateWriteKeys.filter((key) => !declaredWriteSet.has(key))

  return {
    declaredReads: [...declaredReadSet],
    declaredWrites: [...declaredWriteSet],
    stateReadKeys,
    stateWriteKeys,
    writePolicies: [...writePolicyMap.entries()].map(([key, agentIds]) => ({ key, agentIds: [...agentIds] })),
    undeclaredReads,
    undeclaredWrites,
  }
}

function hexToRgbString(hex: string): string {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex
  const full = normalized.length === 3 ? normalized.split("").map((c) => `${c}${c}`).join("") : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "255, 255, 255"
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `${r}, ${g}, ${b}`
}

function buildDefaultNodeConfig(type: CanvasNodeType, label: string, id: string, position: { x: number; y: number }): Record<string, unknown> {
  const base = { id, type, label, position }
  const providerDefaults = buildProviderSelectorDefaults()

  switch (type) {
    case "schedule-trigger":
      return { ...base, triggerMode: "daily", triggerTime: "09:00", triggerTimezone: getRuntimeTimezone(), triggerDays: ["mon", "wed", "fri"] }
    case "webhook-trigger":
      return { ...base, method: "POST", path: `/missions/webhook/${id}`, authentication: "none", responseMode: "immediate" }
    case "manual-trigger":
      return { ...base }
    case "event-trigger":
      return { ...base, eventName: "nova.message.received", filter: "" }

    case "http-request":
      return { ...base, method: "GET", url: "https://api.example.com", responseFormat: "json" }
    case "web-search":
      return { ...base, query: "latest market updates", provider: "brave", maxResults: 5, includeSources: true, fetchContent: false }
    case "rss-feed":
      return { ...base, url: "https://example.com/feed.xml", maxItems: 10 }
    case "coinbase":
      return { ...base, intent: "report", assets: ["BTC", "ETH"], quoteCurrency: "USD", thresholdPct: 5, cadence: "daily" }
    case "polymarket-price-trigger":
      return {
        ...base,
        tokenId: "",
        marketSlug: "",
        direction: "above",
        threshold: 0.6,
        pollIntervalSeconds: 60,
      }
    case "polymarket-monitor":
      return {
        ...base,
        query: "",
        tagSlug: "",
        range: "1d",
        changeThresholdPct: 5,
        maxMarkets: 6,
        pollIntervalSeconds: 60,
      }
    case "polymarket-data-fetch":
      return {
        ...base,
        queryType: "search",
        query: "",
        slug: "",
        tokenIds: [],
        window: "day",
        limit: 8,
        tagSlug: "",
      }
    case "file-read":
      return { ...base, path: "", format: "text", encoding: "utf8" }
    case "form-input":
      return { ...base, fields: [{ name: "input", label: "Input", type: "text" }] }

    case "ai-summarize":
      return { ...base, prompt: "Summarize the input clearly.", integration: "claude", detailLevel: "standard", model: "" }
    case "ai-classify":
      return { ...base, prompt: "Classify this content.", integration: "claude", categories: ["Important", "Normal"] }
    case "ai-extract":
      return { ...base, prompt: "Extract key entities and values.", integration: "claude", outputSchema: "{}" }
    case "ai-generate":
      return { ...base, prompt: "Generate a polished output.", integration: "claude", detailLevel: "standard", model: "" }
    case "ai-chat":
      return { ...base, integration: "claude", messages: [{ role: "user", content: "Hello" }] }

    case "condition":
      return { ...base, logic: "all", rules: [{ field: "{{$nodes.WebSearch.output.text}}", operator: "contains", value: "crypto" }] }
    case "switch":
      return { ...base, expression: "", cases: [{ value: "A", port: "case_0" }, { value: "B", port: "case_1" }], fallthrough: true }
    case "loop":
      return { ...base, inputExpression: "{{$nodes.Fetch.output.items}}", batchSize: 1, maxIterations: 100 }
    case "merge":
      return { ...base, mode: "wait-all", inputCount: 2 }
    case "split":
      return { ...base, outputCount: 2 }
    case "wait":
      return { ...base, waitMode: "duration", durationMs: 60000 }

    case "set-variables":
      return { ...base, assignments: [{ name: "var1", value: "" }] }
    case "code":
      return { ...base, language: "javascript", code: "return input;" }
    case "format":
      return { ...base, template: "{{input}}", outputFormat: "text" }
    case "filter":
      return { ...base, expression: "", mode: "keep" }
    case "sort":
      return { ...base, field: "", direction: "asc" }
    case "dedupe":
      return { ...base, field: "" }

    case "telegram-output":
      return { ...base, chatIds: [], messageTemplate: "{{input}}", parseMode: "markdown" }
    case "discord-output":
      return { ...base, webhookUrls: [], messageTemplate: "{{input}}" }
    case "email-output":
      return { ...base, recipients: [], subject: "Mission Output", messageTemplate: "{{input}}", format: "text" }
    case "webhook-output":
      return { ...base, url: "https://example.com/webhook", method: "POST", bodyTemplate: "{{input}}" }
    case "slack-output":
      return { ...base, channel: "", messageTemplate: "{{input}}" }

    case "sticky-note":
      return { ...base, content: "Notes..." }
    case "agent-supervisor":
      return {
        ...base,
        agentId: buildScopedAgentId("operator", id),
        role: "operator",
        goal: "",
        reads: [],
        writes: [],
        inputMapping: {},
        outputSchema: "{\"route\":\"string\"}",
        timeoutMs: 120000,
        retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      }
    case "agent-worker":
      return {
        ...base,
        agentId: buildScopedAgentId("worker-agent", id),
        role: "worker-agent",
        domain: "system",
        goal: "",
        reads: [],
        writes: [],
        inputMapping: {},
        outputSchema: "{\"result\":\"string\"}",
        timeoutMs: 120000,
        retryPolicy: { maxAttempts: 2, backoffMs: 1500 },
      }
    case "agent-handoff":
      return { ...base, fromAgentId: "", toAgentId: "", reason: "" }
    case "agent-state-read":
      return { ...base, key: "", required: true }
    case "agent-state-write":
      return { ...base, key: "", valueExpression: "", writeMode: "replace" }
    case "provider-selector":
      return {
        ...base,
        allowedProviders: providerDefaults.allowedProviders,
        defaultProvider: providerDefaults.defaultProvider,
        strategy: "policy",
      }
    case "agent-audit":
      return {
        ...base,
        agentId: buildScopedAgentId("audit-council", id),
        role: "audit-council",
        goal: "",
        requiredChecks: [],
        reads: [],
        writes: [],
        inputMapping: {},
        outputSchema: "{\"audit\":\"string\"}",
        timeoutMs: 120000,
        retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      }
    case "agent-subworkflow":
      return { ...base, missionId: "", waitForCompletion: true, inputMapping: {} }
    default:
      return { ...base }
  }
}

function buildCommandSpineTemplate(
  startX: number,
  idPrefix: string,
): Array<{ key: string; id: string; type: CanvasNodeType; label: string; position: { x: number; y: number }; config: Record<string, unknown> }> {
  const mkId = (suffix: string) => `${idPrefix}-${suffix}`
  const agentIds = buildCommandSpineAgentIds(idPrefix)
  const providerDefaults = buildProviderSelectorDefaults()
  const specs: Array<{ key: string; type: CanvasNodeType; label: string; y: number }> = [
    { key: "trigger", type: "manual-trigger", label: "Manual Trigger", y: 40 },
    { key: "operator", type: "agent-supervisor", label: "Operator", y: 120 },
    { key: "handoff-op-council", type: "agent-handoff", label: "Operator -> Council", y: 180 },
    { key: "council", type: "agent-worker", label: "Routing Council", y: 240 },
    { key: "handoff-council-manager", type: "agent-handoff", label: "Council -> Manager", y: 300 },
    { key: "manager", type: "agent-worker", label: "System Manager", y: 360 },
    { key: "handoff-manager-worker", type: "agent-handoff", label: "Manager -> Worker", y: 420 },
    { key: "worker", type: "agent-worker", label: "Worker Agent", y: 480 },
    { key: "handoff-worker-audit", type: "agent-handoff", label: "Worker -> Audit", y: 540 },
    { key: "provider", type: "provider-selector", label: "Provider Selector", y: 720 },
    { key: "audit", type: "agent-audit", label: "Audit Council", y: 600 },
    { key: "handoff-audit-op", type: "agent-handoff", label: "Audit -> Operator", y: 660 },
    { key: "output", type: "email-output", label: "Send Response", y: 780 },
  ]

  return specs.map((spec, idx) => {
    const id = mkId(spec.key)
    const position = { x: startX + idx * 220, y: spec.y }
    const config = buildDefaultNodeConfig(spec.type, spec.label, id, position)

    if (spec.key === "operator") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          agentId: agentIds.operator,
          role: "operator",
          goal: "Command councils and managers, then compose final response.",
        },
      }
    }
    if (spec.key === "council") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          agentId: agentIds.council,
          role: "routing-council",
          goal: "Classify intent and route to the correct manager.",
        },
      }
    }
    if (spec.key === "manager") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          agentId: agentIds.manager,
          role: "system-manager",
          goal: "Assign execution to the best worker.",
        },
      }
    }
    if (spec.key === "worker") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          agentId: agentIds.worker,
          role: "worker-agent",
          domain: "system",
          goal: "Execute delegated task and return result.",
        },
      }
    }
    if (spec.key === "provider") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          allowedProviders: providerDefaults.allowedProviders,
          defaultProvider: providerDefaults.defaultProvider,
          strategy: "policy",
        },
      }
    }
    if (spec.key === "audit") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          agentId: agentIds.audit,
          role: "audit-council",
          goal: "Verify isolation and policy guardrails.",
          requiredChecks: ["user-context-isolation", "policy-guardrails"],
        },
      }
    }
    if (spec.key === "handoff-op-council") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: { ...config, fromAgentId: agentIds.operator, toAgentId: agentIds.council, reason: "route intent" },
      }
    }
    if (spec.key === "handoff-council-manager") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: { ...config, fromAgentId: agentIds.council, toAgentId: agentIds.manager, reason: "assign manager" },
      }
    }
    if (spec.key === "handoff-manager-worker") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: { ...config, fromAgentId: agentIds.manager, toAgentId: agentIds.worker, reason: "delegate execution" },
      }
    }
    if (spec.key === "handoff-worker-audit") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: { ...config, fromAgentId: agentIds.worker, toAgentId: agentIds.audit, reason: "request audit" },
      }
    }
    if (spec.key === "handoff-audit-op") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: { ...config, fromAgentId: agentIds.audit, toAgentId: agentIds.operator, reason: "final compose" },
      }
    }
    if (spec.key === "output") {
      return {
        key: spec.key,
        id,
        type: spec.type,
        label: spec.label,
        position,
        config: {
          ...config,
          recipients: [],
          subject: "Mission Result",
          messageTemplate: "Mission completed by operator after audit.",
          format: "text",
        },
      }
    }
    return { key: spec.key, id, type: spec.type, label: spec.label, position, config }
  })
}

function CategoryAddMenu({
  categoryLabel,
  entries,
  buttonTone,
  menuTone,
  optionTone,
  onAddNode,
}: {
  categoryLabel: string
  entries: NodeCatalogEntry[]
  buttonTone: string
  menuTone: string
  optionTone: string
  onAddNode: (entry: NodeCatalogEntry) => void
}) {
  const [value, setValue] = useState("")
  const options = useMemo(() => entries.map((entry) => ({ value: entry.type, label: entry.label })), [entries])

  return (
    <div className="w-29.5">
      <FluidSelect
        isLight={false}
        value={value}
        options={options}
        placeholder={categoryLabel}
        onChange={(next) => {
          const selected = entries.find((entry) => entry.type === next)
          if (!selected) return
          onAddNode(selected)
          setValue("")
        }}
        buttonClassName={cn("h-8 px-2 text-[11px]", buttonTone)}
        menuClassName={menuTone}
        optionActiveClassName={optionTone}
      />
    </div>
  )
}

function CanvasToolbar({
  mission,
  onSave,
  onRun,
  onExit,
  onAddNode,
  catalogEntries,
  isSaving,
  isRunning,
  justSaved,
}: {
  mission: Mission
  onSave: () => void
  onRun: () => void
  onExit?: () => void
  onAddNode: (entry: NodeCatalogEntry) => void
  catalogEntries: NodeCatalogEntry[]
  isSaving?: boolean
  isRunning?: boolean
  justSaved?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/12 bg-black/70 px-3 py-2 shadow-[0_18px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl max-w-[calc(100vw-2rem)]">
      {PALETTE_CATEGORIES.map((cat) => (
        <CategoryAddMenu
          key={cat.id}
          categoryLabel={cat.label}
          entries={catalogEntries.filter((entry) => entry.category === cat.id)}
          buttonTone={
            cat.id === "triggers"
              ? "border-amber-300/35 bg-amber-500/16 text-amber-100"
              : cat.id === "data"
                ? "border-cyan-300/35 bg-cyan-500/16 text-cyan-100"
                : cat.id === "ai"
                  ? "border-violet-300/35 bg-violet-500/16 text-violet-100"
                  : cat.id === "logic"
                    ? "border-orange-300/35 bg-orange-500/16 text-orange-100"
                    : cat.id === "transform"
                      ? "border-emerald-300/35 bg-emerald-500/16 text-emerald-100"
                      : "border-pink-300/35 bg-pink-500/16 text-pink-100"
          }
          menuTone={
            cat.id === "triggers"
              ? "!border-amber-300/25 !bg-amber-500/10"
              : cat.id === "data"
                ? "!border-cyan-300/25 !bg-cyan-500/10"
                : cat.id === "ai"
                  ? "!border-violet-300/25 !bg-violet-500/10"
                  : cat.id === "logic"
                    ? "!border-orange-300/25 !bg-orange-500/10"
                    : cat.id === "transform"
                      ? "!border-emerald-300/25 !bg-emerald-500/10"
                      : "!border-pink-300/25 !bg-pink-500/10"
          }
          optionTone={
            cat.id === "triggers"
              ? "!bg-amber-500/22 !text-amber-100"
              : cat.id === "data"
                ? "!bg-cyan-500/22 !text-cyan-100"
                : cat.id === "ai"
                  ? "!bg-violet-500/22 !text-violet-100"
                  : cat.id === "logic"
                    ? "!bg-orange-500/22 !text-orange-100"
                    : cat.id === "transform"
                      ? "!bg-emerald-500/22 !text-emerald-100"
                      : "!bg-pink-500/22 !text-pink-100"
          }
          onAddNode={onAddNode}
        />
      ))}
      <div className="hidden sm:block h-6 w-px bg-white/14" />
      <div className="flex flex-col leading-tight min-w-0">
        <span className="max-w-40 xl:max-w-55 truncate text-sm font-semibold text-white/92">{mission.label}</span>
        <span className="text-[10px] uppercase tracking-widest text-white/42 truncate">{mission.category} | {mission.status}</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          onClick={onSave}
          disabled={isSaving}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-emerald-300/35 bg-emerald-500/18 px-2.5 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/28",
            isSaving && "opacity-50",
          )}
        >
          {justSaved && !isSaving ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{isSaving ? "Saving..." : justSaved ? "Saved" : "Save"}</span>
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-cyan-300/35 bg-cyan-500/18 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/28",
            isRunning && "opacity-50",
          )}
        >
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{isRunning ? "Running..." : "Run"}</span>
        </button>
        {onExit ? (
          <button
            onClick={onExit}
            className="rounded-lg border border-rose-300/35 bg-rose-500/18 px-2.5 py-1.5 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-500/28"
          >
            Exit
          </button>
        ) : null}
      </div>
    </div>
  )
}

interface MissionCanvasProps {
  mission: Mission
  onSave: (mission: Mission) => void | boolean | Promise<void | boolean>
  onRun?: (mission: Mission) => void | Promise<void>
  onExit?: () => void
  traceStatuses?: Record<string, "running" | "completed" | "failed">
  isSaving?: boolean
  isRunning?: boolean
}

function MissionCanvasInner({
  mission,
  onSave,
  onRun,
  onExit,
  traceStatuses = {},
  isSaving,
  isRunning,
}: MissionCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [spotlightRgb, setSpotlightRgb] = useState("255, 255, 255")
  const [spotlightPos, setSpotlightPos] = useState<{ x: number; y: number } | null>(null)
  const saveFlashTimeoutRef = useRef<number | null>(null)

  const initialRFNodes = useMemo(
    () => missionNodesToRFNodes(mission.nodes, traceStatuses),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mission.id],
  )
  const initialRFEdges = useMemo(
    () => missionConnectionsToRFEdges(mission.connections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mission.id],
  )

  const [rfNodes, setRFNodes, onNodesChange] = useNodesState<RFNode<MissionNodeData>>(initialRFNodes)
  const [rfEdges, setRFEdges, onEdgesChange] = useEdgesState(initialRFEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [validationTouched, setValidationTouched] = useState(false)
  const paletteCatalog = useMemo(() => getPaletteCatalog(), [])

  const draftMission = useMemo((): Mission => {
    const updatedNodes = rfNodesToMissionNodes(rfNodes, mission.nodes)
    const updatedConnections = rfEdgesToMissionConnections(rfEdges)
    return { ...mission, nodes: updatedNodes, connections: updatedConnections }
  }, [mission, rfEdges, rfNodes])

  const buildDraftMission = useCallback((): Mission => {
    return { ...draftMission, updatedAt: new Date().toISOString() }
  }, [draftMission])

  const validationIssues = useMemo(() => validateMissionGraphForVersioning(draftMission), [draftMission])
  const laneCountById = useMemo(() => {
    const counts: Record<CommandLaneId, number> = {
      operator: 0,
      council: 0,
      "domain-manager": 0,
      worker: 0,
      audit: 0,
      provider: 0,
    }
    for (const node of draftMission.nodes) {
      const lane = getCommandLaneForNode(node)
      if (lane) counts[lane] += 1
    }
    return counts
  }, [draftMission.nodes])
  const inspector = useMemo(() => collectAgentStateInspector(draftMission), [draftMission])
  const outputBypassEdges = useMemo(() => {
    if (!validationIssues.length) return []
    const badIssueIds = new Set(
      validationIssues
        .filter((issue) => issue.code === "mission.agent.output_source_invalid")
        .map((issue) => issue.path.split(".").at(-1))
        .filter(Boolean) as string[],
    )
    if (!badIssueIds.size) return []
    return draftMission.connections.filter((connection) => badIssueIds.has(connection.id))
  }, [draftMission.connections, validationIssues])

  const nodesWithStatus = useMemo(
    () =>
      rfNodes.map((n) => {
        const status = traceStatuses[n.id]
        return {
          ...n,
          data: {
            ...n.data,
            isRunning: status === "running",
            hasCompleted: status === "completed",
            hasError: status === "failed",
          },
        }
      }),
    [rfNodes, traceStatuses],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: Edge = {
        ...connection,
        id: `conn-${Date.now()}`,
        type: "smoothstep",
        animated: true,
        style: { stroke: "hsl(var(--mission-flow-edge) / 0.68)", strokeWidth: 1.7, strokeDasharray: "6 7" },
      }
      setRFEdges((eds) => addEdge(edge, eds))
    },
    [setRFEdges],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nodeType = event.dataTransfer.getData("application/nova-mission-node-type") as CanvasNodeType
      const nodeLabel = event.dataTransfer.getData("application/nova-mission-node-label")
      if (!nodeType) return

      const wrapper = reactFlowWrapper.current
      if (!wrapper) return

      const bounds = wrapper.getBoundingClientRect()
      const position = {
        x: event.clientX - bounds.left - 130,
        y: event.clientY - bounds.top - 50,
      }

      const newNodeId = `node-${Date.now()}`
      const entry = getNodeCatalogEntry(nodeType)
      if (!entry) return

      const nodeConfig = buildDefaultNodeConfig(nodeType, nodeLabel || entry.label, newNodeId, position)
      const newNode: RFNode<MissionNodeData> = {
        id: newNodeId,
        type: "missionNode",
        position,
        data: {
          nodeConfig,
          catalogEntry: entry,
          label: String(nodeConfig.label || entry.label),
        },
      }
      setRFNodes((nds) => [...nds, newNode])
    },
    [setRFNodes],
  )

  const handleAddNode = useCallback(
    (entry: NodeCatalogEntry) => {
      const id = `node-${Date.now()}`
      const position = { x: 260 + Math.random() * 180, y: 200 + Math.random() * 120 }
      const nodeConfig = buildDefaultNodeConfig(entry.type, entry.label, id, position)
      const newNode: RFNode<MissionNodeData> = {
        id,
        type: "missionNode",
        position,
        data: {
          nodeConfig,
          catalogEntry: entry,
          label: String(nodeConfig.label || entry.label),
        },
      }
      setRFNodes((nds) => [...nds, newNode])
    },
    [setRFNodes],
  )

  const snapSelectedNodeToLane = useCallback((laneId: CommandLaneId) => {
    if (!selectedNodeId) return
    const lane = COMMAND_LANES.find((item) => item.id === laneId)
    if (!lane) return
    setRFNodes((nodes) =>
      nodes.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              position: {
                ...node.position,
                y: lane.y,
              },
            }
          : node,
      ),
    )
  }, [selectedNodeId, setRFNodes])

  const autoArrangeCommandLanes = useCallback(() => {
    const laneBuckets = new Map<CommandLaneId, string[]>()
    for (const lane of COMMAND_LANES) laneBuckets.set(lane.id, [])
    for (const node of draftMission.nodes) {
      const lane = getCommandLaneForNode(node)
      if (!lane) continue
      laneBuckets.get(lane)?.push(node.id)
    }
    const nextPositionById = new Map<string, { x: number; y: number }>()
    for (const lane of COMMAND_LANES) {
      const ids = laneBuckets.get(lane.id) || []
      ids.forEach((id, idx) => {
        nextPositionById.set(id, { x: 220 + idx * 240, y: lane.y })
      })
    }
    setRFNodes((nodes) =>
      nodes.map((node) => {
        const next = nextPositionById.get(node.id)
        if (!next) return node
        return { ...node, position: next }
      }),
    )
  }, [draftMission.nodes, setRFNodes])

  const insertCommandSpineTemplate = useCallback(() => {
    const maxX = rfNodes.reduce((max, node) => Math.max(max, node.position.x), 0)
    const startX = (Number.isFinite(maxX) ? maxX : 0) + 260
    const idPrefix = `spine-${Date.now()}`
    const templateNodes = buildCommandSpineTemplate(startX, idPrefix)
    const newNodes: RFNode<MissionNodeData>[] = templateNodes
      .map((node) => {
        const entry = getNodeCatalogEntry(node.type)
        if (!entry) return null
        return {
          id: node.id,
          type: "missionNode",
          position: node.position,
          data: {
            nodeConfig: node.config,
            catalogEntry: entry,
            label: String(node.config.label || node.label),
          },
        }
      })
      .filter(Boolean) as RFNode<MissionNodeData>[]

    const specsByKey = new Map(templateNodes.map((node) => [node.key, node.id]))
    const edges: Edge[] = [
      { id: `${idPrefix}-c1`, source: specsByKey.get("trigger") || "", sourceHandle: "main", target: specsByKey.get("operator") || "", targetHandle: "main" },
      { id: `${idPrefix}-c2`, source: specsByKey.get("operator") || "", sourceHandle: "main", target: specsByKey.get("handoff-op-council") || "", targetHandle: "main" },
      { id: `${idPrefix}-c3`, source: specsByKey.get("handoff-op-council") || "", sourceHandle: "main", target: specsByKey.get("council") || "", targetHandle: "main" },
      { id: `${idPrefix}-c4`, source: specsByKey.get("council") || "", sourceHandle: "main", target: specsByKey.get("handoff-council-manager") || "", targetHandle: "main" },
      { id: `${idPrefix}-c5`, source: specsByKey.get("handoff-council-manager") || "", sourceHandle: "main", target: specsByKey.get("manager") || "", targetHandle: "main" },
      { id: `${idPrefix}-c6`, source: specsByKey.get("manager") || "", sourceHandle: "main", target: specsByKey.get("handoff-manager-worker") || "", targetHandle: "main" },
      { id: `${idPrefix}-c7`, source: specsByKey.get("handoff-manager-worker") || "", sourceHandle: "main", target: specsByKey.get("worker") || "", targetHandle: "main" },
      { id: `${idPrefix}-c8`, source: specsByKey.get("worker") || "", sourceHandle: "main", target: specsByKey.get("handoff-worker-audit") || "", targetHandle: "main" },
      { id: `${idPrefix}-c9`, source: specsByKey.get("handoff-worker-audit") || "", sourceHandle: "main", target: specsByKey.get("provider") || "", targetHandle: "main" },
      { id: `${idPrefix}-c10`, source: specsByKey.get("provider") || "", sourceHandle: "main", target: specsByKey.get("audit") || "", targetHandle: "main" },
      { id: `${idPrefix}-c11`, source: specsByKey.get("audit") || "", sourceHandle: "main", target: specsByKey.get("handoff-audit-op") || "", targetHandle: "main" },
      { id: `${idPrefix}-c12`, source: specsByKey.get("handoff-audit-op") || "", sourceHandle: "main", target: specsByKey.get("output") || "", targetHandle: "main" },
    ]
      .filter((edge) => edge.source && edge.target)
      .map((edge) => ({
        ...edge,
        type: "smoothstep",
        animated: true,
        style: { stroke: "hsl(var(--mission-flow-edge) / 0.68)", strokeWidth: 1.7, strokeDasharray: "6 7" },
      }))

    setRFNodes((nodes) => [...nodes, ...newNodes])
    setRFEdges((current) => [...current, ...edges])
  }, [rfNodes, setRFEdges, setRFNodes])

  useEffect(() => {
    const syncSpotlightSettings = () => {
      const appSettings = loadUserSettings().app
      const palette = ACCENT_COLORS[appSettings.spotlightColor] || ACCENT_COLORS.violet
      setSpotlightRgb(hexToRgbString(palette.primary))
      setSpotlightEnabled(appSettings.spotlightEnabled ?? true)
    }
    syncSpotlightSettings()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncSpotlightSettings as EventListener)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncSpotlightSettings as EventListener)
    }
  }, [])

  useEffect(() => {
    if (validationTouched && validationIssues.length === 0) {
      setValidationTouched(false)
    }
  }, [validationIssues.length, validationTouched])

  useEffect(() => {
    return () => {
      if (saveFlashTimeoutRef.current) {
        window.clearTimeout(saveFlashTimeoutRef.current)
      }
    }
  }, [])

  const handleSave = useCallback(async () => {
    setValidationTouched(true)
    if (validationIssues.length > 0) {
      setJustSaved(false)
      return
    }
    try {
      const result = await onSave(buildDraftMission())
      if (result === false) {
        setJustSaved(false)
        return
      }
      setJustSaved(true)
      if (saveFlashTimeoutRef.current) {
        window.clearTimeout(saveFlashTimeoutRef.current)
      }
      saveFlashTimeoutRef.current = window.setTimeout(() => {
        setJustSaved(false)
      }, 1500)
    } catch {
      setJustSaved(false)
    }
  }, [buildDraftMission, onSave, validationIssues.length])

  const handleRun = useCallback(async () => {
    setValidationTouched(true)
    if (validationIssues.length > 0) return
    const draftMission = buildDraftMission()
    const saved = await onSave(draftMission)
    if (saved === false) return
    if (onRun) {
      await onRun(draftMission)
    }
  }, [buildDraftMission, onRun, onSave, validationIssues.length])

  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setSpotlightPos({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
  }, [])

  const spotlightStyle = useMemo<CSSProperties>(() => {
    const x = spotlightPos?.x ?? -9999
    const y = spotlightPos?.y ?? -9999
    return {
      opacity: spotlightEnabled && spotlightPos ? 1 : 0,
      background: `radial-gradient(72px circle at ${x}px ${y}px, rgba(${spotlightRgb}, 0.1) 0%, rgba(${spotlightRgb}, 0.045) 40%, transparent 72%)`,
    }
  }, [spotlightEnabled, spotlightPos, spotlightRgb])

  return (
    <div className="mission-canvas-theme flex h-full w-full overflow-hidden">
      <div
        className="relative flex-1 overflow-hidden bg-black"
        ref={reactFlowWrapper}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => setSpotlightPos(null)}
      >
        <div className="pointer-events-none absolute inset-0 z-60 transition-opacity duration-150" style={spotlightStyle} />
        <ReactFlow
          nodes={nodesWithStatus}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onSelectionChange={({ nodes }) => setSelectedNodeId(nodes[0]?.id || null)}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
            style: { stroke: "hsl(var(--mission-flow-edge) / 0.68)", strokeWidth: 1.7, strokeDasharray: "6 7" },
          }}
          proOptions={{ hideAttribution: true }}
          className="bg-transparent"
        >
          <Background id="canvas-grid-dots" variant={BackgroundVariant.Dots} color="hsl(var(--mission-flow-dot) / 0.28)" gap={20} size={1.2} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const entry = (n.data as MissionNodeData)?.catalogEntry
              return entry ? entry.borderColor.replace("border-", "").replace("/40", "") : "#888"
            }}
            className="rounded-lg!"
          />
          <Panel position="top-center">
            <CanvasToolbar
              mission={mission}
              onSave={handleSave}
              onRun={handleRun}
              onExit={onExit}
              onAddNode={handleAddNode}
              catalogEntries={paletteCatalog}
              isSaving={isSaving}
              isRunning={isRunning}
              justSaved={justSaved}
            />
          </Panel>
          <Panel position="top-left">
            <div className="w-72 rounded-xl border border-white/12 bg-black/70 p-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/90">
                  <Rows4 className="h-3.5 w-3.5" />
                  Command Lanes
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={insertCommandSpineTemplate}
                    className="rounded border border-indigo-300/35 bg-indigo-500/12 px-2 py-0.5 text-[10px] font-medium text-indigo-100 hover:bg-indigo-500/22"
                  >
                    Insert Spine
                  </button>
                  <button
                    type="button"
                    onClick={autoArrangeCommandLanes}
                    className="rounded border border-cyan-300/35 bg-cyan-500/12 px-2 py-0.5 text-[10px] font-medium text-cyan-100 hover:bg-cyan-500/22"
                  >
                    Auto-arrange
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {COMMAND_LANES.map((lane) => (
                  <div key={lane.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] text-white/85">{lane.label}</div>
                      <div className="text-[10px] text-white/45">Y = {lane.y}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/65">{laneCountById[lane.id]}</span>
                      <button
                        type="button"
                        onClick={() => snapSelectedNodeToLane(lane.id)}
                        disabled={!selectedNodeId}
                        className="rounded border border-cyan-300/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Snap
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-white/45">
                {selectedNodeId ? `Selected node: ${selectedNodeId}` : "Select a node to snap it into a command lane."}
              </div>
            </div>
          </Panel>
          <Panel position="bottom-right">
            <div className="w-80 rounded-xl border border-white/12 bg-black/70 p-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-100/90">
                <Database className="h-3.5 w-3.5" />
                Agent State Inspector
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="text-white/60">Declared Reads</div>
                  <div className="mt-1 font-medium text-white/90">{inspector.declaredReads.length}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="text-white/60">Declared Writes</div>
                  <div className="mt-1 font-medium text-white/90">{inspector.declaredWrites.length}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="text-white/60">State Reads</div>
                  <div className="mt-1 font-medium text-white/90">{inspector.stateReadKeys.length}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="text-white/60">State Writes</div>
                  <div className="mt-1 font-medium text-white/90">{inspector.stateWriteKeys.length}</div>
                </div>
              </div>
              {inspector.writePolicies.length > 0 && (
                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.1em] text-white/55">Write Policies</div>
                  <div className="max-h-24 space-y-1 overflow-y-auto pr-1 text-[10px]">
                    {inspector.writePolicies.map((policy) => (
                      <div key={policy.key} className="flex items-center justify-between gap-2">
                        <span className="truncate text-white/85">{policy.key}</span>
                        <span className="truncate text-white/55">{policy.agentIds.join(", ") || "none"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(inspector.undeclaredReads.length > 0 || inspector.undeclaredWrites.length > 0) && (
                <div className="mt-2 rounded border border-rose-300/30 bg-rose-500/10 p-2 text-[10px] text-rose-100">
                  <div className="mb-1 font-semibold uppercase tracking-[0.1em]">Contract Gaps</div>
                  {inspector.undeclaredReads.length > 0 && <div>Undeclared reads: {inspector.undeclaredReads.join(", ")}</div>}
                  {inspector.undeclaredWrites.length > 0 && <div>Undeclared writes: {inspector.undeclaredWrites.join(", ")}</div>}
                </div>
              )}
            </div>
          </Panel>
          {(validationTouched || validationIssues.length > 0) && (
            <Panel position="bottom-left">
              <div className="w-96 rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-rose-100 shadow-[0_18px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Validation Blockers ({validationIssues.length})
                </div>
                {validationIssues.length === 0 ? (
                  <div className="text-[11px] text-emerald-100">No blockers. Save/run is allowed.</div>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-y-auto pr-1 text-[11px]">
                    {validationIssues.slice(0, 6).map((issue: MissionGraphValidationIssue, index) => (
                      <div key={`${issue.code}-${index}`} className="rounded border border-rose-300/20 bg-black/25 px-2 py-1">
                        <div className="font-mono text-[10px] text-rose-200/85">{issue.code}</div>
                        <div>{issue.message}</div>
                      </div>
                    ))}
                    {validationIssues.length > 6 && (
                      <div className="text-[10px] text-rose-200/80">+{validationIssues.length - 6} more issue(s)</div>
                    )}
                    {outputBypassEdges.length > 0 && (
                      <div className="rounded border border-rose-300/25 bg-black/25 px-2 py-1 text-[10px]">
                        Output bypass edges: {outputBypassEdges.map((edge) => edge.id).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  )
}

export function MissionCanvas(props: MissionCanvasProps) {
  return (
    <ReactFlowProvider>
      <MissionCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

