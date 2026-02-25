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
import { CheckCircle2, Play, Save } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { Mission, MissionConnection, MissionNode, MissionNodeType } from "@/lib/missions/types"
import { getNodeCatalogEntry, PALETTE_CATEGORIES, NODE_CATALOG, type NodeCatalogEntry } from "@/lib/missions/catalog"
import { ACCENT_COLORS, loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { FluidSelect } from "@/components/ui/fluid-select"
import { BaseNode, type MissionNodeData } from "./nodes/base-node"

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

function buildDefaultNodeConfig(type: MissionNodeType, label: string, id: string, position: { x: number; y: number }): Record<string, unknown> {
  const base = { id, type, label, position }

  switch (type) {
    case "schedule-trigger":
      return { ...base, triggerMode: "daily", triggerTime: "09:00", triggerTimezone: "America/New_York", triggerDays: ["mon", "wed", "fri"] }
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

    case "novachat-output":
      return { ...base, messageTemplate: "{{input}}" }
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
    case "sub-workflow":
      return { ...base, missionId: "", waitForCompletion: true }
    default:
      return { ...base }
  }
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
  isSaving,
  isRunning,
  justSaved,
}: {
  mission: Mission
  onSave: () => void
  onRun: () => void
  onExit?: () => void
  onAddNode: (entry: NodeCatalogEntry) => void
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
          entries={NODE_CATALOG.filter((entry) => entry.category === cat.id)}
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

  const buildDraftMission = useCallback((): Mission => {
    const updatedNodes = rfNodesToMissionNodes(rfNodes, mission.nodes)
    const updatedConnections = rfEdgesToMissionConnections(rfEdges)
    return { ...mission, nodes: updatedNodes, connections: updatedConnections, updatedAt: new Date().toISOString() }
  }, [mission, rfEdges, rfNodes])

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
      const nodeType = event.dataTransfer.getData("application/nova-mission-node-type") as MissionNodeType
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
    return () => {
      if (saveFlashTimeoutRef.current) {
        window.clearTimeout(saveFlashTimeoutRef.current)
      }
    }
  }, [])

  const handleSave = useCallback(async () => {
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
  }, [buildDraftMission, onSave])

  const handleRun = useCallback(async () => {
    const draftMission = buildDraftMission()
    const saved = await onSave(draftMission)
    if (saved === false) return
    if (onRun) {
      await onRun(draftMission)
    }
  }, [buildDraftMission, onRun, onSave])

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
              isSaving={isSaving}
              isRunning={isRunning}
              justSaved={justSaved}
            />
          </Panel>
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
