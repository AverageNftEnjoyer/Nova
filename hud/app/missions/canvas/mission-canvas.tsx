"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as RFNode,
  type Edge,
  type Connection,
  type OnSelectionChangeParams,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ArrowLeft, Check, MousePointerClick, Play, Save } from "lucide-react"

import { Badge, Button, EmptyState, IconButton, StatusDot, Tabs, TabsList, TabsTrigger, toast } from "@/components/ui"
import type { Mission, MissionConnection, MissionNode } from "@/lib/missions/types"
import { getNodeCatalogEntry, type NodeCatalogEntry } from "@/lib/missions/catalog"
import {
  buildCommandSpineAgentIds,
  buildProviderSelectorDefaults,
  buildScopedAgentId,
} from "@/lib/missions/workflow/agent-topology"
import { validateMissionGraphForVersioning } from "@/lib/missions/workflow/versioning/mission-graph-validation"
import { getRuntimeTimezone } from "@/lib/shared/timezone"
import { AGENT_NODE_NOTE } from "./category-tone"
import { NodeConfigPanel } from "./node-config-panel"
import { NodePalette } from "./node-palette"
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
  { id: "domain-manager", label: "Domain manager", y: 360 },
  { id: "worker", label: "Worker", y: 480 },
  { id: "audit", label: "Audit", y: 600 },
  { id: "provider", label: "Provider rail", y: 720 },
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

/** ReactFlow's theme variables mapped to Nova tokens, so the canvas follows light/dark and the accent. */
const FLOW_STYLE = {
  "--xy-background-color": "var(--canvas)",
  "--xy-background-pattern-color": "var(--border-strong)",
  "--xy-edge-stroke": "var(--border-strong)",
  "--xy-edge-stroke-selected": "var(--accent)",
  "--xy-edge-stroke-width": "1.5",
  "--xy-connectionline-stroke": "var(--accent)",
  "--xy-connectionline-stroke-width": "1.5",
  "--xy-handle-background-color": "var(--surface-3)",
  "--xy-handle-border-color": "var(--border-strong)",
  "--xy-minimap-background-color": "var(--surface)",
  "--xy-minimap-mask-background-color": "var(--active)",
  "--xy-minimap-mask-stroke-color": "var(--border-strong)",
  "--xy-minimap-mask-stroke-width": "1",
  "--xy-minimap-node-background-color": "var(--surface-3)",
  "--xy-minimap-node-stroke-color": "var(--border-strong)",
  "--xy-controls-button-background-color": "var(--surface)",
  "--xy-controls-button-background-color-hover": "var(--surface-3)",
  "--xy-controls-button-color": "var(--fg-muted)",
  "--xy-controls-button-color-hover": "var(--fg)",
  "--xy-controls-button-border-color": "var(--border)",
  "--xy-controls-box-shadow": "none",
  "--xy-selection-background-color": "rgba(var(--accent-rgb), 0.08)",
  "--xy-selection-border": "1px solid var(--accent)",
  "--xy-node-border-radius": "6px",
} as CSSProperties

const RUNNING_EDGE_STYLE: CSSProperties = { stroke: "var(--accent)", strokeWidth: 1.75 }

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** Follows the `light`/`dark` class on <html> (the theme source of truth) for ReactFlow's colorMode. */
function useDocumentColorMode(): "light" | "dark" {
  return useSyncExternalStore(
    subscribeToThemeClass,
    () => (document.documentElement.classList.contains("light") ? "light" : "dark"),
    () => "dark",
  )
}

type RightTab = "node" | "checks" | "lanes"

interface MissionCanvasProps {
  mission: Mission
  onSave: (mission: Mission) => void | boolean | Promise<void | boolean>
  onRun?: (mission: Mission) => void | Promise<void>
  onExit?: () => void
  traceStatuses?: Record<string, "running" | "completed" | "failed">
  isSaving?: boolean
  isRunning?: boolean
  /** Extra controls placed in the canvas header before Save/Run (e.g. version history). */
  headerActions?: ReactNode
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono text-xs text-fg tabular-nums">{value}</dd>
    </div>
  )
}

function MissionCanvasInner({
  mission,
  onSave,
  onRun,
  onExit,
  traceStatuses = {},
  isSaving,
  isRunning,
  headerActions,
}: MissionCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const colorMode = useDocumentColorMode()
  const [justSaved, setJustSaved] = useState(false)
  const saveFlashTimeoutRef = useRef<number | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>("node")

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

  const draftMission = useMemo((): Mission => {
    const updatedNodes = rfNodesToMissionNodes(rfNodes, mission.nodes)
    const updatedConnections = rfEdgesToMissionConnections(rfEdges)
    return { ...mission, nodes: updatedNodes, connections: updatedConnections }
  }, [mission, rfEdges, rfNodes])

  const buildDraftMission = useCallback((): Mission => ({ ...draftMission, updatedAt: new Date().toISOString() }), [draftMission])

  const validationIssues = useMemo(() => validateMissionGraphForVersioning(draftMission), [draftMission])
  const laneCountById = useMemo(() => {
    const counts: Record<CommandLaneId, number> = { operator: 0, council: 0, "domain-manager": 0, worker: 0, audit: 0, provider: 0 }
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
        return { ...n, data: { ...n.data, isRunning: status === "running", hasCompleted: status === "completed", hasError: status === "failed" } }
      }),
    [rfNodes, traceStatuses],
  )

  const edgesWithStatus = useMemo(
    () =>
      rfEdges.map((edge) => {
        const live = traceStatuses[edge.source] === "running" || traceStatuses[edge.target] === "running"
        return live ? { ...edge, animated: true, style: RUNNING_EDGE_STYLE } : edge
      }),
    [rfEdges, traceStatuses],
  )

  const selectedNode = useMemo(() => rfNodes.find((node) => node.id === selectedNodeId) || null, [rfNodes, selectedNodeId])

  const onConnect = useCallback(
    (connection: Connection) => {
      setRFEdges((eds) => addEdge({ ...connection, id: `conn-${Date.now()}`, type: "smoothstep" }, eds))
    },
    [setRFEdges],
  )

  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams) => {
    const id = nodes[0]?.id || null
    setSelectedNodeId(id)
    if (id) setRightTab("node")
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const appendNode = useCallback(
    (entry: NodeCatalogEntry, position: { x: number; y: number }, label?: string) => {
      const id = `node-${Date.now()}`
      const nodeConfig = buildDefaultNodeConfig(entry.type, label || entry.label, id, position)
      const newNode: RFNode<MissionNodeData> = {
        id,
        type: "missionNode",
        position,
        data: { nodeConfig, catalogEntry: entry, label: String(nodeConfig.label || entry.label) },
      }
      setRFNodes((nds) => [...nds, newNode])
    },
    [setRFNodes],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nodeType = event.dataTransfer.getData("application/nova-mission-node-type") as CanvasNodeType
      const nodeLabel = event.dataTransfer.getData("application/nova-mission-node-label")
      const entry = nodeType ? getNodeCatalogEntry(nodeType) : undefined
      if (!entry) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      appendNode(entry, { x: point.x - 112, y: point.y - 24 }, nodeLabel)
    },
    [appendNode, screenToFlowPosition],
  )

  const handleAddNode = useCallback(
    (entry: NodeCatalogEntry) => {
      // Chain new nodes to the right of the right-most node; the first one lands in the middle of the view.
      const last = rfNodes.reduce<RFNode<MissionNodeData> | null>((best, node) => (!best || node.position.x > best.position.x ? node : best), null)
      if (last) {
        appendNode(entry, { x: last.position.x + 280, y: last.position.y })
        window.requestAnimationFrame(() => { void fitView({ padding: 0.2, maxZoom: 1 }) })
        return
      }
      const bounds = reactFlowWrapper.current?.getBoundingClientRect()
      const center = bounds
        ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
        : { x: 260, y: 200 }
      appendNode(entry, { x: center.x - 112, y: center.y - 24 })
    },
    [appendNode, fitView, rfNodes, screenToFlowPosition],
  )

  const updateNodeConfig = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      setRFNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== nodeId) return node
          const nextConfig = { ...(node.data.nodeConfig || {}), ...updates }
          return {
            ...node,
            data: { ...node.data, label: typeof nextConfig.label === "string" ? nextConfig.label : node.data.label, nodeConfig: nextConfig },
          }
        }),
      )
    },
    [setRFNodes],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      setRFNodes((nodes) => nodes.filter((node) => node.id !== nodeId))
      setRFEdges((edges) => edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
      setSelectedNodeId(null)
    },
    [setRFEdges, setRFNodes],
  )

  const snapSelectedNodeToLane = useCallback((laneId: CommandLaneId) => {
    if (!selectedNodeId) return
    const lane = COMMAND_LANES.find((item) => item.id === laneId)
    if (!lane) return
    setRFNodes((nodes) => nodes.map((node) => (node.id === selectedNodeId ? { ...node, position: { ...node.position, y: lane.y } } : node)))
  }, [selectedNodeId, setRFNodes])

  const autoArrangeCommandLanes = useCallback(() => {
    const laneBuckets = new Map<CommandLaneId, string[]>()
    for (const lane of COMMAND_LANES) laneBuckets.set(lane.id, [])
    for (const node of draftMission.nodes) {
      const lane = getCommandLaneForNode(node)
      if (lane) laneBuckets.get(lane)?.push(node.id)
    }
    const nextPositionById = new Map<string, { x: number; y: number }>()
    for (const lane of COMMAND_LANES) {
      ;(laneBuckets.get(lane.id) || []).forEach((id, idx) => nextPositionById.set(id, { x: 220 + idx * 240, y: lane.y }))
    }
    setRFNodes((nodes) => nodes.map((node) => {
      const next = nextPositionById.get(node.id)
      return next ? { ...node, position: next } : node
    }))
  }, [draftMission.nodes, setRFNodes])

  const insertCommandSpineTemplate = useCallback(() => {
    const maxX = rfNodes.reduce((max, node) => Math.max(max, node.position.x), 0)
    const startX = (Number.isFinite(maxX) ? maxX : 0) + 260
    const idPrefix = `spine-${Date.now()}`
    const templateNodes = buildCommandSpineTemplate(startX, idPrefix)
    const newNodes = templateNodes
      .map((node) => {
        const entry = getNodeCatalogEntry(node.type)
        if (!entry) return null
        return {
          id: node.id,
          type: "missionNode",
          position: node.position,
          data: { nodeConfig: node.config, catalogEntry: entry, label: String(node.config.label || node.label) },
        }
      })
      .filter(Boolean) as RFNode<MissionNodeData>[]

    const idByKey = new Map(templateNodes.map((node) => [node.key, node.id]))
    const chain = [
      "trigger", "operator", "handoff-op-council", "council", "handoff-council-manager", "manager", "handoff-manager-worker",
      "worker", "handoff-worker-audit", "provider", "audit", "handoff-audit-op", "output",
    ]
    const edges: Edge[] = chain.slice(1).map((key, index) => ({
      id: `${idPrefix}-c${index + 1}`,
      source: idByKey.get(chain[index]) || "",
      sourceHandle: "main",
      target: idByKey.get(key) || "",
      targetHandle: "main",
      type: "smoothstep",
    })).filter((edge) => edge.source && edge.target)

    setRFNodes((nodes) => [...nodes, ...newNodes])
    setRFEdges((current) => [...current, ...edges])
  }, [rfNodes, setRFEdges, setRFNodes])

  useEffect(() => () => {
    if (saveFlashTimeoutRef.current) window.clearTimeout(saveFlashTimeoutRef.current)
  }, [])

  const blockOnIssues = useCallback((): boolean => {
    if (validationIssues.length === 0) return false
    setRightTab("checks")
    toast.error({
      title: `Fix ${validationIssues.length} ${validationIssues.length === 1 ? "issue" : "issues"} first`,
      description: "The Checks tab lists what blocks saving and running.",
    })
    return true
  }, [validationIssues.length])

  const handleSave = useCallback(async () => {
    if (blockOnIssues()) {
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
      if (saveFlashTimeoutRef.current) window.clearTimeout(saveFlashTimeoutRef.current)
      saveFlashTimeoutRef.current = window.setTimeout(() => setJustSaved(false), 1500)
    } catch {
      setJustSaved(false)
    }
  }, [blockOnIssues, buildDraftMission, onSave])

  const handleRun = useCallback(async () => {
    if (blockOnIssues()) return
    const next = buildDraftMission()
    const saved = await onSave(next)
    if (saved === false) return
    if (onRun) await onRun(next)
  }, [blockOnIssues, buildDraftMission, onRun, onSave])

  const hasGaps = inspector.undeclaredReads.length > 0 || inspector.undeclaredWrites.length > 0

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas text-fg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        {onExit ? (
          <IconButton aria-label="Close canvas" size="sm" onClick={onExit}>
            <ArrowLeft />
          </IconButton>
        ) : null}
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-md font-medium text-fg">{mission.label || "Untitled mission"}</h1>
          <Badge tone={mission.status === "active" ? "success" : "neutral"}>{mission.status}</Badge>
          <span className="hidden text-xs text-muted tabular-nums md:inline">
            {rfNodes.length} {rfNodes.length === 1 ? "node" : "nodes"}, {rfEdges.length} {rfEdges.length === 1 ? "connection" : "connections"}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {validationIssues.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setRightTab("checks")} className="text-danger hover:text-danger">
              <StatusDot tone="danger" />
              {validationIssues.length} {validationIssues.length === 1 ? "issue" : "issues"}
            </Button>
          ) : null}
          {headerActions}
          <Button variant="secondary" size="sm" onClick={() => void handleSave()} loading={isSaving}>
            {justSaved && !isSaving ? <Check /> : <Save />}
            {justSaved && !isSaving ? "Saved" : "Save"}
          </Button>
          {onRun ? (
            <Button size="sm" onClick={() => void handleRun()} loading={isRunning} disabled={isSaving}>
              <Play />
              Run
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodePalette onAddNode={handleAddNode} />

        <div className="relative min-w-0 flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodesWithStatus}
            edges={edgesWithStatus}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onSelectionChange={onSelectionChange}
            nodeTypes={NODE_TYPES}
            colorMode={colorMode}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={{ type: "smoothstep" }}
            proOptions={{ hideAttribution: true }}
            style={FLOW_STYLE}
          >
            <Background id="mission-canvas-dots" variant={BackgroundVariant.Dots} gap={20} size={1.5} />
            <Controls showInteractive={false} className="overflow-hidden rounded-md! border! border-border!" />
            <MiniMap pannable zoomable className="hidden overflow-hidden xl:block rounded-md! border! border-border!" />
          </ReactFlow>
          {rfNodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-xs rounded-lg border border-border bg-surface px-5 py-4 text-center">
                <p className="text-sm font-medium text-fg">Start with a trigger</p>
                <p className="mt-1 text-xs text-muted">Pick a trigger from the list on the left, then add the steps it should run and connect them.</p>
              </div>
            </div>
          ) : null}
        </div>

        <aside aria-label="Inspector" className="flex w-72 shrink-0 xl:w-80 flex-col border-l border-border bg-surface">
          <Tabs value={rightTab} onValueChange={(value) => setRightTab(value as RightTab)}>
            <TabsList aria-label="Inspector sections" className="px-4">
              <TabsTrigger value="node">Node</TabsTrigger>
              <TabsTrigger value="checks" count={validationIssues.length}>Checks</TabsTrigger>
              <TabsTrigger value="lanes">Agent lanes</TabsTrigger>
            </TabsList>
          </Tabs>

          {rightTab === "node" ? (
            selectedNode ? (
              <NodeConfigPanel
                key={selectedNode.id}
                nodeId={selectedNode.id}
                nodeConfig={(selectedNode.data.nodeConfig || {}) as Record<string, unknown>}
                catalogEntry={selectedNode.data.catalogEntry}
                onUpdate={updateNodeConfig}
                onDelete={deleteNode}
                onClose={() => setRFNodes((nodes) => nodes.map((node) => (node.selected ? { ...node, selected: false } : node)))}
              />
            ) : (
              <EmptyState
                size="compact"
                icon={<MousePointerClick />}
                title="No node selected"
                description="Select a node on the canvas to edit its settings."
                className="flex-1"
              />
            )
          ) : null}

          {rightTab === "checks" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-fg">Validation</h3>
                {validationIssues.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <StatusDot tone="success" />
                    No blockers. You can save and run.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {validationIssues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`} className="rounded-md border border-border border-l-2 border-l-danger bg-surface-2 px-2.5 py-2">
                        <p className="text-sm text-fg">{issue.message}</p>
                        <p className="mt-0.5 font-mono text-2xs text-faint">{issue.code}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {outputBypassEdges.length > 0 ? (
                  <p className="text-xs text-muted">
                    Connections that skip the audit step: <span className="font-mono">{outputBypassEdges.map((edge) => edge.id).join(", ")}</span>
                  </p>
                ) : null}
              </section>

              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-fg">State contract</h3>
                <p className="text-xs text-muted">Keys agent nodes declare, compared with state read and write nodes.</p>
                <dl className="mt-1 divide-y divide-border-subtle">
                  <StatRow label="Declared reads" value={inspector.declaredReads.length} />
                  <StatRow label="Declared writes" value={inspector.declaredWrites.length} />
                  <StatRow label="State reads" value={inspector.stateReadKeys.length} />
                  <StatRow label="State writes" value={inspector.stateWriteKeys.length} />
                </dl>
                {inspector.writePolicies.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1">
                    <h4 className="text-xs font-medium text-muted">Write policies</h4>
                    {inspector.writePolicies.map((policy) => (
                      <div key={policy.key} className="flex items-center justify-between gap-2 font-mono text-2xs">
                        <span className="truncate text-fg">{policy.key}</span>
                        <span className="truncate text-faint">{policy.agentIds.join(", ") || "none"}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {hasGaps ? (
                  <div className="mt-2 rounded-md border border-warning-muted bg-warning-muted px-2.5 py-2 text-xs text-warning">
                    {inspector.undeclaredReads.length > 0 ? <p>Undeclared reads: <span className="font-mono">{inspector.undeclaredReads.join(", ")}</span></p> : null}
                    {inspector.undeclaredWrites.length > 0 ? <p>Undeclared writes: <span className="font-mono">{inspector.undeclaredWrites.join(", ")}</span></p> : null}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {rightTab === "lanes" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              <p className="text-xs text-muted">{AGENT_NODE_NOTE}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={insertCommandSpineTemplate}>Insert agent template</Button>
                <Button variant="ghost" size="sm" onClick={autoArrangeCommandLanes}>Auto-arrange</Button>
              </div>
              <ul className="divide-y divide-border-subtle rounded-md border border-border">
                {COMMAND_LANES.map((lane) => (
                  <li key={lane.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{lane.label}</p>
                      <p className="font-mono text-2xs text-faint tabular-nums">y {lane.y}</p>
                    </div>
                    <span className="font-mono text-xs text-muted tabular-nums">{laneCountById[lane.id]}</span>
                    <Button variant="ghost" size="xs" onClick={() => snapSelectedNodeToLane(lane.id)} disabled={!selectedNodeId}>
                      Snap
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-faint">
                {selectedNodeId ? <>Snaps <span className="font-mono">{selectedNodeId}</span> to a lane.</> : "Select a node to snap it to a lane."}
              </p>
            </div>
          ) : null}
        </aside>
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
