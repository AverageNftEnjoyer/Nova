/**
 * Mission Execution Engine â€” V.26 DAG-based
 *
 * Executes a Mission by traversing its node graph (DAG) topologically,
 * passing outputs between nodes via ExecutionContext.nodeOutputs.
 * Supports parallel branches, condition routing, and expression-based data passing.
 */

import "server-only"

import type {
  AgentStateEnvelope,
  Mission,
  MissionNode,
  MissionConnection,
  ExecuteMissionInput,
  ExecuteMissionResult,
  ExecutionContext,
  NodeOutput,
  NodeExecutionTrace,
  ScheduleTriggerNode,
} from "../types/index"
import { EXECUTOR_REGISTRY } from "./executors/index"
import { getLocalParts, parseTime } from "./time"
import { acquireMissionExecutionSlot, type MissionExecutionGuardDecision, type MissionExecutionSlot } from "./execution-guard"
import { emitMissionTelemetryEvent } from "../telemetry"
import { validateMissionGraphForVersioning } from "./versioning"
import { resolveTimezone } from "@/lib/shared/timezone"
import { computeRetryDelayMs, shouldRetry } from "../retry-policy"
import { isMissionAgentExecutorEnabled, isMissionAgentGraphEnabled, missionUsesAgentGraph } from "./agent-flags"

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Expression Resolver
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Resolve {{$nodes.Label.output.field}} and {{$vars.name}} expressions.
 */
function buildExprResolver(nodeOutputs: Map<string, NodeOutput>, nodesByLabel: Map<string, MissionNode>, variables: Record<string, string>) {
  return (template: string): string => {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
      const path = expr.trim()

      // {{$vars.varName}}
      if (path.startsWith("$vars.")) {
        const varName = path.slice(6)
        return variables[varName] ?? ""
      }

      // {{$nodes.NodeLabel.output.field}} or {{$nodes.NodeLabel.output.text}}
      if (path.startsWith("$nodes.")) {
        const parts = path.slice(7).split(".")
        const nodeLabel = parts[0]
        const section = parts[1]
        const field = parts.slice(2).join(".")

        const node = nodesByLabel.get(nodeLabel)
        if (!node) return match

        const output = nodeOutputs.get(node.id)
        if (!output) return match

        if (section === "output") {
          if (!field || field === "text") return output.text ?? ""
          // "data" without a sub-field â†’ serialize the whole data object
          if (field === "data") return output.data !== undefined ? JSON.stringify(output.data) : (output.text ?? "")
          if (output.data && typeof output.data === "object") {
            return String(getNestedField(output.data as Record<string, unknown>, field) ?? "")
          }
        }
        return match
      }

      return match
    })
  }
}

const BLOCKED_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"])

function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let curr: unknown = obj
  for (const part of parts) {
    if (!curr || typeof curr !== "object") return undefined
    if (BLOCKED_PROPERTY_NAMES.has(part)) return undefined
    curr = (curr as Record<string, unknown>)[part]
  }
  return curr
}

function buildAgentStateEnvelope(
  mission: Mission,
  runId: string,
  userContextId: string,
  conversationId: string,
  sessionKey: string,
): AgentStateEnvelope {
  const declaredKeys = Array.from(
    new Set(
      mission.nodes
        .filter((node): node is Extract<MissionNode, { type: "agent-state-write" }> => node.type === "agent-state-write")
        .map((node) => String(node.key || "").trim())
        .filter(Boolean),
    ),
  )
  const writePolicies: Record<string, string[]> = {}
  for (const node of mission.nodes) {
    if (node.type !== "agent-supervisor" && node.type !== "agent-worker" && node.type !== "agent-audit") continue
    for (const key of node.writes || []) {
      const normalized = String(key || "").trim()
      if (!normalized) continue
      if (!writePolicies[normalized]) writePolicies[normalized] = []
      const agentId = String(node.agentId || "").trim()
      if (agentId) writePolicies[normalized].push(agentId)
    }
  }
  return {
    stateVersion: "phase0",
    userContextId,
    conversationId,
    sessionKey,
    missionId: mission.id,
    runId,
    keys: {},
    declaredKeys,
    writePolicies,
    auditTrail: [],
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DAG Utilities
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildAdjacencyMap(connections: MissionConnection[]): Map<string, MissionConnection[]> {
  const map = new Map<string, MissionConnection[]>()
  for (const conn of connections) {
    if (!map.has(conn.sourceNodeId)) map.set(conn.sourceNodeId, [])
    map.get(conn.sourceNodeId)!.push(conn)
  }
  return map
}

function buildInDegreeMap(nodes: MissionNode[], connections: MissionConnection[]): Map<string, number> {
  const map = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const conn of connections) {
    map.set(conn.targetNodeId, (map.get(conn.targetNodeId) ?? 0) + 1)
  }
  return map
}

/**
 * Topological sort of nodes reachable from the given start node IDs.
 * Returns nodes in execution order (Kahn's algorithm) plus cycle detection.
 * If cycleDetected is true, cycleNodeLabels lists the nodes stuck in cycles.
 */
function topologicalOrder(
  startIds: string[],
  allNodes: MissionNode[],
  connections: MissionConnection[],
): { nodes: MissionNode[]; cycleDetected: boolean; cycleNodeLabels: string[] } {
  const nodeById = new Map(allNodes.map((n) => [n.id, n]))
  const adjacency = buildAdjacencyMap(connections)

  // Find all nodes reachable from startIds using BFS
  const reachable = new Set<string>(startIds)
  const queue = [...startIds]
  while (queue.length > 0) {
    const id = queue.shift()!
    const outEdges = adjacency.get(id) || []
    for (const edge of outEdges) {
      if (!reachable.has(edge.targetNodeId)) {
        reachable.add(edge.targetNodeId)
        queue.push(edge.targetNodeId)
      }
    }
  }

  const reachableNodes = allNodes.filter((n) => reachable.has(n.id))
  const reachableConnections = connections.filter((c) => reachable.has(c.sourceNodeId) && reachable.has(c.targetNodeId))
  const inDegree = buildInDegreeMap(reachableNodes, reachableConnections)

  // Initialize queue with start nodes (in-degree 0 among reachable)
  const topoQueue: string[] = reachableNodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const result: MissionNode[] = []
  const visited = new Set<string>()

  while (topoQueue.length > 0) {
    const id = topoQueue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodeById.get(id)
    if (node) result.push(node)
    const outEdges = adjacency.get(id) || []
    for (const edge of outEdges) {
      const newDeg = (inDegree.get(edge.targetNodeId) ?? 1) - 1
      inDegree.set(edge.targetNodeId, newDeg)
      if (newDeg === 0 && !visited.has(edge.targetNodeId)) {
        topoQueue.push(edge.targetNodeId)
      }
    }
  }

  // Any reachable nodes not visited could not be processed â€” they are in cycles
  const unvisited = reachableNodes.filter((n) => !visited.has(n.id))
  return {
    nodes: result,
    cycleDetected: unvisited.length > 0,
    cycleNodeLabels: unvisited.map((n) => n.label || n.id),
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Schedule Gate
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function checkScheduleGate(mission: Mission, now: Date): { due: boolean; reason: string; dayStamp: string } {
  const triggerNode = mission.nodes.find((n) => n.type === "schedule-trigger") as ScheduleTriggerNode | undefined
  if (!triggerNode) {
    return { due: true, reason: "No schedule trigger â€” assuming manual/webhook.", dayStamp: "" }
  }

  const timezone = resolveTimezone(triggerNode.triggerTimezone, mission.settings?.timezone)
  const local = getLocalParts(now, timezone)
  if (!local) return { due: false, reason: "Could not determine local time.", dayStamp: "" }

  // Calendar reschedule override: treat as a one-time trigger within a 15-minute window.
  // The override is consumed (cleared) after a successful run by the caller via upsertMission.
  if (mission.scheduledAtOverride) {
    const overrideTime = new Date(mission.scheduledAtOverride)
    if (Number.isNaN(overrideTime.getTime())) {
      // Malformed override â€” fall through to normal schedule
    } else {
      const diffMs = now.getTime() - overrideTime.getTime()
      // Due if we are within a 15-minute window after the override time
      if (diffMs >= 0 && diffMs <= 15 * 60 * 1000) {
        return { due: true, reason: `Calendar override at ${mission.scheduledAtOverride}.`, dayStamp: local.dayStamp }
      }
      if (diffMs < 0) {
        return { due: false, reason: `Calendar override pending â€” ${Math.round(-diffMs / 60000)}m until ${mission.scheduledAtOverride}.`, dayStamp: local.dayStamp }
      }
      // Override window expired â€” fall through to normal schedule
    }
  }

  const mode = triggerNode.triggerMode || "daily"

  if (mode === "interval") {
    const every = Math.max(1, triggerNode.triggerIntervalMinutes || 30)
    const lastRun = mission.lastRunAt ? new Date(mission.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { due: true, reason: "Interval first run.", dayStamp: local.dayStamp }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    return minutesSince >= every
      ? { due: true, reason: `Interval: ${minutesSince.toFixed(1)}m elapsed.`, dayStamp: local.dayStamp }
      : { due: false, reason: `Interval: only ${minutesSince.toFixed(1)}m of ${every}m elapsed.`, dayStamp: local.dayStamp }
  }

  // "once" missions must never re-run after their first execution.
  if (mode === "once") {
    if (mission.lastSentLocalDate) {
      return { due: false, reason: `Already ran once (on ${mission.lastSentLocalDate}).`, dayStamp: local.dayStamp }
    }
    return { due: true, reason: "Once: first run.", dayStamp: local.dayStamp }
  }

  // Check day-lock for daily/weekly â€” don't re-run same day
  if (mode === "daily" || mode === "weekly") {
    if (mission.lastSentLocalDate === local.dayStamp) {
      return { due: false, reason: `Already ran today (${local.dayStamp}).`, dayStamp: local.dayStamp }
    }
  }

  const target = parseTime(triggerNode.triggerTime)
  if (!target) {
    return { due: false, reason: "Invalid schedule trigger time.", dayStamp: local.dayStamp }
  }

  if (mode === "weekly") {
    const days = Array.isArray(triggerNode.triggerDays)
      ? triggerNode.triggerDays.map((day) => String(day || "").trim().toLowerCase()).filter(Boolean)
      : []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { due: false, reason: `Weekly trigger day mismatch (${local.weekday}).`, dayStamp: local.dayStamp }
    }
  }

  const nowMinutes = local.hour * 60 + local.minute
  const targetMinutes = target.hour * 60 + target.minute
  if (nowMinutes < targetMinutes) {
    return { due: false, reason: "Schedule trigger not yet time.", dayStamp: local.dayStamp }
  }

  const lagMinutes = nowMinutes - targetMinutes
  const windowMinutes = Math.max(0, Number(triggerNode.triggerWindowMinutes ?? 10))
  if (lagMinutes > windowMinutes) {
    return {
      due: false,
      reason: `Schedule trigger missed window (${lagMinutes}m lag, ${windowMinutes}m window).`,
      dayStamp: local.dayStamp,
    }
  }

  return { due: true, reason: `Schedule gate passed (${mode}) at ${triggerNode.triggerTime || "unknown"}.`, dayStamp: local.dayStamp }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Global Execution Timeout
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MISSION_MAX_DURATION_MS = Number(process.env.NOVA_MISSION_MAX_DURATION_MS) || 5 * 60 * 1000 // default 5 minutes

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAgentNodeWithRuntimePolicy(
  node: MissionNode,
): node is Extract<MissionNode, { type: "agent-supervisor" | "agent-worker" | "agent-audit" }> {
  return node.type === "agent-supervisor" || node.type === "agent-worker" || node.type === "agent-audit"
}

async function executeNodeWithOptionalTimeout(
  node: MissionNode,
  executor: NonNullable<(typeof EXECUTOR_REGISTRY)[MissionNode["type"]]>,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port?: string }> {
  if (!isAgentNodeWithRuntimePolicy(node) || !node.timeoutMs || node.timeoutMs <= 0) {
    return executor(node, ctx)
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      executor(node, ctx),
      new Promise<NodeOutput & { port?: string }>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            error: `Agent node "${node.label}" timed out after ${node.timeoutMs}ms.`,
            errorCode: "AGENT_NODE_TIMEOUT",
          })
        }, node.timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Public entry point â€” wraps core execution with a global timeout and retry loop.
 *
 * Retry behaviour is driven by MissionSettings:
 *   - retryOnFail:     must be true to enable retries
 *   - retryCount:      number of retries after the initial failure (default 2)
 *   - retryIntervalMs: base delay before first retry; subsequent delays are
 *                      exponentially backed off with Â±10% jitter (default 5 000 ms)
 *
 * Each retry creates a new job_runs row (new missionRunId, incremented attempt).
 * The phase 1 gate: retryCount=2 â†’ up to 3 total attempts, last failure â†’ status=dead.
 */
export async function executeMission(input: ExecuteMissionInput): Promise<ExecuteMissionResult> {
  const attempt = input.attempt ?? 1
  const settings = input.mission.settings

  // â”€â”€ Single-attempt timeout race â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<ExecuteMissionResult>((resolve) => {
    timeoutHandle = setTimeout(
      () =>
        resolve({
          ok: false,
          skipped: false,
          reason: `Mission execution timed out after ${MISSION_MAX_DURATION_MS / 1000}s.`,
          outputs: [],
          nodeTraces: [],
        }),
      MISSION_MAX_DURATION_MS,
    )
  })

  const result = await Promise.race([executeMissionCore(input), timeoutPromise]).then(
    (r) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      return r
    },
    (err: unknown) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      throw err
    },
  )

  // â”€â”€ Retry logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Skip in-process retry when a pre-claimed slot is provided â€” the job ledger's
  // failRun() re-enqueues a new pending run so the execution-tick handles retries.
  if (
    !result.ok &&
    !result.skipped &&
    !input.preClaimedSlot &&
    shouldRetry(settings.retryOnFail, settings.retryCount, attempt)
  ) {
    const delayMs = computeRetryDelayMs(attempt, settings.retryIntervalMs)
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    return executeMission({
      ...input,
      attempt: attempt + 1,
      missionRunId: crypto.randomUUID(),
    })
  }

  return result
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Core Execution Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function executeMissionCore(input: ExecuteMissionInput): Promise<ExecuteMissionResult> {
  const { mission, source } = input
  const now = input.now ?? new Date()
  const runId = input.missionRunId || crypto.randomUUID()
  const startedAtMs = Date.now()
  const nodeTraces: NodeExecutionTrace[] = []
  const outputs: ExecuteMissionResult["outputs"] = []

  const log = (event: string, data?: Record<string, unknown>) => {
    console.info("[MissionEngine]", { event, missionId: mission.id, runId, ...data, ts: new Date().toISOString() })
  }

  const userContextId = String(input.userContextId || input.scope?.userId || input.scope?.user?.id || mission.userId || "").trim()
  const conversationId = String(input.conversationId || input.runKey || `mission:${mission.id}:${runId}`).trim()
  const sessionKey = String(input.sessionKey || `agent:nova:mission:user:${userContextId}:dm:${conversationId}`).trim()
  const hasAgentNodes = missionUsesAgentGraph(mission)
  if (hasAgentNodes && !isMissionAgentGraphEnabled()) {
    return {
      ok: false,
      skipped: false,
      reason: "Agent graph missions are disabled by NOVA_MISSIONS_AGENT_GRAPH_ENABLED.",
      outputs: [],
      nodeTraces: [],
    }
  }
  if (hasAgentNodes && !isMissionAgentExecutorEnabled()) {
    return {
      ok: false,
      skipped: false,
      reason: "Agent executor missions are disabled by NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED.",
      outputs: [],
      nodeTraces: [],
    }
  }
  if (hasAgentNodes && (!userContextId || !conversationId || !sessionKey)) {
    return {
      ok: false,
      skipped: false,
      reason: "Agent missions require userContextId, conversationId, and sessionKey.",
      outputs: [],
      nodeTraces: [],
    }
  }
  const maxAttempts = mission.settings.retryOnFail ? mission.settings.retryCount + 1 : 1
  // When execution-tick pre-claims a slot, skip enqueue+claim â€” use the slot directly.
  const executionSlot: MissionExecutionGuardDecision = input.preClaimedSlot
    ? { ok: true, slot: input.preClaimedSlot as MissionExecutionSlot }
    : await acquireMissionExecutionSlot({ userContextId, missionId: mission.id, missionRunId: runId, maxAttempts, source })
  if (!executionSlot.ok) {
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: { source, reason: executionSlot.reason },
    }).catch(() => {})
    log("execution.blocked.concurrency", { reason: executionSlot.reason, userContextId: userContextId || "unknown" })
    return {
      ok: false,
      skipped: false,
      reason: executionSlot.reason || "Mission execution concurrency guard blocked this run.",
      outputs: [],
      nodeTraces: [],
    }
  }

  try {
  // â”€â”€ Schedule Gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (source === "scheduler") {
    const gate = checkScheduleGate(mission, now)
    if (!gate.due) {
      log("gate.skipped", { reason: gate.reason })
      await emitMissionTelemetryEvent({
        eventType: "mission.run.completed",
        status: "success",
        userContextId,
        missionId: mission.id,
        missionRunId: runId,
        durationMs: Date.now() - startedAtMs,
        metadata: { source, skipped: true, reason: gate.reason },
      }).catch(() => {})
      executionSlot.slot?.reportOutcome(true)
      return { ok: true, skipped: true, reason: gate.reason, outputs: [], nodeTraces: [] }
    }
    log("gate.passed", { reason: gate.reason })
  }

  // â”€â”€ Validate mission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await emitMissionTelemetryEvent({
    eventType: "mission.run.started",
    status: "info",
    userContextId,
    missionId: mission.id,
    missionRunId: runId,
    metadata: { source, attempt: input.attempt ?? 1 },
  }).catch(() => {})

  if (!Array.isArray(mission.nodes) || mission.nodes.length === 0) {
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: { source, reason: "Mission has no nodes." },
    }).catch(() => {})
    executionSlot.slot?.reportOutcome(false, "Mission has no nodes.")
    return { ok: false, skipped: false, reason: "Mission has no nodes.", outputs: [], nodeTraces: [] }
  }
  const graphIssues = validateMissionGraphForVersioning(mission)
  if (graphIssues.length > 0) {
    const graphFailReason = `Mission graph validation failed (${graphIssues.length} issue(s)).`
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: {
        source,
        reason: "Mission graph validation failed before execution.",
        issueCount: graphIssues.length,
        firstIssueCode: graphIssues[0]?.code,
      },
    }).catch(() => {})
    executionSlot.slot?.reportOutcome(false, graphFailReason)
    return {
      ok: false,
      skipped: false,
      reason: graphFailReason,
      outputs: [],
      nodeTraces: [],
    }
  }

  // â”€â”€ Build execution context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const nodesByLabel = new Map(mission.nodes.map((n) => [n.label, n]))
  const nodeOutputs = new Map<string, NodeOutput>()
  const variables: Record<string, string> = {}

  // Initialize from mission variables
  for (const v of mission.variables || []) {
    variables[v.name] = v.value
  }

  const ctx: ExecutionContext = {
    missionId: mission.id,
    missionLabel: mission.label,
    runId,
    runKey: input.runKey,
    attempt: input.attempt ?? 1,
    now,
    runSource: source,
    lastRunAt: mission.lastRunAt,
    mission,
    nodeOutputs,
    variables,
    scope: input.scope,
    userContextId,
    conversationId,
    sessionKey,
    skillSnapshot: input.skillSnapshot,
    resolveExpr: (template: string) => buildExprResolver(nodeOutputs, nodesByLabel, variables)(template),
    onNodeTrace: input.onNodeTrace,
    agentState: hasAgentNodes ? buildAgentStateEnvelope(mission, runId, userContextId, conversationId, sessionKey) : undefined,
  }

  // â”€â”€ Find trigger nodes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const triggerTypes = new Set(["schedule-trigger", "webhook-trigger", "manual-trigger", "event-trigger"])
  const triggerNodes = mission.nodes.filter((n) => triggerTypes.has(n.type))
  const startIds = triggerNodes.length > 0 ? triggerNodes.map((n) => n.id) : [mission.nodes[0].id]

  // â”€â”€ Topological sort + cycle detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { nodes: orderedNodes, cycleDetected, cycleNodeLabels } = topologicalOrder(startIds, mission.nodes, mission.connections)
  const adjacency = buildAdjacencyMap(mission.connections)

  if (cycleDetected) {
    const reason = `Mission graph has cyclic dependencies: ${cycleNodeLabels.join(", ")}`
    log("graph.cycle_detected", { cycleNodes: cycleNodeLabels })
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: { source, reason, cycleNodes: cycleNodeLabels },
    }).catch(() => {})
    executionSlot.slot?.reportOutcome(false, reason)
    return { ok: false, skipped: false, reason, outputs: [], nodeTraces: [] }
  }

  if (orderedNodes.length === 0) {
    const reason = "Mission graph has no reachable executable nodes."
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: { source, reason },
    }).catch(() => {})
    executionSlot.slot?.reportOutcome(false, reason)
    return { ok: false, skipped: false, reason, outputs: [], nodeTraces: [] }
  }

  log("execution.start", { nodeCount: orderedNodes.length, startIds })

  // â”€â”€ Execute each node â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let skipReason = ""
  let hadNodeFailure = false

  for (const node of orderedNodes) {
    if (node.disabled) {
      nodeTraces.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "skipped",
        detail: "Node is disabled.",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      })
      continue
    }

    // Skip nodes pre-marked by condition/switch routing (wrong branch)
    const preMarked = nodeOutputs.get(node.id)
    if (preMarked?.data && typeof preMarked.data === "object" && (preMarked.data as Record<string, unknown>).skipped === true) {
      nodeTraces.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "skipped",
        detail: String((preMarked.data as Record<string, unknown>).reason || "Branch not taken."),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      })
      continue
    }

    const startedAt = new Date().toISOString()
    const traceRunning: NodeExecutionTrace = {
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: "running",
      startedAt,
    }
    if (ctx.onNodeTrace) await ctx.onNodeTrace(traceRunning)

    const executor = EXECUTOR_REGISTRY[node.type]
    if (!executor) {
      hadNodeFailure = true
      const trace: NodeExecutionTrace = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "failed",
        detail: `No executor registered for node type: ${node.type}`,
        errorCode: "NO_EXECUTOR",
        startedAt,
        endedAt: new Date().toISOString(),
      }
      nodeTraces.push(trace)
      if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)
      continue
    }

    const runtimePolicy = isAgentNodeWithRuntimePolicy(node)
      ? {
          maxAttempts: Math.max(1, Number(node.retryPolicy?.maxAttempts || 1)),
          backoffMs: Math.max(0, Number(node.retryPolicy?.backoffMs || 0)),
        }
      : { maxAttempts: 1, backoffMs: 0 }

    let output: NodeOutput & { port?: string } = { ok: false, error: "Node executor was not invoked.", errorCode: "EXECUTOR_UNREACHABLE" }
    let retryCount = 0
    for (let nodeAttempt = 1; nodeAttempt <= runtimePolicy.maxAttempts; nodeAttempt++) {
      try {
        output = await executeNodeWithOptionalTimeout(node, executor, ctx)
      } catch (err) {
        output = { ok: false, error: String(err), errorCode: "EXECUTOR_EXCEPTION" }
      }
      if (output.ok || nodeAttempt >= runtimePolicy.maxAttempts) break
      retryCount += 1
      if (runtimePolicy.backoffMs > 0) {
        await delay(runtimePolicy.backoffMs)
      }
    }

    nodeOutputs.set(node.id, output)

    // â”€â”€ Handle trigger skip (not yet due) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (triggerTypes.has(node.type) && output.ok) {
      const triggered = output.data && typeof output.data === "object" && (output.data as Record<string, unknown>).triggered === false
      const skipped = output.data && typeof output.data === "object" && (output.data as Record<string, unknown>).skipped === true
      if (triggered && skipped) {
        skipReason = output.text || "Not yet due."
        const trace: NodeExecutionTrace = {
          nodeId: node.id,
          nodeType: node.type,
          label: node.label,
          status: "skipped",
          detail: skipReason,
          startedAt,
          endedAt: new Date().toISOString(),
        }
        nodeTraces.push(trace)
        if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)
        await emitMissionTelemetryEvent({
          eventType: "mission.run.completed",
          status: "success",
          userContextId,
          missionId: mission.id,
          missionRunId: runId,
          durationMs: Date.now() - startedAtMs,
          metadata: { source, skipped: true, reason: skipReason, attempt: input.attempt ?? 1 },
        }).catch(() => {})
        executionSlot.slot?.reportOutcome(true)
        return { ok: true, skipped: true, reason: skipReason, outputs: [], nodeTraces }
      }
    }

    const endedAt = new Date().toISOString()

    if (!output.ok) {
      hadNodeFailure = true
      const trace: NodeExecutionTrace = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "failed",
        detail: retryCount > 0
          ? `${output.error || "Node execution failed."} (after ${retryCount + 1} attempts)`
          : output.error || "Node execution failed.",
        errorCode: output.errorCode,
        artifactRef: output.artifactRef,
        retryCount,
        startedAt,
        endedAt,
      }
      nodeTraces.push(trace)
      if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)

      // Route to error port if connected; skip main-port targets so they don't
      // run with an empty/failed upstream. Error-port targets are already in
      // topological order and will execute normally â€” their input is the failed
      // node's output (ok: false) which is already stored in nodeOutputs.
      const allOutgoing = adjacency.get(node.id) || []
      const errorConnections = allOutgoing.filter((c) => c.sourcePort === "error")
      const mainConnections = allOutgoing.filter((c) => c.sourcePort !== "error")
      // Pre-mark main-port targets as skipped so their executors see empty input
      for (const conn of mainConnections) {
        if (!nodeOutputs.has(conn.targetNodeId)) {
          nodeOutputs.set(conn.targetNodeId, {
            ok: true,
            text: "",
            data: { skipped: true, reason: `Upstream node "${node.label}" failed: ${output.error || "unknown error"}` },
          })
        }
      }
      if (errorConnections.length === 0) {
        log("node.failed", { nodeId: node.id, error: output.error, retryOnFailSetting: mission.settings.retryOnFail })
      } else {
        log("node.failed.routed_to_error_port", { nodeId: node.id, errorTargets: errorConnections.map((c) => c.targetNodeId) })
      }
      continue
    }

    // â”€â”€ Condition routing: skip nodes on wrong branch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const resolvedPort = output.port || "main"
    const outgoing = adjacency.get(node.id) || []
    if (outgoing.length > 0 && (node.type === "condition" || node.type === "switch")) {
      // Mark nodes on wrong ports as skipped by removing their in-degree eligibility
      const wrongPortConnections = outgoing.filter((c) => c.sourcePort !== resolvedPort)
      for (const conn of wrongPortConnections) {
        // Add a skip marker for these nodes
        nodeOutputs.set(conn.targetNodeId, { ok: true, text: "", data: { skipped: true, reason: `Branch not taken: ${resolvedPort}` } })
      }
    }

    // â”€â”€ Collect output node results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const outputTypes = new Set(["telegram-output", "discord-output", "email-output", "webhook-output", "slack-output"])
    if (outputTypes.has(node.type)) {
      outputs.push({ ok: output.ok, error: output.error, status: undefined })
    }

    const trace: NodeExecutionTrace = {
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: "completed",
      detail: output.text ? output.text.slice(0, 200) : undefined,
      artifactRef: output.artifactRef,
      retryCount,
      startedAt,
      endedAt,
    }
    nodeTraces.push(trace)
    if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)

    log("node.completed", { nodeId: node.id, type: node.type })
  }

  // â”€â”€ Final mission status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ok = !hadNodeFailure && (outputs.length === 0 || outputs.some((o) => o.ok))
  log("execution.complete", { ok, outputCount: outputs.length, traceCount: nodeTraces.length })
  await emitMissionTelemetryEvent({
    eventType: ok ? "mission.run.completed" : "mission.run.failed",
    status: ok ? "success" : "error",
    userContextId,
    missionId: mission.id,
    missionRunId: runId,
    durationMs: Date.now() - startedAtMs,
    metadata: {
      source,
      outputCount: outputs.length,
      traceCount: nodeTraces.length,
      attempt: input.attempt ?? 1,
    },
  }).catch(() => {})

  executionSlot.slot?.reportOutcome(ok)
  return { ok, skipped: false, outputs, nodeTraces }
  } catch (err) {
    // Unexpected exception: report failure so job ledger transitions to failed/dead
    executionSlot.slot?.reportOutcome(false, err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    await executionSlot.slot?.release()
  }
}

