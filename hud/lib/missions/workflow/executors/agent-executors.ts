import type {
  AgentAuditNode,
  AgentHandoffNode,
  AgentStateReadNode,
  AgentStateWriteNode,
  AgentSubworkflowNode,
  AgentSupervisorNode,
  AgentWorkerNode,
  Mission,
  ExecutionContext,
  ExecuteMissionResult,
  NodeOutput,
  ProviderSelectorNode,
} from "../../types/index"
import { loadMissions } from "../../../../../src/runtime/modules/services/missions/persistence/index.js"

interface AgentExecutionEnvelope {
  ok: boolean
  agentId: string
  result: unknown
  error?: string
  telemetry: {
    latencyMs: number
    tokens: number
    provider: string
    toolCalls: number
  }
}

interface AgentExecutionScope {
  userContextId: string
  conversationId: string
  sessionKey: string
}

interface WorkerExecutionProfile {
  domain: "media" | "finance" | "productivity" | "comms" | "system"
  capability: string
  defaultProvider: "openai" | "claude" | "grok" | "gemini"
  estimatedToolCalls: number
}

const DEFAULT_WORKER_PROFILE: WorkerExecutionProfile = {
  domain: "system",
  capability: "generic-execution",
  defaultProvider: "openai",
  estimatedToolCalls: 0,
}

const WORKER_PROFILE_BY_AGENT_ID: Record<string, WorkerExecutionProfile> = {
  "spotify-agent": { domain: "media", capability: "spotify-playback", defaultProvider: "openai", estimatedToolCalls: 2 },
  "voice-agent": { domain: "media", capability: "voice-controls", defaultProvider: "grok", estimatedToolCalls: 1 },
  "tts-agent": { domain: "media", capability: "speech-synthesis", defaultProvider: "openai", estimatedToolCalls: 1 },
  "crypto-agent": { domain: "finance", capability: "crypto-market-read", defaultProvider: "claude", estimatedToolCalls: 2 },
  "coinbase-agent": { domain: "finance", capability: "coinbase-portfolio-read", defaultProvider: "openai", estimatedToolCalls: 2 },
  "market-agent": { domain: "finance", capability: "market-structure-scan", defaultProvider: "gemini", estimatedToolCalls: 2 },
  "calendar-agent": { domain: "productivity", capability: "calendar-ops", defaultProvider: "gemini", estimatedToolCalls: 2 },
  "missions-agent": { domain: "productivity", capability: "mission-orchestration", defaultProvider: "claude", estimatedToolCalls: 2 },
  "reminders-agent": { domain: "productivity", capability: "reminder-ops", defaultProvider: "openai", estimatedToolCalls: 1 },
  "gmail-agent": { domain: "comms", capability: "gmail-summary-reply", defaultProvider: "openai", estimatedToolCalls: 2 },
  "telegram-agent": { domain: "comms", capability: "telegram-send-status", defaultProvider: "grok", estimatedToolCalls: 2 },
  "discord-agent": { domain: "comms", capability: "discord-delivery-status", defaultProvider: "claude", estimatedToolCalls: 2 },
  "web-research-agent": { domain: "system", capability: "web-research-citations", defaultProvider: "openai", estimatedToolCalls: 3 },
  "files-agent": { domain: "system", capability: "workspace-file-ops", defaultProvider: "gemini", estimatedToolCalls: 2 },
  "diagnostics-agent": { domain: "system", capability: "runtime-diagnostics", defaultProvider: "claude", estimatedToolCalls: 1 },
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function normalizeScopeValue(value: unknown): string {
  return String(value || "").trim()
}

function resolveExecutionScope(ctx: ExecutionContext): AgentExecutionScope {
  return {
    userContextId: normalizeScopeValue(ctx.agentState?.userContextId || ctx.userContextId),
    conversationId: normalizeScopeValue(ctx.agentState?.conversationId || ctx.conversationId),
    sessionKey: normalizeScopeValue(ctx.agentState?.sessionKey || ctx.sessionKey),
  }
}

function inferDomainFromRole(role: string): WorkerExecutionProfile["domain"] {
  if (role === "media-manager") return "media"
  if (role === "finance-manager") return "finance"
  if (role === "productivity-manager") return "productivity"
  if (role === "comms-manager") return "comms"
  return "system"
}

function resolveWorkerProfile(node: AgentWorkerNode): WorkerExecutionProfile {
  const byId = WORKER_PROFILE_BY_AGENT_ID[normalizeScopeValue(node.agentId)]
  if (byId) return byId
  const role = normalizeScopeValue(node.role)
  const inferredDomain = normalizeScopeValue(node.domain) || inferDomainFromRole(role)
  const domain = inferredDomain === "media" || inferredDomain === "finance" || inferredDomain === "productivity" || inferredDomain === "comms"
    ? inferredDomain
    : "system"
  const defaultProviderByDomain: Record<WorkerExecutionProfile["domain"], WorkerExecutionProfile["defaultProvider"]> = {
    media: "openai",
    finance: "claude",
    productivity: "gemini",
    comms: "openai",
    system: "openai",
  }
  return {
    domain,
    capability: role || DEFAULT_WORKER_PROFILE.capability,
    defaultProvider: defaultProviderByDomain[domain],
    estimatedToolCalls: DEFAULT_WORKER_PROFILE.estimatedToolCalls,
  }
}

function resolveLatestProviderSelection(ctx: ExecutionContext): { provider: string; strategy: string; allowedProviders: string[] } | null {
  const outputs = [...ctx.nodeOutputs.values()].reverse()
  for (const output of outputs) {
    if (!output?.ok || !output.data || typeof output.data !== "object") continue
    const data = output.data as Record<string, unknown>
    const envelope = data.envelope
    if (!envelope || typeof envelope !== "object") continue
    const envelopeAgentId = normalizeScopeValue((envelope as Record<string, unknown>).agentId)
    if (envelopeAgentId !== "provider-selector") continue
    const provider = normalizeScopeValue(data.provider)
    const strategy = normalizeScopeValue(data.strategy)
    const allowedProviders = Array.isArray(data.allowedProviders)
      ? data.allowedProviders.map((value) => normalizeScopeValue(value)).filter(Boolean)
      : []
    if (!provider || !strategy) continue
    return { provider, strategy, allowedProviders }
  }
  return null
}

function buildAgentEnvelope(
  agentId: string,
  result: unknown,
  options?: {
    ok?: boolean
    error?: string
    telemetry?: Partial<AgentExecutionEnvelope["telemetry"]>
  },
): AgentExecutionEnvelope {
  const telemetry = options?.telemetry || {}
  return {
    ok: options?.ok !== false,
    agentId,
    result,
    error: options?.error,
    telemetry: {
      latencyMs: toNumber(telemetry.latencyMs, 0),
      tokens: toNumber(telemetry.tokens, 0),
      provider: normalizeScopeValue(telemetry.provider) || "internal",
      toolCalls: toNumber(telemetry.toolCalls, 0),
    },
  }
}

function ensureAgentState(ctx: ExecutionContext): NonNullable<ExecutionContext["agentState"]> {
  if (!ctx.agentState) {
    throw new Error("Agent state envelope is missing from execution context.")
  }
  return ctx.agentState
}

function getActiveAgentId(ctx: ExecutionContext): string | undefined {
  const last = [...ctx.nodeOutputs.values()].at(-1)
  if (!last?.data || typeof last.data !== "object") return undefined
  return String((last.data as Record<string, unknown>).activeAgentId || "").trim() || undefined
}

function getLastAgentEnvelope(ctx: ExecutionContext): AgentExecutionEnvelope | null {
  const last = [...ctx.nodeOutputs.values()].at(-1)
  if (!last?.data || typeof last.data !== "object") return null
  const envelope = (last.data as Record<string, unknown>).envelope
  if (!envelope || typeof envelope !== "object") return null
  const candidate = envelope as Record<string, unknown>
  if (
    typeof candidate.ok !== "boolean"
    || typeof candidate.agentId !== "string"
    || !candidate.telemetry
    || typeof candidate.telemetry !== "object"
  ) {
    return null
  }
  return envelope as AgentExecutionEnvelope
}

function hasDeclaredStateKey(state: NonNullable<ExecutionContext["agentState"]>, key: string): boolean {
  return state.declaredKeys.includes(key)
}

function isWriterAllowed(
  state: NonNullable<ExecutionContext["agentState"]>,
  key: string,
  agentId: string,
): boolean {
  const allowed = state.writePolicies[key] || []
  return allowed.includes(agentId)
}

function collectDeterministicSupervisorMerge(
  node: AgentSupervisorNode,
  ctx: ExecutionContext,
): Array<{ sourceNodeId: string; sourceLabel: string; ok: boolean; text?: string; data?: unknown }> {
  const mission = ctx.mission as Mission | undefined
  if (!mission) return []
  const incoming = mission.connections
    .filter((connection) => connection.targetNodeId === node.id)
    .map((connection) => connection.sourceNodeId)
  if (incoming.length <= 1) return []
  const uniqueIncoming = [...new Set(incoming)].sort((a, b) => a.localeCompare(b))
  const nodeById = new Map(mission.nodes.map((missionNode) => [missionNode.id, missionNode]))
  return uniqueIncoming.map((sourceNodeId) => {
    const sourceNode = nodeById.get(sourceNodeId)
    const output = ctx.nodeOutputs.get(sourceNodeId)
    return {
      sourceNodeId,
      sourceLabel: String(sourceNode?.label || sourceNodeId),
      ok: Boolean(output?.ok),
      text: output?.text,
      data: output?.data,
    }
  })
}

export async function executeAgentSupervisor(
  node: AgentSupervisorNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const state = ensureAgentState(ctx)
  const scope = resolveExecutionScope(ctx)
  const mergedInputs = collectDeterministicSupervisorMerge(node, ctx)
  const hasMergedInputs = mergedInputs.length > 0
  return {
    ok: true,
    text: hasMergedInputs
      ? `Operator ${node.agentId} merged ${mergedInputs.length} upstream branch outputs.`
      : `Operator ${node.agentId} activated.`,
    data: {
      activeAgentId: node.agentId,
      role: node.role,
      goal: node.goal,
      userContextId: scope.userContextId || state.userContextId,
      conversationId: scope.conversationId || state.conversationId,
      sessionKey: scope.sessionKey || state.sessionKey,
      mergedInputs,
      envelope: buildAgentEnvelope(node.agentId, {
        role: node.role,
        goal: node.goal,
        mergedInputs,
      }),
    },
  }
}

export async function executeAgentWorker(
  node: AgentWorkerNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const startedAt = Date.now()
  const scope = resolveExecutionScope(ctx)
  const profile = resolveWorkerProfile(node)
  const providerSelection = resolveLatestProviderSelection(ctx)
  const provider = providerSelection?.provider || profile.defaultProvider
  const providerSource = providerSelection ? "provider-selector" : "worker-profile-default"
  const strategy = providerSelection?.strategy || "default"
  const allowedProviders = providerSelection?.allowedProviders || [provider]
  const latencyMs = Math.max(0, Date.now() - startedAt)
  return {
    ok: true,
    text: `${node.role} ${node.agentId} executed via ${provider}.`,
    data: {
      activeAgentId: node.agentId,
      role: node.role,
      domain: node.domain || profile.domain,
      goal: node.goal,
      capability: profile.capability,
      provider,
      providerSource,
      strategy,
      allowedProviders,
      userContextId: scope.userContextId,
      conversationId: scope.conversationId,
      sessionKey: scope.sessionKey,
      envelope: buildAgentEnvelope(
        node.agentId,
        {
          role: node.role,
          domain: node.domain || profile.domain,
          goal: node.goal,
          capability: profile.capability,
          provider,
          providerSource,
          strategy,
          allowedProviders,
        },
        {
          telemetry: {
            provider,
            toolCalls: profile.estimatedToolCalls,
            latencyMs,
            tokens: 0,
          },
        },
      ),
    },
  }
}

export async function executeAgentHandoff(
  node: AgentHandoffNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const scope = resolveExecutionScope(ctx)
  const envelope = getLastAgentEnvelope(ctx)
  if (!envelope) {
    return {
      ok: false,
      error: "Handoff requires a normalized agent envelope from the previous hop.",
      errorCode: "AGENT_HANDOFF_PAYLOAD_INVALID",
    }
  }
  const activeAgentId = getActiveAgentId(ctx)
  if (activeAgentId && activeAgentId !== node.fromAgentId) {
    return {
      ok: false,
      error: `Invalid handoff source. Expected ${node.fromAgentId}, got ${activeAgentId}.`,
      errorCode: "AGENT_HANDOFF_SOURCE_MISMATCH",
    }
  }
  if (envelope.agentId !== node.fromAgentId) {
    return {
      ok: false,
      error: `Handoff envelope agent mismatch. Expected ${node.fromAgentId}, got ${envelope.agentId}.`,
      errorCode: "AGENT_HANDOFF_ENVELOPE_MISMATCH",
    }
  }
  return {
    ok: true,
    text: `Handoff ${node.fromAgentId} -> ${node.toAgentId}.`,
    data: {
      activeAgentId: node.toAgentId,
      fromAgentId: node.fromAgentId,
      toAgentId: node.toAgentId,
      reason: node.reason,
      userContextId: scope.userContextId,
      conversationId: scope.conversationId,
      sessionKey: scope.sessionKey,
      envelope: buildAgentEnvelope(node.toAgentId, {
        fromAgentId: node.fromAgentId,
        toAgentId: node.toAgentId,
        reason: node.reason,
        upstream: envelope.result,
      }, {
        telemetry: {
          provider: normalizeScopeValue(envelope.telemetry?.provider) || "internal",
          latencyMs: toNumber(envelope.telemetry?.latencyMs, 0),
          toolCalls: toNumber(envelope.telemetry?.toolCalls, 0),
          tokens: toNumber(envelope.telemetry?.tokens, 0),
        },
      }),
    },
  }
}

export async function executeAgentStateRead(
  node: AgentStateReadNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const state = ensureAgentState(ctx)
  const scope = resolveExecutionScope(ctx)
  const value = state.keys[node.key]
  if (value === undefined && node.required) {
    return {
      ok: false,
      error: `Required state key "${node.key}" is missing.`,
      errorCode: "AGENT_STATE_KEY_MISSING",
    }
  }
  return {
    ok: true,
    text: `Read state key ${node.key}.`,
    data: {
      key: node.key,
      value,
      userContextId: scope.userContextId || state.userContextId,
      conversationId: scope.conversationId || state.conversationId,
      sessionKey: scope.sessionKey || state.sessionKey,
      envelope: buildAgentEnvelope(getActiveAgentId(ctx) || "state-reader", { key: node.key, value }),
    },
  }
}

export async function executeAgentStateWrite(
  node: AgentStateWriteNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const state = ensureAgentState(ctx)
  const scope = resolveExecutionScope(ctx)
  const activeAgentId = getActiveAgentId(ctx)
  if (!activeAgentId) {
    return {
      ok: false,
      error: `State write "${node.key}" requires an active agent context.`,
      errorCode: "AGENT_STATE_WRITE_NO_ACTIVE_AGENT",
    }
  }
  if (!hasDeclaredStateKey(state, node.key)) {
    return {
      ok: false,
      error: `State key "${node.key}" is not declared for this run.`,
      errorCode: "AGENT_STATE_KEY_UNDECLARED",
    }
  }
  if (!isWriterAllowed(state, node.key, activeAgentId)) {
    return {
      ok: false,
      error: `Agent "${activeAgentId}" is not permitted to write state key "${node.key}".`,
      errorCode: "AGENT_STATE_WRITE_POLICY_DENIED",
    }
  }
  const resolvedValue = ctx.resolveExpr(node.valueExpression)
  const mode = node.writeMode || "replace"
  if (mode === "append") {
    const current = state.keys[node.key]
    if (Array.isArray(current)) {
      state.keys[node.key] = [...current, resolvedValue]
    } else if (current === undefined) {
      state.keys[node.key] = [resolvedValue]
    } else {
      state.keys[node.key] = [current, resolvedValue]
    }
  } else if (mode === "merge") {
    const current = state.keys[node.key]
    if (current && typeof current === "object" && !Array.isArray(current)) {
      state.keys[node.key] = { ...(current as Record<string, unknown>), value: resolvedValue }
    } else {
      state.keys[node.key] = { value: resolvedValue }
    }
  } else {
    state.keys[node.key] = resolvedValue
  }
  state.auditTrail.push({
    key: node.key,
    nodeId: node.id,
    agentId: activeAgentId,
    occurredAt: new Date().toISOString(),
  })
  return {
    ok: true,
    text: `State key ${node.key} updated.`,
    data: {
      key: node.key,
      value: state.keys[node.key],
      activeAgentId,
      mode,
      userContextId: scope.userContextId || state.userContextId,
      conversationId: scope.conversationId || state.conversationId,
      sessionKey: scope.sessionKey || state.sessionKey,
      envelope: buildAgentEnvelope(activeAgentId, { key: node.key, value: state.keys[node.key], mode }),
    },
  }
}

export async function executeProviderSelector(
  node: ProviderSelectorNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const scope = resolveExecutionScope(ctx)
  const allowedProviders = Array.isArray(node.allowedProviders) ? node.allowedProviders : []
  if (!allowedProviders.includes(node.defaultProvider)) {
    return {
      ok: false,
      error: `Default provider ${node.defaultProvider} is not in allowedProviders.`,
      errorCode: "PROVIDER_SELECTOR_INVALID_DEFAULT",
    }
  }
  if (!node.strategy) {
    return {
      ok: false,
      error: "Provider selector strategy is required.",
      errorCode: "PROVIDER_SELECTOR_STRATEGY_REQUIRED",
    }
  }
  return {
    ok: true,
    text: `Provider selected: ${node.defaultProvider}.`,
    data: {
      provider: node.defaultProvider,
      allowedProviders,
      strategy: node.strategy,
      userContextId: scope.userContextId,
      conversationId: scope.conversationId,
      sessionKey: scope.sessionKey,
      envelope: buildAgentEnvelope("provider-selector", {
        provider: node.defaultProvider,
        allowedProviders,
        strategy: node.strategy,
      }, {
        telemetry: {
          provider: node.defaultProvider,
        },
      }),
    },
  }
}

export async function executeAgentAudit(
  node: AgentAuditNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const state = ensureAgentState(ctx)
  const scope = resolveExecutionScope(ctx)
  const missingChecks = (node.requiredChecks || []).filter((check) => String(check || "").trim().length === 0)
  if (missingChecks.length > 0) {
    return {
      ok: false,
      error: "Audit agent contains blank requiredChecks entries.",
      errorCode: "AGENT_AUDIT_INVALID_CHECKS",
    }
  }
  const failedChecks: string[] = []
  for (const check of node.requiredChecks || []) {
    if (check === "user-context-isolation") {
      const contextMatches =
        state.userContextId === String(ctx.userContextId || "").trim()
        && state.conversationId === String(ctx.conversationId || "").trim()
        && state.sessionKey === String(ctx.sessionKey || "").trim()
      if (!contextMatches) failedChecks.push(check)
      continue
    }
    if (check === "policy-guardrails") {
      const hasProviderPolicy = [...ctx.nodeOutputs.values()].some((output) => {
        if (!output.ok || !output.data || typeof output.data !== "object") return false
        return String((output.data as Record<string, unknown>).strategy || "").trim() === "policy"
      })
      if (!hasProviderPolicy) failedChecks.push(check)
      continue
    }
  }
  if (failedChecks.length > 0) {
    return {
      ok: false,
      error: `Audit checks failed: ${failedChecks.join(", ")}.`,
      errorCode: "AGENT_AUDIT_CHECK_FAILED",
    }
  }
  return {
    ok: true,
    text: `Audit completed by ${node.agentId}.`,
    data: {
      activeAgentId: node.agentId,
      role: node.role,
      checks: node.requiredChecks,
      auditEntries: state.auditTrail.length,
      userContextId: scope.userContextId || state.userContextId,
      conversationId: scope.conversationId || state.conversationId,
      sessionKey: scope.sessionKey || state.sessionKey,
      envelope: buildAgentEnvelope(node.agentId, {
        role: node.role,
        checks: node.requiredChecks,
        auditEntries: state.auditTrail.length,
      }),
    },
  }
}

export async function executeAgentSubworkflow(
  node: AgentSubworkflowNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const scope = resolveExecutionScope(ctx)
  const userContextId = String(ctx.userContextId || ctx.mission?.userId || "").trim()
  if (!userContextId) {
    return {
      ok: false,
      error: "Subworkflow execution requires userContextId.",
      errorCode: "AGENT_SUBWORKFLOW_USER_CONTEXT_REQUIRED",
    }
  }
  if (node.missionId === ctx.missionId) {
    return {
      ok: false,
      error: "Subworkflow missionId cannot reference the currently running mission.",
      errorCode: "AGENT_SUBWORKFLOW_SELF_REFERENCE",
    }
  }
  const missions = await loadMissions({ userId: userContextId })
  const targetMission = missions.find((mission) => mission.id === node.missionId)
  if (!targetMission) {
    return {
      ok: false,
      error: `Subworkflow mission "${node.missionId}" was not found for this user context.`,
      errorCode: "AGENT_SUBWORKFLOW_NOT_FOUND",
    }
  }
  const executeMissionModule = await import("../execute-mission")
  const executeMission = executeMissionModule.executeMission as ((input: {
    mission: Mission
    source: "scheduler" | "trigger" | "manual"
    now?: Date
    runKey?: string
    scope?: ExecutionContext["scope"]
    userContextId?: string
    conversationId?: string
    sessionKey?: string
  }) => Promise<ExecuteMissionResult>)

  const childRunKey = `${ctx.runId}:subworkflow:${node.id}:${targetMission.id}`
  if (node.waitForCompletion === false) {
    void executeMission({
      mission: targetMission,
      source: "trigger",
      now: ctx.now,
      runKey: childRunKey,
      scope: ctx.scope,
      userContextId: ctx.userContextId,
      conversationId: ctx.conversationId,
      sessionKey: ctx.sessionKey,
    }).catch((error) => {
      console.warn(
        "[AgentSubworkflow] async execution failed:",
        targetMission.id,
        error instanceof Error ? error.message : String(error),
      )
    })
    return {
      ok: true,
      text: `Subworkflow ${targetMission.label || targetMission.id} started asynchronously.`,
      data: {
        missionId: targetMission.id,
        waitForCompletion: false,
        runKey: childRunKey,
        userContextId: scope.userContextId,
        conversationId: scope.conversationId,
        sessionKey: scope.sessionKey,
        envelope: buildAgentEnvelope(getActiveAgentId(ctx) || "agent-subworkflow", {
          missionId: targetMission.id,
          status: "started",
          waitForCompletion: false,
        }),
      },
    }
  }

  const result = await executeMission({
    mission: targetMission,
    source: "trigger",
    now: ctx.now,
    runKey: childRunKey,
    scope: ctx.scope,
    userContextId: ctx.userContextId,
    conversationId: ctx.conversationId,
    sessionKey: ctx.sessionKey,
  })
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason || `Subworkflow ${targetMission.id} failed.`,
      errorCode: "AGENT_SUBWORKFLOW_EXECUTION_FAILED",
    }
  }
  return {
    ok: true,
    text: `Subworkflow ${targetMission.label || targetMission.id} completed.`,
    data: {
      missionId: targetMission.id,
      waitForCompletion: true,
      result: {
        skipped: result.skipped,
        reason: result.reason,
        outputCount: Array.isArray(result.outputs) ? result.outputs.length : 0,
      },
      userContextId: scope.userContextId,
      conversationId: scope.conversationId,
      sessionKey: scope.sessionKey,
      envelope: buildAgentEnvelope(getActiveAgentId(ctx) || "agent-subworkflow", {
        missionId: targetMission.id,
        status: "completed",
        skipped: result.skipped,
      }),
    },
  }
}
