/**
 * Mission Execution Engine — V.26 DAG-based
 *
 * Executes a Mission by traversing its node graph (DAG) topologically,
 * passing outputs between nodes via ExecutionContext.nodeOutputs.
 * Supports parallel branches, condition routing, and expression-based data passing.
 */

import "server-only"

import type {
  Mission,
  MissionNode,
  MissionConnection,
  ExecuteMissionInput,
  ExecuteMissionResult,
  ExecutionContext,
  NodeOutput,
  NodeExecutionTrace,
  ScheduleTriggerNode,
} from "../types"
import { EXECUTOR_REGISTRY } from "./executors/index"
import { getLocalParts } from "./scheduling"
import { acquireMissionExecutionSlot } from "./execution-guard"
import { emitMissionTelemetryEvent } from "../telemetry"
import { validateMissionGraphForVersioning } from "./versioning"

// ─────────────────────────────────────────────────────────────────────────────
// Expression Resolver
// ─────────────────────────────────────────────────────────────────────────────

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
          // "data" without a sub-field → serialize the whole data object
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

// ─────────────────────────────────────────────────────────────────────────────
// DAG Utilities
// ─────────────────────────────────────────────────────────────────────────────

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

  // Any reachable nodes not visited could not be processed — they are in cycles
  const unvisited = reachableNodes.filter((n) => !visited.has(n.id))
  return {
    nodes: result,
    cycleDetected: unvisited.length > 0,
    cycleNodeLabels: unvisited.map((n) => n.label || n.id),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule Gate
// ─────────────────────────────────────────────────────────────────────────────

function checkScheduleGate(mission: Mission, now: Date): { due: boolean; reason: string; dayStamp: string } {
  const triggerNode = mission.nodes.find((n) => n.type === "schedule-trigger") as ScheduleTriggerNode | undefined
  if (!triggerNode) {
    return { due: true, reason: "No schedule trigger — assuming manual/webhook.", dayStamp: "" }
  }

  const timezone = triggerNode.triggerTimezone || mission.settings?.timezone || "America/New_York"
  const local = getLocalParts(now, timezone)
  if (!local) return { due: false, reason: "Could not determine local time.", dayStamp: "" }

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

  // Check day-lock for daily/weekly — don't re-run same day
  if (mode === "daily" || mode === "weekly") {
    if (mission.lastSentLocalDate === local.dayStamp) {
      return { due: false, reason: `Already ran today (${local.dayStamp}).`, dayStamp: local.dayStamp }
    }
  }

  return { due: true, reason: `Schedule gate passed (${mode}).`, dayStamp: local.dayStamp }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Execution Timeout
// ─────────────────────────────────────────────────────────────────────────────

const MISSION_MAX_DURATION_MS = Number(process.env.NOVA_MISSION_MAX_DURATION_MS) || 5 * 60 * 1000 // default 5 minutes

/**
 * Public entry point — wraps the core execution with a global 5-minute timeout.
 * If the mission takes longer, the caller receives a failure result immediately
 * while any in-flight network/AI work completes in the background (slot released).
 */
export function executeMission(input: ExecuteMissionInput): Promise<ExecuteMissionResult> {
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

  return Promise.race([executeMissionCore(input), timeoutPromise]).then(
    (result) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      return result
    },
    (err: unknown) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      throw err
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Execution Function
// ─────────────────────────────────────────────────────────────────────────────

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

  const userContextId = String(input.scope?.userId || input.scope?.user?.id || mission.userId || "").trim()
  const executionSlot = acquireMissionExecutionSlot({
    userContextId,
    missionRunId: runId,
  })
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
  await emitMissionTelemetryEvent({
    eventType: "mission.run.started",
    status: "info",
    userContextId,
    missionId: mission.id,
    missionRunId: runId,
    metadata: { source, attempt: input.attempt ?? 1 },
  }).catch(() => {})

  // ── Schedule Gate ─────────────────────────────────────────────────────────
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
      return { ok: true, skipped: true, reason: gate.reason, outputs: [], nodeTraces: [] }
    }
    log("gate.passed", { reason: gate.reason })
  }

  // ── Validate mission ──────────────────────────────────────────────────────
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
    return { ok: false, skipped: false, reason: "Mission has no nodes.", outputs: [], nodeTraces: [] }
  }
  const graphIssues = validateMissionGraphForVersioning(mission)
  if (graphIssues.length > 0) {
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
    return {
      ok: false,
      skipped: false,
      reason: `Mission graph validation failed (${graphIssues.length} issue(s)).`,
      outputs: [],
      nodeTraces: [],
    }
  }

  // ── Build execution context ───────────────────────────────────────────────
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
    skillSnapshot: input.skillSnapshot,
    resolveExpr: (template: string) => buildExprResolver(nodeOutputs, nodesByLabel, variables)(template),
    onNodeTrace: input.onNodeTrace,
  }

  // ── Find trigger nodes ────────────────────────────────────────────────────
  const triggerTypes = new Set(["schedule-trigger", "webhook-trigger", "manual-trigger", "event-trigger"])
  const triggerNodes = mission.nodes.filter((n) => triggerTypes.has(n.type))
  const startIds = triggerNodes.length > 0 ? triggerNodes.map((n) => n.id) : [mission.nodes[0].id]

  // ── Topological sort + cycle detection ───────────────────────────────────
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
    return { ok: false, skipped: false, reason, outputs: [], nodeTraces: [] }
  }

  if (orderedNodes.length === 0) {
    await emitMissionTelemetryEvent({
      eventType: "mission.run.failed",
      status: "error",
      userContextId,
      missionId: mission.id,
      missionRunId: runId,
      durationMs: Date.now() - startedAtMs,
      metadata: {
        source,
        reason: "Mission graph has no reachable executable nodes.",
      },
    }).catch(() => {})
    return {
      ok: false,
      skipped: false,
      reason: "Mission graph has no reachable executable nodes.",
      outputs: [],
      nodeTraces: [],
    }
  }

  log("execution.start", { nodeCount: orderedNodes.length, startIds })

  // ── Execute each node ─────────────────────────────────────────────────────
  let skipReason = ""

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

    let output: NodeOutput & { port?: string }
    try {
      output = await executor(node, ctx)
    } catch (err) {
      output = { ok: false, error: String(err), errorCode: "EXECUTOR_EXCEPTION" }
    }

    nodeOutputs.set(node.id, output)

    // ── Handle trigger skip (not yet due) ──────────────────────────────────
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
        return { ok: true, skipped: true, reason: skipReason, outputs: [], nodeTraces }
      }
    }

    const endedAt = new Date().toISOString()

    if (!output.ok) {
      const trace: NodeExecutionTrace = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "failed",
        detail: output.error || "Node execution failed.",
        errorCode: output.errorCode,
        artifactRef: output.artifactRef,
        startedAt,
        endedAt,
      }
      nodeTraces.push(trace)
      if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)

      // Route to error port if connected; skip main-port targets so they don't
      // run with an empty/failed upstream. Error-port targets are already in
      // topological order and will execute normally — their input is the failed
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
        log("node.failed", { nodeId: node.id, error: output.error, retryOnFailSetting: mission.settings?.retryOnFail ?? false })
      } else {
        log("node.failed.routed_to_error_port", { nodeId: node.id, errorTargets: errorConnections.map((c) => c.targetNodeId) })
      }
      continue
    }

    // ── Condition routing: skip nodes on wrong branch ──────────────────────
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

    // ── Collect output node results ────────────────────────────────────────
    const outputTypes = new Set(["novachat-output", "telegram-output", "discord-output", "email-output", "webhook-output", "slack-output"])
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
      startedAt,
      endedAt,
    }
    nodeTraces.push(trace)
    if (ctx.onNodeTrace) await ctx.onNodeTrace(trace)

    log("node.completed", { nodeId: node.id, type: node.type })
  }

  // ── Fallback output if no output nodes ran ────────────────────────────────
  if (outputs.length === 0 || outputs.every((output) => !output.ok)) {
    const lastOutputText = [...nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1)
    const fallbackText = String(lastOutputText || "").trim() || `Mission "${mission.label}" completed with upstream errors and no user-ready summary.`
    if (fallbackText) {
      const primaryChannel = String(mission.integration || "novachat").trim() || "novachat"
      const fallbackChannels = outputs.length === 0
        ? [primaryChannel, ...(primaryChannel === "novachat" ? [] : ["novachat"])]
        : ["novachat", ...(primaryChannel === "novachat" ? [] : [primaryChannel])]
      const { dispatchOutput } = await import("../output/dispatch")
      const { humanizeMissionOutputText } = await import("../output/formatters")
      const { applyMissionOutputQualityGuardrails } = await import("../output/quality")

      const humanized = humanizeMissionOutputText(fallbackText, undefined, { includeSources: true, detailLevel: "standard" })
      const { text: guarded } = applyMissionOutputQualityGuardrails(humanized)

      for (const channel of fallbackChannels) {
        const fallbackSchedule: import("@/lib/notifications/store").NotificationSchedule = {
          id: mission.id,
          userId: String(input.scope?.userId || input.scope?.user?.id || ""),
          label: mission.label,
          integration: channel,
          chatIds: mission.chatIds,
          timezone: mission.settings?.timezone || "America/New_York",
          message: "",
          time: "09:00",
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Preserve existing counters so fallback dispatch doesn't inflate metrics
          runCount: mission.runCount ?? 0,
          successCount: mission.successCount ?? 0,
          failureCount: mission.failureCount ?? 0,
        }

        try {
          const fallbackResults = await dispatchOutput(
            channel,
            guarded,
            mission.chatIds,
            fallbackSchedule,
            input.scope,
            {
              missionRunId: runId,
              runKey: input.runKey,
              attempt: input.attempt ?? 1,
              source: source === "scheduler" ? "scheduler" : "trigger",
              nodeId: "fallback-output",
              outputIndex: 0,
            },
          )
          const first = fallbackResults[0] ?? { ok: false, error: "No result" }
          outputs.push({ ok: first.ok, error: first.error })
          log("fallback.output.dispatched", { channel, ok: first.ok })
          if (first.ok) break
        } catch (err) {
          outputs.push({ ok: false, error: String(err) })
          log("fallback.output.failed", { channel, error: String(err) })
        }
      }
    }
  }

  const ok = outputs.length === 0 || outputs.some((o) => o.ok)
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

  return { ok, skipped: false, outputs, nodeTraces }
  } finally {
    executionSlot.slot?.release()
  }
}
