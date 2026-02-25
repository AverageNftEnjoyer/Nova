/**
 * Mission Generation — V.29 Native
 *
 * Generates Missions directly as native MissionNode[] + MissionConnection[].
 * The LLM outputs the new graph format directly — no legacy WorkflowStep
 * conversion path needed.
 */

import "server-only"

import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { parseJsonObject } from "@/lib/missions/text/cleaning"
import type {
  Mission,
  MissionNode,
  MissionConnection,
  MissionCategory,
  Provider,
  AiDetailLevel,
  NodePosition,
} from "../types"
import { buildMission } from "../store"
import { completeWithConfiguredLlm } from "../llm/providers"
import {
  deriveScheduleFromPrompt,
  inferRequestedOutputChannel,
  normalizeOutputChannelId,
  buildPromptGroundedAiPrompt,
} from "./generation"

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
        triggerTimezone: asStr(r.triggerTimezone, "America/New_York") || "America/New_York",
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
    case "novachat-output":
      return { id, label, position: pos, type: "novachat-output", messageTemplate: asStr(r.messageTemplate) || undefined }

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
        webhookUrl: asStr(r.webhookUrl) || undefined,
      }
    case "webhook-output":
      return { id, label, position: pos, type: "webhook-output", url: asStr(r.url, "") }

    // ── Utility ───────────────────────────────────────────────────────────
    case "sticky-note":
      return { id, label, position: pos, type: "sticky-note", content: asStr(r.content, "") }
    case "sub-workflow":
      return {
        id, label, position: pos, type: "sub-workflow",
        missionId: asStr(r.missionId, ""),
        waitForCompletion: r.waitForCompletion !== false,
      }

    default:
      // Unknown type — treat as a novachat-output so the mission is at least runnable
      return { id, label, position: pos, type: "novachat-output" }
  }
}

function parseLlmNodes(rawNodes: unknown[]): MissionNode[] {
  const nodes: MissionNode[] = []
  for (let i = 0; i < rawNodes.length; i++) {
    const node = parseLlmNode(rawNodes[i], i)
    if (node) nodes.push(node)
  }
  return nodes
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

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallbackMission(
  prompt: string,
  requestedOutput: string,
  defaultLlm: Provider,
  userId: string,
): Mission {
  const outputTypeMap: Record<string, string> = {
    telegram: "telegram-output",
    discord: "discord-output",
    email: "email-output",
    slack: "slack-output",
  }
  const outputType = (outputTypeMap[requestedOutput] || "novachat-output") as
    | "telegram-output" | "discord-output" | "email-output" | "slack-output" | "novachat-output"

  const aiId = "n3"
  const nodes: MissionNode[] = [
    {
      id: "n1", type: "schedule-trigger", label: "Daily Trigger", position: positionFor(0),
      triggerMode: "daily", triggerTime: "09:00", triggerTimezone: "America/New_York",
    },
    {
      id: "n2", type: "web-search", label: "Web Search", position: positionFor(1),
      query: prompt.slice(0, 150),
    },
    {
      id: aiId, type: "ai-summarize", label: "Summarize", position: positionFor(2),
      prompt: buildPromptGroundedAiPrompt(prompt) || "Summarize in 3 concise bullet points.",
      integration: defaultLlm,
      detailLevel: "standard",
    },
    { id: "n4", type: outputType, label: "Send Output", position: positionFor(3), messageTemplate: `{{$nodes.${aiId}.output.text}}` },
  ]
  const connections: MissionConnection[] = [
    { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
    { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
    { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
  ]
  return buildMission({ userId, label: prompt.slice(0, 30) || "New Mission", description: prompt, nodes, connections, integration: requestedOutput })
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

  const config = await loadIntegrationsConfig(scope)
  const catalog = await loadIntegrationCatalog(scope)

  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean)
  const outputOptions = catalog
    .filter((item) => item.kind === "channel" && item.connected)
    .map((item) => normalizeOutputChannelId(item.id))
    .filter(Boolean)
  const outputSet = new Set(outputOptions.length > 0 ? outputOptions : ["novachat", "telegram", "discord", "email", "webhook"])
  const defaultOutput = outputOptions[0] || "telegram"

  const activeLlmProvider = String(config.activeLlmProvider || "")
  const rawDefaultLlm = llmOptions.includes(activeLlmProvider) ? activeLlmProvider : (llmOptions[0] || "openai")
  const defaultLlm: Provider = rawDefaultLlm === "claude" || rawDefaultLlm === "grok" || rawDefaultLlm === "gemini" ? rawDefaultLlm as Provider : "openai"

  const requestedOutput = inferRequestedOutputChannel(prompt, outputSet, defaultOutput)
  const scheduleHint = deriveScheduleFromPrompt(prompt)
  const scheduleTime = scheduleHint.time || "09:00"
  const scheduleTz = scheduleHint.timezone || "America/New_York"

  const outputNodeType = (() => {
    const m: Record<string, string> = { telegram: "telegram-output", discord: "discord-output", email: "email-output", slack: "slack-output" }
    return m[requestedOutput] || "novachat-output"
  })()

  const systemText = [
    "You are Nova's mission architect. Output only strict JSON — no markdown, no explanation.",
    "Build production-grade automation workflows using native MissionNode types.",
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
    nodes: [
      { id: "n1", type: "schedule-trigger", label: "Daily trigger", triggerMode: "daily", triggerTime: scheduleTime, triggerTimezone: scheduleTz },
      { id: "n2", type: "web-search", label: "Search news", query: "SEARCH QUERY HERE" },
      { id: "n3", type: "ai-summarize", label: "Summarize", prompt: "Summarize in clear bullet points. Do not invent facts.", integration: defaultLlm, detailLevel: "standard" },
      { id: "n4", type: outputNodeType, label: "Send output", messageTemplate: "{{$nodes.n3.output.text}}" },
    ],
    connections: [
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
    "Return JSON matching this exact structure:",
    schemaExample,
  ].join("\n")

  let provider: Provider = defaultLlm
  let model = ""
  let nodes: MissionNode[] = []
  let connections: MissionConnection[] = []
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
      nodes = parseLlmNodes(Array.isArray(parsed.nodes) ? parsed.nodes : [])
      const nodeIds = new Set(nodes.map((n) => n.id))
      connections = parseLlmConnections(Array.isArray(parsed.connections) ? parsed.connections : [], nodeIds)
    }
  } catch (err) {
    console.warn("[buildMissionFromPrompt] LLM call failed, using fallback:", err instanceof Error ? err.message : "unknown")
  }

  const triggerTypes = new Set(["schedule-trigger", "manual-trigger", "webhook-trigger", "event-trigger"])
  const hasTrigger = nodes.some((n) => triggerTypes.has(n.type))

  if (nodes.length === 0 || !hasTrigger) {
    const fallback = buildFallbackMission(prompt, requestedOutput, defaultLlm, userId)
    return { mission: fallback, provider, model: model || "fallback" }
  }

  // Auto-wire: if LLM returned nodes but forgot connections, build a linear chain
  if (connections.length === 0 && nodes.length > 1) {
    for (let i = 0; i < nodes.length - 1; i++) {
      connections.push({
        id: `c${i + 1}`,
        sourceNodeId: nodes[i].id,
        sourcePort: "main",
        targetNodeId: nodes[i + 1].id,
        targetPort: "main",
      })
    }
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
