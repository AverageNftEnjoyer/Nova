/**
 * Mission Generation — V.29 Native
 *
 * Generates Missions directly as native MissionNode[] + MissionConnection[].
 * The LLM outputs the new graph format directly — no WorkflowStep
 * conversion path needed.
 */

import "server-only"

import type { IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { loadIntegrationCatalog } from "@/lib/integrations/catalog/server"
import { parseJsonObject } from "@/lib/missions/text/cleaning"
import { resolveTimezone } from "@/lib/shared/timezone"
import type {
  Mission,
  MissionNode,
  MissionConnection,
  MissionCategory,
  Provider,
  AiDetailLevel,
  NodePosition,
} from "../types/index"
import { buildMission } from "../store"
import { completeWithConfiguredLlm } from "../llm/providers"
import {
  deriveScheduleFromPrompt,
  inferRequestedOutputChannel,
  normalizeOutputChannelId,
} from "./generation"
import { isMissionAgentGraphEnabled, missionUsesAgentGraph } from "./agent-flags"
import { validateMissionGraphForVersioning } from "./versioning"

export interface BuildMissionResult {
  mission: Mission
  provider: Provider
  model: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asProvider(v: unknown): Provider {
  const p = String(v || "claude").toLowerCase()
  return p === "claude" || p === "openai" || p === "grok" || p === "gemini"
    ? (p as Provider)
    : "claude"
}

function asDetailLevel(v: unknown): AiDetailLevel {
  const d = String(v || "standard")
  return d === "concise" || d === "standard" || d === "detailed" ? d : "standard"
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function asNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function positionFor(index: number): NodePosition {
  return { x: 200 + index * 240, y: 200 }
}

function shouldBuildAgentGraph(prompt: string): boolean {
  const normalized = String(prompt || "").toLowerCase()
  return (
    normalized.includes("agent")
    || normalized.includes("agents")
    || normalized.includes("council")
    || normalized.includes("domain manager")
    || normalized.includes("provider selector")
    || normalized.includes("command spine")
    || normalized.includes("audit")
    || normalized.includes("team of")
  )
}

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, mapValue]) => {
    const normalizedKey = String(key || "").trim()
    const normalizedValue = typeof mapValue === "string" ? mapValue.trim() : ""
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue] as const] : []
  })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

function parseAgentRetryPolicy(value: unknown): { maxAttempts: number; backoffMs: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const maxAttempts = Number(record.maxAttempts)
  const backoffMs = Number(record.backoffMs)
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || !Number.isFinite(backoffMs) || backoffMs < 0) {
    return undefined
  }
  return {
    maxAttempts: Math.max(1, Math.floor(maxAttempts)),
    backoffMs: Math.max(0, Math.floor(backoffMs)),
  }
}

function parseAgentRuntimeConfig(record: Record<string, unknown>): {
  inputMapping?: Record<string, string>
  outputSchema?: string
  timeoutMs?: number
  retryPolicy?: { maxAttempts: number; backoffMs: number }
} {
  const inputMapping = parseStringMap(record.inputMapping)
  const outputSchema = asStr(record.outputSchema, "").trim() || undefined
  const timeoutMsRaw = Number(record.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.max(1, Math.floor(timeoutMsRaw))
    : undefined
  const retryPolicy = parseAgentRetryPolicy(record.retryPolicy)
  return {
    ...(inputMapping ? { inputMapping } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
  }
}

// ─── Node parser ─────────────────────────────────────────────────────────────

function parseLlmNode(raw: unknown, index: number): MissionNode | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const id = String(r.id || `n${index + 1}`)
  const label = String(r.label || String(r.type || "Node"))
  const type = String(r.type || "")
  const pos = positionFor(index)

  switch (type) {
    // ── Triggers ──────────────────────────────────────────────────────────
    case "schedule-trigger": {
      const mode = String(r.triggerMode || "daily")
      return {
        id, label, position: pos, type: "schedule-trigger",
        triggerMode: (mode === "once" || mode === "daily" || mode === "weekly" || mode === "interval" ? mode : "daily"),
        triggerTime: asStr(r.triggerTime, "09:00") || "09:00",
        triggerTimezone: resolveTimezone(asStr(r.triggerTimezone, "")),
        triggerDays: Array.isArray(r.triggerDays) ? r.triggerDays.map(String) : undefined,
        triggerIntervalMinutes: typeof r.triggerIntervalMinutes === "number" ? r.triggerIntervalMinutes : undefined,
      }
    }
    case "manual-trigger":
      return { id, label, position: pos, type: "manual-trigger" }

    case "webhook-trigger": {
      const method = String(r.method || "POST")
      return {
        id, label, position: pos, type: "webhook-trigger",
        method: (method === "GET" || method === "POST" || method === "PUT" ? method : "POST"),
        path: asStr(r.path, ""),
        authentication: (() => {
          const a = String(r.authentication || "none")
          return a === "bearer" || a === "basic" ? a : "none"
        })(),
      }
    }
    case "event-trigger":
      return { id, label, position: pos, type: "event-trigger", eventName: asStr(r.eventName, ""), filter: asStr(r.filter) || undefined }

    // ── Data ──────────────────────────────────────────────────────────────
    case "web-search":
      return {
        id, label, position: pos, type: "web-search",
        query: asStr(r.query, ""),
        maxResults: asNum(r.maxResults, 5),
        fetchContent: r.fetchContent !== false,
      }
    case "http-request": {
      const method = String(r.method || "GET").toUpperCase()
      return {
        id, label, position: pos, type: "http-request",
        method: (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" ? method : "GET"),
        url: asStr(r.url, ""),
        selector: asStr(r.selector) || undefined,
      }
    }
    case "rss-feed":
      return {
        id, label, position: pos, type: "rss-feed",
        url: asStr(r.url, ""),
        maxItems: asNum(r.maxItems, 10),
      }
    case "coinbase": {
      const intent = String(r.intent || "report")
      return {
        id, label, position: pos, type: "coinbase",
        intent: (intent === "status" || intent === "price" || intent === "portfolio" || intent === "transactions" || intent === "report" ? intent : "report"),
        assets: Array.isArray(r.assets) ? r.assets.map(String) : undefined,
        quoteCurrency: asStr(r.quoteCurrency) || undefined,
      }
    }
    case "file-read": {
      const fmt = String(r.format || "text")
      return {
        id, label, position: pos, type: "file-read",
        path: asStr(r.path, ""),
        format: (fmt === "json" || fmt === "csv" ? fmt : "text"),
      }
    }
    case "form-input":
      return {
        id, label, position: pos, type: "form-input",
        fields: Array.isArray(r.fields)
          ? r.fields.map((f) => {
              const ff = (f && typeof f === "object" ? f : {}) as Record<string, unknown>
              return { name: asStr(ff.name, "field"), label: asStr(ff.label, asStr(ff.name, "Field")), type: "text" as const }
            })
          : [{ name: "input", label: "Input", type: "text" as const }],
      }

    // ── AI ────────────────────────────────────────────────────────────────
    case "ai-summarize":
      return {
        id, label, position: pos, type: "ai-summarize",
        prompt: asStr(r.prompt, "Summarize the input in clear bullet points."),
        integration: asProvider(r.integration),
        detailLevel: asDetailLevel(r.detailLevel),
      }
    case "ai-generate":
      return {
        id, label, position: pos, type: "ai-generate",
        prompt: asStr(r.prompt, "Generate a report from the input."),
        integration: asProvider(r.integration),
        detailLevel: asDetailLevel(r.detailLevel),
      }
    case "ai-classify":
      return {
        id, label, position: pos, type: "ai-classify",
        prompt: asStr(r.prompt, "Classify the input."),
        integration: asProvider(r.integration),
        categories: Array.isArray(r.categories) ? r.categories.map(String) : ["positive", "negative", "neutral"],
      }
    case "ai-extract":
      return {
        id, label, position: pos, type: "ai-extract",
        prompt: asStr(r.prompt, "Extract key fields from the input."),
        integration: asProvider(r.integration),
      }
    case "ai-chat":
      return {
        id, label, position: pos, type: "ai-chat",
        integration: asProvider(r.integration),
        messages: Array.isArray(r.messages)
          ? r.messages.map((m) => {
              const mm = (m && typeof m === "object" ? m : {}) as Record<string, unknown>
              const role = String(mm.role || "user")
              return {
                role: (role === "system" || role === "assistant" ? role : "user") as "system" | "user" | "assistant",
                content: asStr(mm.content, ""),
              }
            })
          : [],
      }

    // ── Logic ─────────────────────────────────────────────────────────────
    case "condition":
      return {
        id, label, position: pos, type: "condition",
        rules: Array.isArray(r.rules)
          ? r.rules.map((rule) => {
              const rr = (rule && typeof rule === "object" ? rule : {}) as Record<string, unknown>
              const op = String(rr.operator || "exists")
              return {
                field: asStr(rr.field, ""),
                operator: (op === "contains" || op === "equals" || op === "not_equals" || op === "greater_than" || op === "less_than" || op === "regex" || op === "exists" || op === "not_exists" ? op : "exists") as "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | "not_exists",
                value: asStr(rr.value) || undefined,
              }
            })
          : [{ field: "", operator: "exists" as const }],
        logic: String(r.logic || "all") === "any" ? "any" : "all",
      }
    case "switch":
      return {
        id, label, position: pos, type: "switch",
        expression: asStr(r.expression, ""),
        cases: Array.isArray(r.cases)
          ? r.cases.map((c) => {
              const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>
              return { value: asStr(cc.value, ""), port: asStr(cc.port, "case_0") }
            })
          : [],
      }
    case "loop":
      return {
        id, label, position: pos, type: "loop",
        inputExpression: asStr(r.inputExpression, ""),
        batchSize: asNum(r.batchSize, 1),
        maxIterations: asNum(r.maxIterations, 100),
      }
    case "merge": {
      const mode = String(r.mode || "wait-all")
      return {
        id, label, position: pos, type: "merge",
        mode: (mode === "first-wins" || mode === "append" ? mode : "wait-all"),
        inputCount: asNum(r.inputCount, 2),
      }
    }
    case "split":
      return { id, label, position: pos, type: "split", outputCount: asNum(r.outputCount, 2) }

    case "wait": {
      const waitMode = String(r.waitMode || "duration")
      return {
        id, label, position: pos, type: "wait",
        waitMode: (waitMode === "until-time" || waitMode === "webhook" ? waitMode : "duration"),
        durationMs: asNum(r.durationMs, 60000),
        untilTime: asStr(r.untilTime) || undefined,
        webhookPath: asStr(r.webhookPath) || undefined,
      }
    }

    // ── Transform ─────────────────────────────────────────────────────────
    case "set-variables":
      return {
        id, label, position: pos, type: "set-variables",
        assignments: Array.isArray(r.assignments)
          ? r.assignments.map((a) => {
              const aa = (a && typeof a === "object" ? a : {}) as Record<string, unknown>
              return { name: asStr(aa.name, ""), value: asStr(aa.value, "") }
            })
          : [],
      }
    case "code":
      return {
        id, label, position: pos, type: "code",
        language: "javascript",
        code: asStr(r.code, "return $input;"),
      }
    case "format": {
      const fmt = String(r.outputFormat || "text")
      return {
        id, label, position: pos, type: "format",
        template: asStr(r.template, "{{$nodes.previous.output.text}}"),
        outputFormat: (fmt === "markdown" || fmt === "json" || fmt === "html" ? fmt : "text"),
      }
    }
    case "filter": {
      const mode = String(r.mode || "keep")
      return {
        id, label, position: pos, type: "filter",
        expression: asStr(r.expression, "true"),
        mode: (mode === "remove" ? "remove" : "keep"),
      }
    }
    case "sort": {
      const dir = String(r.direction || "asc")
      return {
        id, label, position: pos, type: "sort",
        field: asStr(r.field, ""),
        direction: (dir === "desc" ? "desc" : "asc"),
      }
    }
    case "dedupe":
      return { id, label, position: pos, type: "dedupe", field: asStr(r.field, "") }

    // ── Output ────────────────────────────────────────────────────────────
    case "telegram-output":
      return {
        id, label, position: pos, type: "telegram-output",
        messageTemplate: asStr(r.messageTemplate) || undefined,
        chatIds: Array.isArray(r.chatIds) ? r.chatIds.map(String) : undefined,
        parseMode: (() => { const p = String(r.parseMode || "markdown"); return p === "html" || p === "plain" ? p : "markdown" })(),
      }
    case "discord-output":
      return {
        id, label, position: pos, type: "discord-output",
        messageTemplate: asStr(r.messageTemplate) || undefined,
        webhookUrls: Array.isArray(r.webhookUrls) ? r.webhookUrls.map(String) : undefined,
      }
    case "email-output": {
      const fmt = String(r.format || "text")
      return {
        id, label, position: pos, type: "email-output",
        messageTemplate: asStr(r.messageTemplate) || undefined,
        subject: asStr(r.subject) || undefined,
        recipients: Array.isArray(r.recipients) ? r.recipients.map(String) : undefined,
        format: (fmt === "html" ? "html" : "text"),
      }
    }
    case "slack-output":
      return {
        id, label, position: pos, type: "slack-output",
        messageTemplate: asStr(r.messageTemplate) || undefined,
        channel: asStr(r.channel) || undefined,
      }
    case "webhook-output":
      return { id, label, position: pos, type: "webhook-output", url: asStr(r.url, "") }

    // ── Utility ───────────────────────────────────────────────────────────
    case "sticky-note":
      return { id, label, position: pos, type: "sticky-note", content: asStr(r.content, "") }
    case "agent-supervisor": {
      const agentId = asStr(r.agentId, "").trim()
      const goal = asStr(r.goal, "").trim()
      if (!agentId || !goal) return null
      return {
        id, label, position: pos, type: "agent-supervisor",
        agentId,
        role: "operator",
        goal,
        reads: Array.isArray(r.reads) ? r.reads.map(String) : [],
        writes: Array.isArray(r.writes) ? r.writes.map(String) : [],
        ...parseAgentRuntimeConfig(r),
      }
    }
    case "agent-worker": {
      const agentId = asStr(r.agentId, "").trim()
      const goal = asStr(r.goal, "").trim()
      const role = String(r.role || "").trim()
      const validRole =
        role === "routing-council"
        || role === "policy-council"
        || role === "memory-council"
        || role === "planning-council"
        || role === "media-manager"
        || role === "finance-manager"
        || role === "productivity-manager"
        || role === "comms-manager"
        || role === "system-manager"
        || role === "worker-agent"
      if (!agentId || !goal || !validRole) return null
      const domainRaw = String(r.domain || "").trim()
      if (
        domainRaw
        && domainRaw !== "media"
        && domainRaw !== "finance"
        && domainRaw !== "productivity"
        && domainRaw !== "comms"
        && domainRaw !== "system"
      ) {
        return null
      }
      const domain = domainRaw
        ? (domainRaw as "media" | "finance" | "productivity" | "comms" | "system")
        : undefined
      return {
        id, label, position: pos, type: "agent-worker",
        agentId,
        role,
        domain,
        goal,
        reads: Array.isArray(r.reads) ? r.reads.map(String) : [],
        writes: Array.isArray(r.writes) ? r.writes.map(String) : [],
        ...parseAgentRuntimeConfig(r),
      }
    }
    case "agent-handoff":
      if (!asStr(r.fromAgentId, "").trim() || !asStr(r.toAgentId, "").trim() || !asStr(r.reason, "").trim()) return null
      return {
        id, label, position: pos, type: "agent-handoff",
        fromAgentId: asStr(r.fromAgentId, "").trim(),
        toAgentId: asStr(r.toAgentId, "").trim(),
        reason: asStr(r.reason, "").trim(),
      }
    case "agent-state-read":
      if (!asStr(r.key, "").trim()) return null
      return {
        id, label, position: pos, type: "agent-state-read",
        key: asStr(r.key, "").trim(),
        required: r.required !== false,
      }
    case "agent-state-write":
      if (!asStr(r.key, "").trim() || !asStr(r.valueExpression, "").trim()) return null
      return {
        id, label, position: pos, type: "agent-state-write",
        key: asStr(r.key, "").trim(),
        valueExpression: asStr(r.valueExpression, "").trim(),
        writeMode: (() => {
          const mode = String(r.writeMode || "replace")
          return mode === "merge" || mode === "append" ? mode : "replace"
        })(),
      }
    case "provider-selector": {
      const allowedProviders = Array.isArray(r.allowedProviders)
        ? r.allowedProviders
          .map((provider) => String(provider).trim())
          .filter((provider) => provider === "openai" || provider === "claude" || provider === "grok" || provider === "gemini")
          .map((provider) => provider as Provider)
        : []
      const defaultProvider = String(r.defaultProvider || "").trim()
      const strategy = String(r.strategy || "").trim()
      const strategyValid = strategy === "policy" || strategy === "latency" || strategy === "cost" || strategy === "quality"
      if (allowedProviders.length === 0 || !allowedProviders.includes(defaultProvider as Provider) || !strategyValid) return null
      const parsedStrategy = strategy as "policy" | "latency" | "cost" | "quality"
      return {
        id, label, position: pos, type: "provider-selector",
        allowedProviders,
        defaultProvider: defaultProvider as Provider,
        strategy: parsedStrategy,
      }
    }
    case "agent-audit": {
      const agentId = asStr(r.agentId, "").trim()
      const goal = asStr(r.goal, "").trim()
      const requiredChecks = Array.isArray(r.requiredChecks)
        ? r.requiredChecks.map(String).map((item) => item.trim()).filter(Boolean)
        : []
      if (!agentId || !goal || requiredChecks.length === 0) return null
      return {
        id, label, position: pos, type: "agent-audit",
        agentId,
        role: "audit-council",
        goal,
        requiredChecks,
        reads: Array.isArray(r.reads) ? r.reads.map(String) : [],
        writes: Array.isArray(r.writes) ? r.writes.map(String) : [],
        ...parseAgentRuntimeConfig(r),
      }
    }
    case "agent-subworkflow":
      if (!asStr(r.missionId, "").trim()) return null
      return {
        id, label, position: pos, type: "agent-subworkflow",
        missionId: asStr(r.missionId, "").trim(),
        inputMapping: parseStringMap(r.inputMapping),
        waitForCompletion: r.waitForCompletion !== false,
      }

    default:
      return null
  }
}

function parseLlmNodes(rawNodes: unknown[]): { nodes: MissionNode[]; rejected: Array<{ index: number; type: string }> } {
  const nodes: MissionNode[] = []
  const rejected: Array<{ index: number; type: string }> = []
  for (let i = 0; i < rawNodes.length; i++) {
    const node = parseLlmNode(rawNodes[i], i)
    if (node) {
      nodes.push(node)
      continue
    }
    const raw = rawNodes[i]
    const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    rejected.push({ index: i, type: String(record.type || "unknown") })
  }
  return { nodes, rejected }
}

function parseLlmConnections(rawConns: unknown[], nodeIds: Set<string>): MissionConnection[] {
  const connections: MissionConnection[] = []
  const seen = new Set<string>()
  for (let i = 0; i < (Array.isArray(rawConns) ? rawConns.length : 0); i++) {
    const raw = rawConns[i]
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const sourceNodeId = String(r.sourceNodeId || "")
    const targetNodeId = String(r.targetNodeId || "")
    if (!sourceNodeId || !targetNodeId) continue
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) continue
    const connId = String(r.id || `c${i + 1}`)
    if (seen.has(connId)) continue
    seen.add(connId)
    connections.push({
      id: connId,
      sourceNodeId,
      sourcePort: String(r.sourcePort || "main"),
      targetNodeId,
      targetPort: typeof r.targetPort === "string" ? r.targetPort : "main",
    })
  }
  return connections
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build a Mission from a natural language prompt.
 * The LLM outputs native MissionNode[] + MissionConnection[] directly.
 */
export async function buildMissionFromPrompt(
  prompt: string,
  options?: {
    userId?: string
    scope?: IntegrationsStoreScope
    chatIds?: string[]
    integration?: string
  },
): Promise<BuildMissionResult> {
  const scope = options?.scope
  const scopeRecord = scope as Record<string, unknown> | undefined
  const scopeUser = scopeRecord?.user as Record<string, unknown> | undefined
  const userId = String(
    options?.userId ||
    scopeRecord?.userId ||
    scopeUser?.id ||
    "",
  )

  let config: Awaited<ReturnType<typeof loadIntegrationsConfig>> | null = null
  let catalog: Awaited<ReturnType<typeof loadIntegrationCatalog>> = []
  try {
    ;[config, catalog] = await Promise.all([loadIntegrationsConfig(scope), loadIntegrationCatalog(scope)])
  } catch (err) {
    console.warn("[buildMissionFromPrompt] Failed to load integrations config/catalog, using defaults:", err instanceof Error ? err.message : "unknown")
  }

  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean)
  const outputOptions = catalog
    .filter((item) => item.kind === "channel" && item.connected)
    .map((item) => normalizeOutputChannelId(item.id))
    .filter(Boolean)
  const outputSet = new Set(outputOptions)
  if (outputSet.size === 0) {
    throw new Error("Mission generation requires at least one connected output integration.")
  }
  const defaultOutput = outputOptions[0]

  const activeLlmProvider = String(config?.activeLlmProvider || "")
  if (llmOptions.length === 0) {
    throw new Error("Mission generation requires at least one connected LLM provider.")
  }
  const rawDefaultLlm = llmOptions.includes(activeLlmProvider) ? activeLlmProvider : llmOptions[0]
  const defaultLlm: Provider = rawDefaultLlm === "claude" || rawDefaultLlm === "grok" || rawDefaultLlm === "gemini" ? rawDefaultLlm as Provider : "openai"

  const requestedOutput = inferRequestedOutputChannel(prompt, outputSet, defaultOutput)
  const requireAgentGraph = shouldBuildAgentGraph(prompt)
  if (requireAgentGraph && !isMissionAgentGraphEnabled()) {
    throw new Error("Mission generation requested an agent graph, but NOVA_MISSIONS_AGENT_GRAPH_ENABLED is disabled.")
  }
  const scheduleHint = deriveScheduleFromPrompt(prompt)
  const scheduleTime = scheduleHint.time || "09:00"
  const scheduleTz = resolveTimezone(scheduleHint.timezone)

  const outputNodeType = (() => {
    const m: Record<string, string> = { telegram: "telegram-output", discord: "discord-output", email: "email-output", slack: "slack-output" }
    return m[requestedOutput] || "telegram-output"
  })()

  const systemText = [
    "You are Nova's mission architect. Output only strict JSON — no markdown, no explanation.",
    "Build production-grade automation workflows using native MissionNode types.",
    "For agent missions, enforce this command spine: operator -> council -> domain-manager -> worker -> audit -> operator.",
    "Use provider-selector as a separate execution rail and never as a manager role.",
    "Agent supervisor, worker, and audit nodes should include inputMapping, outputSchema, timeoutMs, and retryPolicy when possible.",
    "Never emit unknown node types. Never omit required connections.",
    requireAgentGraph
      ? "This prompt requires an agent graph. You must emit supervisor, council, domain-manager, worker, provider-selector, audit, and handoff nodes."
      : "Use a non-agent graph unless the user explicitly asks for multi-agent orchestration.",
    "Pass data between nodes using template expressions: {{$nodes.NODE_ID.output.text}} or {{$nodes.NODE_ID.output.items}}.",
    "All node IDs must be unique strings (n1, n2, …). Connections: sourceNodeId:sourcePort → targetNodeId:targetPort.",
    `Use 24-hour HH:MM time. Default timezone: ${scheduleTz}.`,
    `Connected AI models: ${llmOptions.join(", ") || "openai"}. Preferred AI: ${defaultLlm}.`,
    `Connected output channels: ${[...outputSet].join(", ")}. Preferred output: ${requestedOutput} → use node type "${outputNodeType}".`,
    "For web/news tasks always include a web-search node before AI. Do not invent facts.",
    "For crypto/Coinbase tasks use a coinbase node (intent: report|portfolio|price|transactions|status).",
  ].join(" ")

  const schemaExample = JSON.stringify({
    label: "Mission title (max 30 chars)",
    description: "What this mission does",
    schedule: { mode: "daily", time: scheduleTime, timezone: scheduleTz, days: ["mon", "tue", "wed", "thu", "fri"] },
    nodes: requireAgentGraph
      ? [
          { id: "n1", type: "schedule-trigger", label: "Daily trigger", triggerMode: "daily", triggerTime: scheduleTime, triggerTimezone: scheduleTz },
          { id: "n2", type: "agent-supervisor", label: "Operator", agentId: "operator", role: "operator", goal: "Command councils and manager routing.", inputMapping: { brief: "{{$nodes.n1.output.text}}" }, outputSchema: "{\"route\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
          { id: "n3", type: "agent-worker", label: "Routing Council", agentId: "routing-council", role: "routing-council", goal: "Classify intent and select domain manager.", inputMapping: { route: "{{$nodes.n2.output.text}}" }, outputSchema: "{\"manager\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 2, backoffMs: 1500 } },
          { id: "n4", type: "agent-worker", label: "System Manager", agentId: "system-manager", role: "system-manager", goal: "Assign work to worker agent.", inputMapping: { manager: "{{$nodes.n3.output.text}}" }, outputSchema: "{\"worker\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 2, backoffMs: 1500 } },
          { id: "n5", type: "agent-worker", label: "Worker Agent", agentId: "worker-1", role: "worker-agent", goal: "Execute the task.", inputMapping: { assignment: "{{$nodes.n4.output.text}}" }, outputSchema: "{\"result\":\"string\"}", timeoutMs: 180000, retryPolicy: { maxAttempts: 2, backoffMs: 2000 } },
          { id: "n6", type: "provider-selector", label: "Provider Rail", allowedProviders: [defaultLlm], defaultProvider: defaultLlm, strategy: "policy" },
          { id: "n7", type: "agent-audit", label: "Audit", agentId: "audit-council", role: "audit-council", goal: "Verify isolation and policy checks.", requiredChecks: ["user-context-isolation", "policy-guardrails"], inputMapping: { review: "{{$nodes.n5.output.text}}" }, outputSchema: "{\"audit\":\"string\"}", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
          { id: "n8", type: "agent-handoff", label: "Operator->Council", fromAgentId: "operator", toAgentId: "routing-council", reason: "route intent" },
          { id: "n9", type: "agent-handoff", label: "Council->Manager", fromAgentId: "routing-council", toAgentId: "system-manager", reason: "domain ownership" },
          { id: "n10", type: "agent-handoff", label: "Manager->Worker", fromAgentId: "system-manager", toAgentId: "worker-1", reason: "execution delegation" },
          { id: "n11", type: "agent-handoff", label: "Worker->Audit", fromAgentId: "worker-1", toAgentId: "audit-council", reason: "compliance review" },
          { id: "n12", type: "agent-handoff", label: "Audit->Operator", fromAgentId: "audit-council", toAgentId: "operator", reason: "final approval" },
          { id: "n13", type: outputNodeType, label: "Send output", messageTemplate: "{{$nodes.n2.output.text}}" },
        ]
      : [
          { id: "n1", type: "schedule-trigger", label: "Daily trigger", triggerMode: "daily", triggerTime: scheduleTime, triggerTimezone: scheduleTz },
          { id: "n2", type: "web-search", label: "Search news", query: "SEARCH QUERY HERE" },
          { id: "n3", type: "ai-summarize", label: "Summarize", prompt: "Summarize in clear bullet points. Do not invent facts.", integration: defaultLlm, detailLevel: "standard" },
          { id: "n4", type: outputNodeType, label: "Send output", messageTemplate: "{{$nodes.n3.output.text}}" },
        ],
    connections: requireAgentGraph
      ? [
          { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
          { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
          { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
          { id: "c4", sourceNodeId: "n4", sourcePort: "main", targetNodeId: "n5", targetPort: "main" },
          { id: "c5", sourceNodeId: "n5", sourcePort: "main", targetNodeId: "n6", targetPort: "main" },
          { id: "c6", sourceNodeId: "n6", sourcePort: "main", targetNodeId: "n7", targetPort: "main" },
          { id: "c7", sourceNodeId: "n7", sourcePort: "main", targetNodeId: "n8", targetPort: "main" },
          { id: "c8", sourceNodeId: "n8", sourcePort: "main", targetNodeId: "n9", targetPort: "main" },
          { id: "c9", sourceNodeId: "n9", sourcePort: "main", targetNodeId: "n10", targetPort: "main" },
          { id: "c10", sourceNodeId: "n10", sourcePort: "main", targetNodeId: "n11", targetPort: "main" },
          { id: "c11", sourceNodeId: "n11", sourcePort: "main", targetNodeId: "n12", targetPort: "main" },
          { id: "c12", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n13", targetPort: "main" },
        ]
      : [
          { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
          { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
          { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
        ],
  })

  const userText = [
    `User prompt: ${prompt}`,
    "Additional node types you can use:",
    "- coinbase: intent=report|portfolio|price|transactions|status, assets=[\"BTC\",\"ETH\"]",
    "- rss-feed: url=FEED_URL, maxItems=10",
    "- http-request: url=API_URL, method=GET|POST",
    "- condition: rules=[{field,operator,value}], logic=all|any  (ports: true, false)",
    "- ai-generate: prompt=WRITE_PROMPT, integration, detailLevel",
    "- ai-classify: prompt=CLASSIFY_PROMPT, categories=[\"cat1\",\"cat2\"]",
    "- format: template=HANDLEBARS_TEMPLATE, outputFormat=text|markdown|html",
    "- set-variables: assignments=[{name,value}]",
    "- email-output: subject=SUBJECT, messageTemplate",
    "- slack-output: channel=#CHANNEL, messageTemplate",
    requireAgentGraph
      ? "- For this prompt, include the complete command-spine handoff set and a dedicated agent-audit node."
      : "- Use agent nodes only when the user asks for multi-agent routing.",
    "Return JSON matching this exact structure:",
    schemaExample,
  ].join("\n")

  let provider: Provider = defaultLlm
  let model = ""
  let nodes: MissionNode[] = []
  let connections: MissionConnection[] = []
  let rejectedNodes: Array<{ index: number; type: string }> = []
  let label = ""
  let description = ""

  try {
    const completion = await completeWithConfiguredLlm(systemText, userText, 2000, scope)
    const rawProvider = String(completion.provider || defaultLlm)
    provider = rawProvider === "claude" || rawProvider === "openai" || rawProvider === "grok" || rawProvider === "gemini"
      ? rawProvider as Provider
      : defaultLlm
    model = String(completion.model || "")
    const parsed = parseJsonObject(completion.text)
    if (parsed) {
      label = String(parsed.label || "").trim().slice(0, 40)
      description = String(parsed.description || "").trim()
      const parsedNodes = parseLlmNodes(Array.isArray(parsed.nodes) ? parsed.nodes : [])
      nodes = parsedNodes.nodes
      rejectedNodes = parsedNodes.rejected
      const nodeIds = new Set(nodes.map((n) => n.id))
      connections = parseLlmConnections(Array.isArray(parsed.connections) ? parsed.connections : [], nodeIds)
    }
  } catch (err) {
    throw new Error(`Mission generation failed: ${err instanceof Error ? err.message : "unknown error"}`)
  }

  const triggerTypes = new Set(["schedule-trigger", "manual-trigger", "webhook-trigger", "event-trigger"])
  const hasTrigger = nodes.some((n) => triggerTypes.has(n.type))

  if (nodes.length === 0) {
    throw new Error("Mission generation returned zero nodes.")
  }
  if (rejectedNodes.length > 0) {
    const sample = rejectedNodes.slice(0, 3).map((item) => `${item.type}@${item.index}`).join(", ")
    throw new Error(`Mission generation returned invalid node payload(s): ${sample}.`)
  }
  if (!hasTrigger) {
    throw new Error("Mission generation must include at least one trigger node.")
  }
  if (!isMissionAgentGraphEnabled() && missionUsesAgentGraph({ nodes })) {
    throw new Error("Mission generation returned an agent graph while NOVA_MISSIONS_AGENT_GRAPH_ENABLED is disabled.")
  }
  if (requireAgentGraph && !nodes.some((node) => node.type.startsWith("agent-") || node.type === "provider-selector")) {
    throw new Error("Mission generation required an agent graph but returned no agent orchestration nodes.")
  }
  if (connections.length === 0 && nodes.length > 1) {
    throw new Error("Mission generation returned a disconnected graph (missing connections).")
  }

  const mission = buildMission({
    userId,
    label: label || prompt.slice(0, 30) || "New Mission",
    description: description || prompt,
    nodes,
    connections,
    integration: requestedOutput,
    chatIds: options?.chatIds || [],
  })

  const issues = validateMissionGraphForVersioning(mission)
  if (issues.length > 0) {
    const sample = issues.slice(0, 3).map((issue) => issue.code).join(", ")
    throw new Error(`Mission generation produced invalid graph contract: ${sample}.`)
  }

  return { mission: { ...mission, status: "draft" }, provider, model }
}

/**
 * Guess category from mission label and tags.
 * Re-exported for UI use.
 */
export function guessMissionCategory(label: string, tags: string[] = []): MissionCategory {
  const text = `${label} ${tags.join(" ")}`.toLowerCase()
  if (/crypto|bitcoin|eth|coinbase|portfolio|pnl/.test(text)) return "finance"
  if (/market|stock|trading|earnings|forex/.test(text)) return "finance"
  if (/deploy|uptime|error|monitor|devops|ci|cd/.test(text)) return "devops"
  if (/seo|lead|ad|campaign|marketing/.test(text)) return "marketing"
  if (/research|brief|news|digest|summary|headline/.test(text)) return "research"
  if (/ecommerce|order|product|shop|inventory/.test(text)) return "ecommerce"
  if (/hr|employee|onboard|leave|payroll/.test(text)) return "hr"
  if (/security|threat|cve|vuln|breach/.test(text)) return "security"
  if (/content|blog|post|social|tweet/.test(text)) return "content"
  if (/weather|remind|habit|travel|personal/.test(text)) return "personal"
  return "research"
}
