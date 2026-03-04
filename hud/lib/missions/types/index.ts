/**
 * Mission Runtime Type Definitions — V.26 Enterprise Overhaul
 *
 * Graph-based workflow system with discriminated union node types,
 * expression-based data passing, and 30+ node types across 6 categories.
 */

import type { IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { getRuntimeTimezone } from "@/lib/shared/timezone"

// ─────────────────────────────────────────────────────────────────────────────
// Primitive / Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "openai" | "claude" | "grok" | "gemini"
export type AiDetailLevel = "concise" | "standard" | "detailed"
export type CouncilAgentRole =
  | "routing-council"
  | "policy-council"
  | "memory-council"
  | "planning-council"
export type AuditAgentRole = "audit-council"
export type DomainManagerRole =
  | "media-manager"
  | "finance-manager"
  | "productivity-manager"
  | "comms-manager"
  | "system-manager"
export type WorkerDomain = "media" | "finance" | "productivity" | "comms" | "system"
export type WorkerAgentRole = "worker-agent"
export type OrgChartWorkerRole = CouncilAgentRole | DomainManagerRole | WorkerAgentRole
export type OrgChartAgentRole = "operator" | AuditAgentRole | OrgChartWorkerRole

export type MissionCategory =
  | "research"
  | "finance"
  | "devops"
  | "marketing"
  | "ecommerce"
  | "hr"
  | "security"
  | "content"
  | "social"
  | "personal"
  | "data_analytics"
  | "customer_success"

export type MissionStatus = "draft" | "active" | "paused" | "archived"

// ─────────────────────────────────────────────────────────────────────────────
// Node Position (used by canvas)
// ─────────────────────────────────────────────────────────────────────────────

export interface NodePosition {
  x: number
  y: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Base — shared by every node type
// ─────────────────────────────────────────────────────────────────────────────

interface NodeBase {
  id: string
  label: string
  position: NodePosition
  disabled?: boolean
  notes?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleTriggerNode extends NodeBase {
  type: "schedule-trigger"
  triggerMode: "once" | "daily" | "weekly" | "interval"
  triggerTime?: string         // HH:MM
  triggerTimezone?: string
  triggerDays?: string[]       // ["mon","wed","fri"]
  triggerIntervalMinutes?: number
  triggerWindowMinutes?: number
}

export interface WebhookTriggerNode extends NodeBase {
  type: "webhook-trigger"
  method: "GET" | "POST" | "PUT"
  path: string                 // /missions/webhook/:id
  authentication?: "none" | "bearer" | "basic"
  responseMode?: "immediate" | "last-node"
}

export interface ManualTriggerNode extends NodeBase {
  type: "manual-trigger"
}

export interface EventTriggerNode extends NodeBase {
  type: "event-trigger"
  eventName: string            // e.g. "nova.message.received", "nova.skill.completed"
  filter?: string              // expression filter
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface HttpRequestNode extends NodeBase {
  type: "http-request"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  body?: string
  authentication?: "none" | "bearer" | "basic" | "api-key"
  authToken?: string
  responseFormat?: "json" | "text" | "binary"
  selector?: string            // CSS/JSONPath selector
}

export interface WebSearchNode extends NodeBase {
  type: "web-search"
  query: string
  provider?: "brave" | "tavily"
  maxResults?: number
  includeSources?: boolean
  fetchContent?: boolean       // fetch full page text for top results
}

export interface RssFeedNode extends NodeBase {
  type: "rss-feed"
  url: string
  maxItems?: number
  filterKeywords?: string[]
}

export interface CoinbaseNode extends NodeBase {
  type: "coinbase"
  intent: "status" | "price" | "portfolio" | "transactions" | "report"
  assets?: string[]
  quoteCurrency?: string
  thresholdPct?: number
  cadence?: "daily" | "weekly" | string
  transactionLimit?: number
  includePreviousArtifactContext?: boolean
  format?: {
    style?: "concise" | "standard" | "detailed"
    includeRawMetadata?: boolean
  }
}

export interface FileReadNode extends NodeBase {
  type: "file-read"
  path: string
  format?: "text" | "json" | "csv"
  encoding?: "utf8" | "base64"
}

export interface FormInputNode extends NodeBase {
  type: "form-input"
  fields: Array<{ name: string; label: string; type: "text" | "number" | "select"; options?: string[] }>
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface AiSummarizeNode extends NodeBase {
  type: "ai-summarize"
  prompt: string
  integration: Provider
  model?: string
  detailLevel?: AiDetailLevel
  inputExpression?: string     // {{$nodes.NodeLabel.output.text}}
  systemPrompt?: string
  maxTokens?: number
}

export interface AiClassifyNode extends NodeBase {
  type: "ai-classify"
  prompt: string
  integration: Provider
  model?: string
  categories: string[]
  inputExpression?: string
}

export interface AiExtractNode extends NodeBase {
  type: "ai-extract"
  prompt: string
  integration: Provider
  model?: string
  outputSchema?: string        // JSON schema for structured extraction
  inputExpression?: string
}

export interface AiGenerateNode extends NodeBase {
  type: "ai-generate"
  prompt: string
  integration: Provider
  model?: string
  detailLevel?: AiDetailLevel
  systemPrompt?: string
  maxTokens?: number
}

export interface AiChatNode extends NodeBase {
  type: "ai-chat"
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  integration: Provider
  model?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Logic Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface ConditionNode extends NodeBase {
  type: "condition"
  rules: ConditionRule[]
  logic: "all" | "any"
  /** Port "true" goes to truthy branch, "false" goes to falsy branch */
}

export interface ConditionRule {
  field: string                // expression like {{$nodes.WebSearch.output.text}}
  operator: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | "not_exists"
  value?: string
}

export interface SwitchNode extends NodeBase {
  type: "switch"
  expression: string           // expression to evaluate
  cases: SwitchCase[]
  fallthrough?: boolean        // if no case matches, continue anyway
}

export interface SwitchCase {
  value: string
  port: string                 // port name e.g. "case_0", "case_1"
  label?: string
}

export interface LoopNode extends NodeBase {
  type: "loop"
  inputExpression: string      // array expression to iterate over
  batchSize?: number           // process N items at a time
  maxIterations?: number
}

export interface MergeNode extends NodeBase {
  type: "merge"
  mode: "wait-all" | "first-wins" | "append"
  inputCount: number           // how many incoming branches to wait for
}

export interface SplitNode extends NodeBase {
  type: "split"
  outputCount: number          // number of parallel outputs
}

export interface WaitNode extends NodeBase {
  type: "wait"
  waitMode: "duration" | "until-time" | "webhook"
  durationMs?: number
  untilTime?: string
  webhookPath?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface SetVariablesNode extends NodeBase {
  type: "set-variables"
  assignments: Array<{ name: string; value: string }>  // value is an expression
}

export interface CodeNode extends NodeBase {
  type: "code"
  language: "javascript"
  code: string                 // runs in sandboxed Function(code)
  inputExpression?: string
}

export interface FormatNode extends NodeBase {
  type: "format"
  template: string             // handlebars-style template with {{expressions}}
  outputFormat?: "text" | "markdown" | "json" | "html"
}

export interface FilterNode extends NodeBase {
  type: "filter"
  expression: string           // expression that returns boolean per item
  mode?: "keep" | "remove"
}

export interface SortNode extends NodeBase {
  type: "sort"
  field: string
  direction?: "asc" | "desc"
}

export interface DedupeNode extends NodeBase {
  type: "dedupe"
  field: string                // field to deduplicate by
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface TelegramOutputNode extends NodeBase {
  type: "telegram-output"
  chatIds?: string[]
  messageTemplate?: string
  parseMode?: "markdown" | "html" | "plain"
  inputExpression?: string
}

export interface DiscordOutputNode extends NodeBase {
  type: "discord-output"
  webhookUrls?: string[]
  messageTemplate?: string
  inputExpression?: string
}

export interface EmailOutputNode extends NodeBase {
  type: "email-output"
  recipients?: string[]
  subject?: string
  messageTemplate?: string
  format?: "text" | "html"
  inputExpression?: string
}

export interface WebhookOutputNode extends NodeBase {
  type: "webhook-output"
  url: string
  method?: "POST" | "PUT"
  headers?: Record<string, string>
  bodyTemplate?: string
  inputExpression?: string
}

export interface SlackOutputNode extends NodeBase {
  type: "slack-output"
  channel?: string
  messageTemplate?: string
  inputExpression?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface StickyNoteNode extends NodeBase {
  type: "sticky-note"
  content: string
  color?: string
}

export interface AgentRetryPolicy {
  maxAttempts: number
  backoffMs: number
}

interface AgentNodeBase extends NodeBase {
  agentId: string
  goal: string
  inputMapping?: Record<string, string>
  outputSchema?: string
  timeoutMs?: number
  retryPolicy?: AgentRetryPolicy
  reads?: string[]
  writes?: string[]
}

export interface AgentSupervisorNode extends AgentNodeBase {
  type: "agent-supervisor"
  role: "operator"
}

export interface AgentWorkerNode extends AgentNodeBase {
  type: "agent-worker"
  role: OrgChartWorkerRole
  domain?: WorkerDomain
}

export interface AgentHandoffNode extends NodeBase {
  type: "agent-handoff"
  fromAgentId: string
  toAgentId: string
  reason: string
}

export interface AgentStateReadNode extends NodeBase {
  type: "agent-state-read"
  key: string
  required?: boolean
}

export interface AgentStateWriteNode extends NodeBase {
  type: "agent-state-write"
  key: string
  valueExpression: string
  writeMode?: "replace" | "merge" | "append"
}

export interface AgentSubworkflowNode extends NodeBase {
  type: "agent-subworkflow"
  missionId: string
  inputMapping?: Record<string, string>
  waitForCompletion?: boolean
}

export interface ProviderSelectorNode extends NodeBase {
  type: "provider-selector"
  allowedProviders: Provider[]
  defaultProvider: Provider
  strategy?: "policy" | "latency" | "cost" | "quality"
}

export interface AgentAuditNode extends AgentNodeBase {
  type: "agent-audit"
  role: AuditAgentRole
  requiredChecks: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated Union
// ─────────────────────────────────────────────────────────────────────────────

export type MissionNode =
  // Triggers
  | ScheduleTriggerNode
  | WebhookTriggerNode
  | ManualTriggerNode
  | EventTriggerNode
  // Data
  | HttpRequestNode
  | WebSearchNode
  | RssFeedNode
  | CoinbaseNode
  | FileReadNode
  | FormInputNode
  // AI
  | AiSummarizeNode
  | AiClassifyNode
  | AiExtractNode
  | AiGenerateNode
  | AiChatNode
  // Logic
  | ConditionNode
  | SwitchNode
  | LoopNode
  | MergeNode
  | SplitNode
  | WaitNode
  // Transform
  | SetVariablesNode
  | CodeNode
  | FormatNode
  | FilterNode
  | SortNode
  | DedupeNode
  // Output
  | TelegramOutputNode
  | DiscordOutputNode
  | EmailOutputNode
  | WebhookOutputNode
  | SlackOutputNode
  // Utility
  | StickyNoteNode
  // Agent Orchestration
  | AgentSupervisorNode
  | AgentWorkerNode
  | AgentHandoffNode
  | AgentStateReadNode
  | AgentStateWriteNode
  | AgentSubworkflowNode
  | ProviderSelectorNode
  | AgentAuditNode

export type MissionNodeType = MissionNode["type"]

// ─────────────────────────────────────────────────────────────────────────────
// DAG Connections
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionConnection {
  id: string
  sourceNodeId: string
  /** "main" | "error" | "true" | "false" | "case_0" etc. */
  sourcePort: string
  targetNodeId: string
  targetPort?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission Variables & Settings
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionVariable {
  name: string
  value: string
  type: "string" | "number" | "boolean"
  description?: string
}

export interface MissionSettings {
  timezone: string
  retryOnFail: boolean
  retryCount: number
  retryIntervalMs: number
  saveExecutionProgress: boolean
  errorWorkflowId?: string
}

export function defaultMissionSettings(): MissionSettings {
  return {
    timezone: getRuntimeTimezone(),
    retryOnFail: false,
    retryCount: 2,
    retryIntervalMs: 5000,
    saveExecutionProgress: true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Mission Entity
// ─────────────────────────────────────────────────────────────────────────────

export interface Mission {
  id: string
  userId: string
  label: string
  description: string
  category: MissionCategory
  tags: string[]
  status: MissionStatus
  version: number
  nodes: MissionNode[]
  connections: MissionConnection[]
  variables: MissionVariable[]
  settings: MissionSettings
  // execution metadata
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastSentLocalDate?: string
  runCount: number
  successCount: number
  failureCount: number
  lastRunStatus?: "success" | "error" | "skipped"
  // runtime-only calendar override injected from reschedule-store for execution gating
  // (not persisted in the mission graph as a primary source of truth)
  scheduledAtOverride?: string  // ISO8601 UTC
  // delivery routing metadata
  integration: string
  chatIds: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeOutput {
  ok: boolean
  data?: unknown
  text?: string
  items?: unknown[]
  error?: string
  errorCode?: string
  artifactRef?: string
}

export interface ExecutionContext {
  missionId: string
  missionLabel: string
  runId: string
  runKey?: string
  attempt: number
  now: Date
  runSource: "scheduler" | "trigger" | "manual"
  lastRunAt?: string
  mission?: Mission
  nodeOutputs: Map<string, NodeOutput>
  variables: Record<string, string>
  scope?: IntegrationsStoreScope
  userContextId?: string
  conversationId?: string
  sessionKey?: string
  skillSnapshot?: {
    version: string
    createdAt: string
    skillCount: number
    guidance: string
  }
  resolveExpr: (template: string) => string
  onNodeTrace?: (trace: NodeExecutionTrace) => void | Promise<void>
  agentState?: AgentStateEnvelope
}

export interface NodeExecutionTrace {
  nodeId: string
  nodeType: string
  label: string
  status: "running" | "completed" | "failed" | "skipped"
  detail?: string
  errorCode?: string
  artifactRef?: string
  retryCount?: number
  startedAt: string
  endedAt?: string
}

/**
 * Pre-claimed execution slot from execution-tick.
 * When provided, executeMissionCore skips enqueue+claim (already done by the tick).
 */
export interface PreClaimedSlot {
  jobRunId: string
  leaseToken: string
  reportOutcome: (success: boolean, errorDetail?: string) => void
  release: () => Promise<void>
}

export interface ExecuteMissionInput {
  mission: Mission
  source: "scheduler" | "trigger" | "manual"
  now?: Date
  enforceOutputTime?: boolean
  missionRunId?: string
  runKey?: string
  attempt?: number
  scope?: IntegrationsStoreScope
  userContextId?: string
  conversationId?: string
  sessionKey?: string
  skillSnapshot?: {
    version: string
    createdAt: string
    skillCount: number
    guidance: string
  }
  onNodeTrace?: (trace: NodeExecutionTrace) => void | Promise<void>
  /** When set, executeMissionCore bypasses acquireMissionExecutionSlot — slot pre-claimed by execution-tick. */
  preClaimedSlot?: PreClaimedSlot
}

export interface ExecuteMissionResult {
  ok: boolean
  skipped: boolean
  reason?: string
  outputs: Array<{ ok: boolean; error?: string; status?: number }>
  nodeTraces: NodeExecutionTrace[]
}

export interface MissionScheduleGate {
  due: boolean
  dayStamp: string
  mode: string
  timezone?: string
}

export interface AgentStateWriteAuditEntry {
  key: string
  nodeId: string
  agentId?: string
  occurredAt: string
}

export interface AgentStateEnvelope {
  stateVersion: "phase0"
  userContextId: string
  conversationId: string
  sessionKey: string
  missionId: string
  runId: string
  keys: Record<string, unknown>
  declaredKeys: string[]
  writePolicies: Record<string, string[]>
  auditTrail: AgentStateWriteAuditEntry[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Fetch Types (unchanged from V.25 — used by executors)
// ─────────────────────────────────────────────────────────────────────────────

export interface WebDocumentResult {
  ok: boolean
  status: number
  finalUrl: string
  title: string
  text: string
  links: Array<{ href: string; text: string }>
  error?: string
}

export interface WebSearchResult {
  url: string
  title: string
  snippet: string
  ok: boolean
  status: number
  pageTitle?: string
  pageText?: string
  error?: string
}

export interface WebSearchResponse {
  searchUrl: string
  query: string
  searchTitle: string
  searchText: string
  provider: string
  results: WebSearchResult[]
}

export interface OutputResult {
  ok: boolean
  error?: string
  status?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder compatibility types used by the mission editor and autofix flows
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use MissionNodeType instead */
export type WorkflowStepType = "trigger" | "fetch" | "coinbase" | "ai" | "transform" | "condition" | "output"

/** @deprecated Use MissionNode union instead */
export interface WorkflowStep {
  id?: string
  type?: WorkflowStepType | string
  title?: string
  aiPrompt?: string
  aiModel?: string
  aiIntegration?: "openai" | "claude" | "grok" | "gemini" | string
  aiDetailLevel?: "concise" | "standard" | "detailed" | string
  triggerMode?: "once" | "daily" | "weekly" | "interval" | string
  triggerTime?: string
  triggerTimezone?: string
  triggerDays?: string[]
  triggerIntervalMinutes?: string
  fetchSource?: "api" | "web" | "calendar" | "crypto" | "coinbase" | "rss" | "database" | string
  fetchMethod?: "GET" | "POST" | string
  fetchApiIntegrationId?: string
  fetchUrl?: string
  fetchQuery?: string
  fetchHeaders?: string
  fetchSelector?: string
  fetchRefreshMinutes?: string
  fetchIncludeSources?: boolean | string
  coinbaseIntent?: "status" | "price" | "portfolio" | "transactions" | "report" | string
  coinbaseParams?: {
    assets?: string[]
    quoteCurrency?: string
    thresholdPct?: number
    cadence?: "daily" | "weekly" | string
    transactionLimit?: number
    includePreviousArtifactContext?: boolean
  }
  coinbaseFormat?: {
    style?: "concise" | "standard" | "detailed" | string
    includeRawMetadata?: boolean
  }
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich" | string
  transformFormat?: "text" | "json" | "markdown" | "table" | string
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | string
  conditionValue?: string
  conditionLogic?: "all" | "any" | string
  conditionFailureAction?: "skip" | "notify" | "stop" | string
  outputChannel?: "telegram" | "discord" | "email" | "slack" | "push" | "webhook" | string
  outputTiming?: "immediate" | "scheduled" | "digest" | string
  outputTime?: string
  outputFrequency?: "once" | "multiple" | string
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

/** @deprecated Use Mission instead */
export interface WorkflowSummary {
  description?: string
  priority?: string
  schedule?: {
    mode?: string
    days?: string[]
    time?: string
    timezone?: string
    windowMinutes?: number
  }
  missionActive?: boolean
  tags?: string[]
  apiCalls?: string[]
  coinbase?: CoinbaseMissionParams
  workflowSteps?: WorkflowStep[]
}

/** @deprecated Use Mission instead */
export interface ParsedWorkflow {
  description: string
  summary: WorkflowSummary | null
}

export type CoinbaseMissionPrimitive =
  | "daily_portfolio_summary"
  | "price_alert_digest"
  | "weekly_pnl_summary"

export interface CoinbaseMissionParams {
  primitive?: CoinbaseMissionPrimitive
  assets?: string[]
  thresholdPct?: number
  cadence?: "daily" | "weekly" | string
  timezone?: string
  deliveryChannel?: "telegram" | "discord" | "email" | "slack" | "push" | "webhook" | string
  quoteCurrency?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Completion Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionResult {
  provider: Provider
  model: string
  text: string
}

export interface CompletionOverride {
  provider?: Provider
  model?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution trace compatibility types used by trigger/scheduler APIs
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use NodeExecutionTrace instead */
export interface WorkflowStepTrace {
  stepId: string
  type: string
  title: string
  status: "running" | "completed" | "failed" | "skipped"
  detail?: string
  errorCode?: string
  artifactRef?: string
  retryCount?: number
  startedAt: string
  endedAt?: string
}

export interface WorkflowScheduleGate {
  due: boolean
  dayStamp: string
  mode: string
  timezone?: string
}

