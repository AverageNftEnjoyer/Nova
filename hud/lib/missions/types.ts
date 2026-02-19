/**
 * Mission Runtime Type Definitions
 *
 * All type definitions for the mission workflow system.
 */

import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import type { NotificationSchedule } from "@/lib/notifications/store"

// ─────────────────────────────────────────────────────────────────────────────
// Provider Types
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "openai" | "claude" | "grok" | "gemini"

export type WorkflowStepType = "trigger" | "fetch" | "ai" | "transform" | "condition" | "output"

export type AiDetailLevel = "concise" | "standard" | "detailed"

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Step Definition
// ─────────────────────────────────────────────────────────────────────────────

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
  fetchSource?: "api" | "web" | "calendar" | "crypto" | "rss" | "database" | string
  fetchMethod?: "GET" | "POST" | string
  fetchApiIntegrationId?: string
  fetchUrl?: string
  fetchQuery?: string
  fetchHeaders?: string
  fetchSelector?: string
  fetchRefreshMinutes?: string
  fetchIncludeSources?: boolean | string
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich" | string
  transformFormat?: "text" | "json" | "markdown" | "table" | string
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | string
  conditionValue?: string
  conditionLogic?: "all" | "any" | string
  conditionFailureAction?: "skip" | "notify" | "stop" | string
  outputChannel?: "novachat" | "telegram" | "discord" | "email" | "push" | "webhook" | string
  outputTiming?: "immediate" | "scheduled" | "digest" | string
  outputTime?: string
  outputFrequency?: "once" | "multiple" | string
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Summary & Parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowSummary {
  description?: string
  priority?: string
  schedule?: {
    mode?: string
    days?: string[]
    time?: string
    timezone?: string
  }
  missionActive?: boolean
  tags?: string[]
  apiCalls?: string[]
  workflowSteps?: WorkflowStep[]
}

export interface ParsedWorkflow {
  description: string
  summary: WorkflowSummary | null
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
// Workflow Execution Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteMissionWorkflowInput {
  schedule: NotificationSchedule
  source: "scheduler" | "trigger"
  now?: Date
  enforceOutputTime?: boolean
  scope?: IntegrationsStoreScope
  skillSnapshot?: {
    version: string
    createdAt: string
    skillCount: number
    guidance: string
  }
  onStepTrace?: (trace: WorkflowStepTrace) => void | Promise<void>
}

export interface ExecuteMissionWorkflowResult {
  ok: boolean
  skipped: boolean
  outputs: Array<{ ok: boolean; error?: string; status?: number }>
  reason?: string
  stepTraces: WorkflowStepTrace[]
}

export interface WorkflowScheduleGate {
  due: boolean
  dayStamp: string
  mode: string
  timezone?: string
}

export interface WorkflowStepTrace {
  stepId: string
  type: string
  title: string
  status: "running" | "completed" | "failed" | "skipped"
  detail?: string
  startedAt: string
  endedAt?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Fetch Types
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

// ─────────────────────────────────────────────────────────────────────────────
// Output Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OutputResult {
  ok: boolean
  error?: string
  status?: number
}
