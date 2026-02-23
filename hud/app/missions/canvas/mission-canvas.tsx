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
  type Node,
  type Edge,
  type Connection,
  ReactFlowProvider,
  Panel,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { CheckCircle2, Play, Save } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { Mission, MissionConnection, MissionNode, MissionNodeType } from "@/lib/missions/types"
import { getNodeCatalogEntry } from "@/lib/missions/catalog"
import { ACCENT_COLORS, loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { BaseNode, type MissionNodeData } from "./nodes/base-node"
import { NodePalette } from "./node-palette"
import { NodeConfigPanel } from "./node-config-panel"

function missionNodesToRFNodes(
  missionNodes: MissionNode[],
  traceStatuses: Record<string, "running" | "completed" | "failed">,
): Node<MissionNodeData>[] {
  return missionNodes.map((n) => {
    const entry = getNodeCatalogEntry(n.type)
    const status = traceStatuses[n.id]
    return {
      id: n.id,
      type: "missionNode",
      position: n.position,
      data: {
        nodeConfig: n as unknown as Record<string, unknown>,
        catalogEntry: entry!,
        label: n.label,
        isRunning: status === "running",
        hasCompleted: status === "completed",
        hasError: status === "failed",
      },
      selected: false,
    }
  })
}

function missionConnectionsToRFEdges(connections: MissionConnection[]): Edge[] {
  return connections.map((c) => ({
    id: c.id,
    source: c.sourceNodeId,
    sourceHandle: c.sourcePort,
    target: c.targetNodeId,
    targetHandle: c.targetPort,
    type: "smoothstep",
    animated: false,
    style: { stroke: "hsl(var(--mission-flow-edge) / 0.62)", strokeWidth: 1.9 },
  }))
}

function rfNodesToMissionNodes(rfNodes: Node<MissionNodeData>[], original: MissionNode[]): MissionNode[] {
  const byId = new Map(original.map((n) => [n.id, n]))
  return rfNodes
    .map((rn) => {
      const orig = byId.get(rn.id)
      if (!orig) return orig!
      const nodeConfig = (rn.data?.nodeConfig || {}) as Partial<MissionNode>
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
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "139, 92, 246"
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `${r}, ${g}, ${b}`
}

function CanvasToolbar({
  mission,
  onSave,
  onRun,
  isSaving,
  isRunning,
  justSaved,
}: {
  mission: Mission
  onSave: () => void
  onRun: () => void
  isSaving?: boolean
  isRunning?: boolean
  justSaved?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/12 bg-gradient-to-br from-slate-900/86 via-slate-900/78 to-black/72 px-3.5 py-2.5 shadow-[0_18px_42px_rgba(2,6,23,0.45)] backdrop-blur-xl">
      <div className="flex flex-col leading-tight">
        <span className="max-w-[260px] truncate text-sm font-semibold text-white/92">{mission.label}</span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-white/42">{mission.category} | {mission.status}</span>
      </div>
      <div className="ml-3 flex items-center gap-1.5">
        <button
          onClick={onSave}
          disabled={isSaving}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-500/16 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/24",
            isSaving && "opacity-50",
          )}
        >
          {justSaved && !isSaving ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {isSaving ? "Saving..." : justSaved ? "Saved" : "Save"}
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-emerald-300/28 bg-emerald-500/14 px-2.5 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/24",
            isRunning && "opacity-50",
          )}
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? "Running..." : "Run Now"}
        </button>
      </div>
    </div>
  )
}

interface MissionCanvasProps {
  mission: Mission
  onSave: (mission: Mission) => void | boolean | Promise<void | boolean>
  onRun?: () => void | Promise<void>
  traceStatuses?: Record<string, "running" | "completed" | "failed">
  isSaving?: boolean
  isRunning?: boolean
}

function MissionCanvasInner({
  mission,
  onSave,
  onRun,
  traceStatuses = {},
  isSaving,
  isRunning,
}: MissionCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [spotlightRgb, setSpotlightRgb] = useState("139, 92, 246")
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

  const [rfNodes, setRFNodes, onNodesChange] = useNodesState<Node<MissionNodeData>>(initialRFNodes)
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
        style: { stroke: "hsl(var(--mission-flow-edge) / 0.62)", strokeWidth: 1.9 },
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
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 30,
      }

      const newNodeId = `node-${Date.now()}`
      const entry = getNodeCatalogEntry(nodeType)
      if (!entry) return

      const newNode: Node<MissionNodeData> = {
        id: newNodeId,
        type: "missionNode",
        position,
        data: {
          nodeConfig: { id: newNodeId, type: nodeType, label: nodeLabel, position },
          catalogEntry: entry,
          label: nodeLabel,
        },
      }
      setRFNodes((nds) => [...nds, newNode])
    },
    [setRFNodes],
  )

  const handleAddNode = useCallback(
    (type: MissionNodeType, label: string) => {
      const entry = getNodeCatalogEntry(type)
      if (!entry) return
      const id = `node-${Date.now()}`
      const newNode: Node<MissionNodeData> = {
        id,
        type: "missionNode",
        position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: {
          nodeConfig: { id, type, label, position: { x: 200, y: 200 } },
          catalogEntry: entry,
          label,
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
      background: `radial-gradient(170px circle at ${x}px ${y}px, rgba(${spotlightRgb}, 0.14) 0%, rgba(${spotlightRgb}, 0.08) 36%, rgba(${spotlightRgb}, 0.04) 56%, transparent 78%)`,
    }
  }, [spotlightEnabled, spotlightPos, spotlightRgb])

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null
    const rfNode = rfNodes.find((n) => n.id === selectedNodeId)
    if (!rfNode) return null
    return (rfNode.data?.nodeConfig || null) as unknown as MissionNode | null
  }, [rfNodes, selectedNodeId])

  const handleNodeUpdate = useCallback(
    (nodeId: string, updates: Partial<MissionNode>) => {
      setRFNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n
          return {
            ...n,
            data: {
              ...n.data,
              label: (updates.label as string) || n.data.label,
              nodeConfig: { ...n.data.nodeConfig, ...updates },
            },
          }
        }),
      )
    },
    [setRFNodes],
  )

  return (
    <div className="mission-canvas-theme flex h-full w-full overflow-hidden">
      <NodePalette onAddNode={handleAddNode} />

      <div
        className="relative flex-1 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-950 to-black"
        ref={reactFlowWrapper}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => setSpotlightPos(null)}
      >
        <ReactFlow
          nodes={nodesWithStatus}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "hsl(var(--mission-flow-edge) / 0.62)", strokeWidth: 1.9 },
          }}
          proOptions={{ hideAttribution: true }}
          className="bg-transparent"
        >
          <div className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-150" style={spotlightStyle} />
          <Background id="canvas-grid-minor" variant={BackgroundVariant.Lines} color="hsl(var(--mission-flow-dot) / 0.12)" gap={24} size={1} />
          <Background id="canvas-grid-major" variant={BackgroundVariant.Lines} color="hsl(var(--mission-flow-dot) / 0.2)" gap={120} size={1.2} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const entry = (n.data as MissionNodeData)?.catalogEntry
              return entry ? entry.borderColor.replace("border-", "").replace("/40", "") : "#888"
            }}
            className="!rounded-lg"
          />
          <Panel position="top-center">
            <CanvasToolbar
              mission={mission}
              onSave={handleSave}
              onRun={onRun || (() => {})}
              isSaving={isSaving}
              isRunning={isRunning}
              justSaved={justSaved}
            />
          </Panel>
        </ReactFlow>
      </div>

      {selectedNode && (
        <NodeConfigPanel node={selectedNode} onUpdate={handleNodeUpdate} onClose={() => setSelectedNodeId(null)} />
      )}
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
