import "server-only"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { dispatchNotification, type NotificationIntegration } from "@/lib/notifications/dispatcher"
import type { NotificationSchedule } from "@/lib/notifications/store"

export const WORKFLOW_MARKER = "[NOVA WORKFLOW]"

type Provider = "openai" | "claude" | "grok" | "gemini"

type WorkflowStepType = "trigger" | "fetch" | "ai" | "transform" | "condition" | "output"

export interface WorkflowStep {
  id?: string
  type?: WorkflowStepType | string
  title?: string
  aiPrompt?: string
  aiModel?: string
  aiIntegration?: "openai" | "claude" | "grok" | "gemini" | string
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
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich" | string
  transformFormat?: "text" | "json" | "markdown" | "table" | string
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists" | string
  conditionValue?: string
  conditionLogic?: "all" | "any" | string
  conditionFailureAction?: "skip" | "notify" | "stop" | string
  outputChannel?: "telegram" | "discord" | "email" | "push" | "webhook" | string
  outputTiming?: "immediate" | "scheduled" | "digest" | string
  outputTime?: string
  outputFrequency?: "once" | "multiple" | string
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

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

interface CompletionResult {
  provider: Provider
  model: string
  text: string
}

interface ExecuteMissionWorkflowInput {
  schedule: NotificationSchedule
  source: "scheduler" | "trigger"
  now?: Date
  enforceOutputTime?: boolean
}

interface ExecuteMissionWorkflowResult {
  ok: boolean
  skipped: boolean
  outputs: Array<{ ok: boolean; error?: string; status?: number }>
  reason?: string
}

interface WorkflowScheduleGate {
  due: boolean
  dayStamp: string
  mode: string
}

function toOpenAiLikeBase(url: string, fallback: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return fallback
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

function toClaudeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.anthropic.com"
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed
}

function stripCodeFences(raw: string): string {
  const text = raw.trim()
  const block = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return block ? block[1].trim() : text
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripCodeFences(raw)
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function getByPath(input: unknown, path: string): unknown {
  const parts = String(path || "").split(".").map((p) => p.trim()).filter(Boolean)
  let cur: unknown = input
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function toNumberSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeWorkflowStep(raw: WorkflowStep, index: number): WorkflowStep {
  const type = String(raw.type || "output").toLowerCase()
  const stepType: WorkflowStepType =
    type === "trigger" || type === "fetch" || type === "ai" || type === "transform" || type === "condition" || type === "output"
      ? (type as WorkflowStepType)
      : "output"
  return {
    ...raw,
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `step-${index + 1}`,
    type: stepType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : stepType,
  }
}

function parseHeadersJson(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k).trim()
      const value = String(v ?? "").trim()
      if (key && value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const value = getByPath(context, key)
    if (value === null || typeof value === "undefined") return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  })
}

function getLocalTimeParts(date: Date, timezone: string): { hour: number; minute: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return { hour, minute }
  } catch {
    return null
  }
}

function getLocalParts(date: Date, timezone: string): { hour: number; minute: number; dayStamp: string; weekday: string } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))
    const year = lookup.get("year")
    const month = lookup.get("month")
    const day = lookup.get("day")
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    const weekdayRaw = String(lookup.get("weekday") || "").toLowerCase()
    const weekday = weekdayRaw.startsWith("mon")
      ? "mon"
      : weekdayRaw.startsWith("tue")
        ? "tue"
        : weekdayRaw.startsWith("wed")
          ? "wed"
          : weekdayRaw.startsWith("thu")
            ? "thu"
            : weekdayRaw.startsWith("fri")
              ? "fri"
              : weekdayRaw.startsWith("sat")
                ? "sat"
                : "sun"
    if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return {
      hour,
      minute,
      dayStamp: `${year}-${month}-${day}`,
      weekday,
    }
  } catch {
    return null
  }
}

function parseTime(value: string | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function toTextPayload(data: unknown): string {
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  if (!data) return ""
  try {
    const text = JSON.stringify(data, null, 2)
    return text.length > 8000 ? `${text.slice(0, 8000)}\n...` : text
  } catch {
    return String(data)
  }
}

export async function completeWithConfiguredLlm(systemText: string, userText: string, maxTokens = 1200): Promise<CompletionResult> {
  const config = await loadIntegrationsConfig()
  const provider: Provider = config.activeLlmProvider

  if (provider === "claude") {
    const apiKey = config.claude.apiKey.trim()
    const model = config.claude.defaultModel.trim()
    const baseUrl = toClaudeBase(config.claude.baseUrl)
    if (!apiKey) throw new Error("Claude API key is missing.")
    if (!model) throw new Error("Claude default model is missing.")

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemText,
        messages: [{ role: "user", content: userText }],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Claude request failed (${res.status}).`)
    }
    const text = Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> }).content)
      ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
      : ""
    return { provider, model, text: String(text || "").trim() }
  }

  if (provider === "grok") {
    const apiKey = config.grok.apiKey.trim()
    const model = config.grok.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.grok.baseUrl, "https://api.x.ai/v1")
    if (!apiKey) throw new Error("Grok API key is missing.")
    if (!model) throw new Error("Grok default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Grok request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  if (provider === "gemini") {
    const apiKey = config.gemini.apiKey.trim()
    const model = config.gemini.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai")
    if (!apiKey) throw new Error("Gemini API key is missing.")
    if (!model) throw new Error("Gemini default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Gemini request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  const apiKey = config.openai.apiKey.trim()
  const model = config.openai.defaultModel.trim()
  const baseUrl = toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")
  if (!apiKey) throw new Error("OpenAI API key is missing.")
  if (!model) throw new Error("OpenAI default model is missing.")

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
    cache: "no-store",
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message || "")
      : ""
    throw new Error(msg || `OpenAI request failed (${res.status}).`)
  }
  const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
  return { provider: "openai", model, text: text.trim() }
}

async function dispatchOutput(channel: string, text: string, targets: string[] | undefined, schedule: NotificationSchedule): Promise<Array<{ ok: boolean; error?: string; status?: number }>> {
  if (channel === "discord" || channel === "telegram") {
    return dispatchNotification({
      integration: channel as NotificationIntegration,
      text,
      targets,
      source: "workflow",
      scheduleId: schedule.id,
      label: schedule.label,
    })
  }

  if (channel === "webhook") {
    const urls = (targets || []).map((t) => String(t || "").trim()).filter(Boolean)
    if (!urls.length) {
      return [{ ok: false, error: "Webhook output requires at least one URL in recipients." }]
    }
    const results = await Promise.all(urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            scheduleId: schedule.id,
            label: schedule.label,
            ts: new Date().toISOString(),
          }),
        })
        return { ok: res.ok, status: res.status, error: res.ok ? undefined : `Webhook returned ${res.status}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Webhook send failed" }
      }
    }))
    return results
  }

  return [{ ok: false, error: `Unsupported output channel: ${channel}` }]
}

export function parseMissionWorkflow(message: string): ParsedWorkflow {
  const raw = String(message || "")
  const idx = raw.indexOf(WORKFLOW_MARKER)
  const description = idx < 0 ? raw.trim() : raw.slice(0, idx).trim()
  if (idx < 0) return { description, summary: null }

  const maybe = parseJsonObject(raw.slice(idx + WORKFLOW_MARKER.length))
  if (!maybe) return { description, summary: null }

  const summary = maybe as unknown as WorkflowSummary
  const stepsRaw = Array.isArray(summary.workflowSteps) ? summary.workflowSteps : []
  summary.workflowSteps = stepsRaw.map((s, i) => normalizeWorkflowStep(s, i))
  return { description, summary }
}

export function shouldWorkflowRunNow(schedule: NotificationSchedule, now: Date): WorkflowScheduleGate {
  const parsed = parseMissionWorkflow(schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const trigger = steps.find((s) => String(s.type || "").toLowerCase() === "trigger")
  const timezone = String(
    trigger?.triggerTimezone ||
    parsed.summary?.schedule?.timezone ||
    schedule.timezone ||
    "America/New_York",
  ).trim() || "America/New_York"
  const local = getLocalParts(now, timezone)
  if (!local) return { due: false, dayStamp: "", mode: "daily" }

  const mode = String(trigger?.triggerMode || parsed.summary?.schedule?.mode || "daily").toLowerCase()
  const timeString = String(trigger?.triggerTime || parsed.summary?.schedule?.time || schedule.time || "09:00").trim()
  const target = parseTime(timeString)
  if ((mode === "daily" || mode === "weekly" || mode === "once") && !target) {
    return { due: false, dayStamp: local.dayStamp, mode }
  }

  if (mode === "interval") {
    const every = Math.max(1, Number(trigger?.triggerIntervalMinutes || "30") || 30)
    const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { due: true, dayStamp: local.dayStamp, mode }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    return { due: minutesSince >= every, dayStamp: local.dayStamp, mode }
  }

  const sameMinute = local.hour === (target?.hour ?? -1) && local.minute === (target?.minute ?? -1)
  if (!sameMinute) return { due: false, dayStamp: local.dayStamp, mode }

  if (mode === "weekly" || mode === "once") {
    const days = Array.isArray(trigger?.triggerDays)
      ? trigger!.triggerDays!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : Array.isArray(parsed.summary?.schedule?.days)
        ? parsed.summary!.schedule!.days!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        : []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { due: false, dayStamp: local.dayStamp, mode }
    }
  }

  return { due: true, dayStamp: local.dayStamp, mode }
}

export async function buildWorkflowFromPrompt(prompt: string): Promise<{ workflow: { label: string; integration: string; summary: WorkflowSummary }; provider: Provider; model: string }> {
  const catalog = await loadIntegrationCatalog()
  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean)
  const outputOptions = catalog.filter((item) => item.kind === "channel" && item.connected).map((item) => item.id).filter(Boolean)
  const apiIntegrations = catalog
    .filter((item) => item.kind === "api" && item.connected && item.endpoint)
    .map((item) => ({ id: item.id, label: item.label, endpoint: item.endpoint as string }))

  const systemText = [
    "You are Nova's workflow architect. Build production-grade automation workflows.",
    "Return only strict JSON.",
    "Design complete, executable workflows with trigger, fetch, transform/ai, condition, and output steps when relevant.",
    "Use 24h HH:mm time and realistic defaults.",
    `Connected AI providers: ${llmOptions.join(", ") || "openai"}.`,
    `Connected output channels: ${outputOptions.join(", ") || "telegram, discord, webhook"}.`,
    `Configured API integrations: ${apiIntegrations.length > 0 ? JSON.stringify(apiIntegrations) : "none"}.`,
    "If you build fetch steps for source=api, prefer fetchApiIntegrationId + fetchUrl using configured integrations.",
  ].join(" ")

  const userText = [
    `User prompt: ${prompt}`,
    "Return JSON with this exact shape:",
    JSON.stringify({
      label: "",
      description: "",
      integration: "telegram",
      priority: "medium",
      schedule: { mode: "daily", days: ["mon", "tue", "wed", "thu", "fri"], time: "09:00", timezone: "America/New_York" },
      tags: ["automation"],
      workflowSteps: [
        { type: "trigger", title: "Mission triggered", triggerMode: "daily", triggerTime: "09:00", triggerTimezone: "America/New_York", triggerDays: ["mon", "tue", "wed", "thu", "fri"] },
        { type: "fetch", title: "Fetch data", fetchSource: "crypto", fetchMethod: "GET", fetchApiIntegrationId: "", fetchUrl: "", fetchQuery: "", fetchSelector: "", fetchHeaders: "" },
        { type: "ai", title: "Summarize report", aiPrompt: "", aiIntegration: "openai", aiModel: "" },
        { type: "condition", title: "Check threshold", conditionField: "", conditionOperator: "greater_than", conditionValue: "", conditionLogic: "all", conditionFailureAction: "skip" },
        { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "scheduled", outputTime: "09:00", outputFrequency: "once", outputRecipients: "" }
      ]
    }),
  ].join("\n")

  const completion = await completeWithConfiguredLlm(systemText, userText, 1800)
  const parsed = parseJsonObject(completion.text)
  if (!parsed) {
    throw new Error("Nova returned invalid workflow JSON.")
  }

  const label = cleanText(String(parsed.label || "")) || "Generated Workflow"
  const description = cleanText(String(parsed.description || "")) || cleanText(prompt)
  const integrationRaw = cleanText(String(parsed.integration || "telegram")).toLowerCase() || "telegram"
  const priority = cleanText(String(parsed.priority || "medium")).toLowerCase() || "medium"

  const scheduleObj = parsed.schedule && typeof parsed.schedule === "object" ? (parsed.schedule as Record<string, unknown>) : {}
  const schedule = {
    mode: String(scheduleObj.mode || "daily").trim() || "daily",
    days: Array.isArray(scheduleObj.days) ? scheduleObj.days.map((d) => String(d).trim()).filter(Boolean) : ["mon", "tue", "wed", "thu", "fri"],
    time: String(scheduleObj.time || "09:00").trim() || "09:00",
    timezone: String(scheduleObj.timezone || "America/New_York").trim() || "America/New_York",
  }

  const stepsRaw = Array.isArray(parsed.workflowSteps)
    ? parsed.workflowSteps.map((step, index) => normalizeWorkflowStep((step || {}) as WorkflowStep, index))
    : []

  const llmSet = new Set(llmOptions.length > 0 ? llmOptions : ["openai", "claude", "grok", "gemini"])
  const defaultLlm = llmOptions[0] || "openai"
  const outputSet = new Set(outputOptions.length > 0 ? outputOptions : ["telegram", "discord", "webhook"])
  const defaultOutput = outputOptions[0] || "telegram"
  const integration = outputSet.has(integrationRaw) ? integrationRaw : defaultOutput
  const apiById = new Map(apiIntegrations.map((item) => [item.id, item.endpoint]))

  const steps = stepsRaw.map((step) => {
    if (step.type === "ai") {
      const provider = String(step.aiIntegration || "").trim().toLowerCase()
      if (!llmSet.has(provider)) {
        step.aiIntegration = defaultLlm
      }
      return step
    }
    if (step.type === "output") {
      const channel = String(step.outputChannel || "").trim().toLowerCase()
      if (!outputSet.has(channel)) {
        step.outputChannel = defaultOutput
      }
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "api") {
      const apiId = String(step.fetchApiIntegrationId || "").trim()
      if (apiId && apiById.has(apiId) && !String(step.fetchUrl || "").trim()) {
        step.fetchUrl = String(apiById.get(apiId) || "")
      }
      if (!apiId && step.fetchUrl) {
        const byEndpoint = apiIntegrations.find((item) => String(item.endpoint).trim() === String(step.fetchUrl || "").trim())
        if (byEndpoint) step.fetchApiIntegrationId = byEndpoint.id
      }
      return step
    }
    return step
  })

  const derivedApiCalls = Array.from(
    new Set(
      steps.flatMap((step) => {
        if (step.type === "fetch") {
          if (step.fetchApiIntegrationId) return [`INTEGRATION:${step.fetchApiIntegrationId}`]
          if (step.fetchUrl?.trim()) return [`${String(step.fetchMethod || "GET").toUpperCase()} ${step.fetchUrl.trim()}`]
          return [`FETCH:${step.fetchSource || "api"}`]
        }
        if (step.type === "ai") return [`LLM:${step.aiIntegration || defaultLlm}`]
        if (step.type === "output") return [`OUTPUT:${step.outputChannel || defaultOutput}`]
        return []
      }),
    ),
  )

  const summary: WorkflowSummary = {
    description,
    priority,
    schedule,
    missionActive: true,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    apiCalls: derivedApiCalls,
    workflowSteps: steps.length > 0 ? steps : [
      normalizeWorkflowStep({ type: "trigger", title: "Mission triggered", triggerMode: "daily", triggerTime: schedule.time, triggerTimezone: schedule.timezone, triggerDays: schedule.days }, 0),
      normalizeWorkflowStep({ type: "output", title: "Send notification", outputChannel: outputSet.has(integration) ? integration : defaultOutput, outputTiming: "scheduled", outputTime: schedule.time, outputFrequency: "once" }, 1),
    ],
  }

  return {
    workflow: {
      label,
      integration,
      summary,
    },
    provider: completion.provider,
    model: completion.model,
  }
}

export async function executeMissionWorkflow(input: ExecuteMissionWorkflowInput): Promise<ExecuteMissionWorkflowResult> {
  const now = input.now ?? new Date()
  const parsed = parseMissionWorkflow(input.schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const integrationCatalog = await loadIntegrationCatalog()
  const apiEndpointById = new Map(
    integrationCatalog
      .filter((item) => item.kind === "api" && item.connected && item.endpoint)
      .map((item) => [item.id, String(item.endpoint || "").trim()]),
  )

  const context: Record<string, unknown> = {
    mission: {
      id: input.schedule.id,
      label: input.schedule.label,
      integration: input.schedule.integration,
      time: input.schedule.time,
      timezone: input.schedule.timezone,
      source: input.source,
    },
    description: parsed.description,
    summary: parsed.summary || {},
    nowIso: now.toISOString(),
    data: null,
    ai: null,
  }

  let skipped = false
  let skipReason = ""
  let outputs: Array<{ ok: boolean; error?: string; status?: number }> = []

  for (const step of steps) {
    const type = String(step.type || "").toLowerCase()

    if (type === "trigger") {
      context.trigger = {
        mode: step.triggerMode || "daily",
        time: step.triggerTime || input.schedule.time,
        timezone: step.triggerTimezone || input.schedule.timezone,
      }
      continue
    }

    if (type === "fetch") {
      const source = String(step.fetchSource || "api").toLowerCase()
      const method = String(step.fetchMethod || "GET").toUpperCase() === "POST" ? "POST" : "GET"
      let url = String(step.fetchUrl || "").trim()
      if (!url && source === "api") {
        const apiId = String(step.fetchApiIntegrationId || "").trim()
        if (apiId && apiEndpointById.has(apiId)) {
          url = String(apiEndpointById.get(apiId) || "")
        }
      }
      if (!url && source === "crypto") url = "https://api.coingecko.com/api/v3/global"
      if (!url && source === "calendar") url = "/api/calendar/events"
      if (!url && source === "rss") url = "https://feeds.feedburner.com/coindesk"
      if (!url) {
        context.data = { source, error: "No fetch URL configured." }
        continue
      }

      const headers = parseHeadersJson(step.fetchHeaders)
      const query = String(step.fetchQuery || "").trim()
      const queryPrefix = query && !url.includes("?") ? "?" : query ? "&" : ""
      const requestUrl = url.startsWith("http") ? `${url}${queryPrefix}${query}` : `http://localhost:3000${url}${queryPrefix}${query}`

      try {
        const res = await fetch(requestUrl, {
          method,
          headers: {
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
            ...headers,
          },
          body: method === "POST" ? JSON.stringify({ query, scheduleId: input.schedule.id }) : undefined,
          cache: "no-store",
        })

        const contentType = String(res.headers.get("content-type") || "")
        let payload: unknown
        if (contentType.includes("application/json")) {
          payload = await res.json().catch(() => null)
        } else {
          payload = await res.text().catch(() => "")
          if (source === "web" && step.fetchSelector && typeof payload === "string") {
            const selector = step.fetchSelector.trim()
            const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(selector)
            const classMatch = /^\.([A-Za-z0-9_-]+)$/.exec(selector)
            if (idMatch) {
              const id = idMatch[1]
              const rx = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(payload)
              payload = match ? cleanText(match[1].replace(/<[^>]+>/g, " ")) : payload
            } else if (classMatch) {
              const cls = classMatch[1]
              const rx = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(payload)
              payload = match ? cleanText(match[1].replace(/<[^>]+>/g, " ")) : payload
            }
          }
        }

        context.data = { source, url: requestUrl, status: res.status, ok: res.ok, payload }
      } catch (error) {
        context.data = { source, url: requestUrl, error: error instanceof Error ? error.message : "fetch failed" }
      }
      continue
    }

    if (type === "transform") {
      const action = String(step.transformAction || "normalize").toLowerCase()
      const format = String(step.transformFormat || "markdown").toLowerCase()
      const inputData = context.data
      let outputData: unknown = inputData

      if (action === "dedupe" && Array.isArray(inputData)) {
        outputData = Array.from(new Map(inputData.map((item) => [JSON.stringify(item), item])).values())
      }
      if (action === "aggregate" && Array.isArray(inputData)) {
        outputData = { count: inputData.length, sample: inputData.slice(0, 5) }
      }
      if (action === "format") {
        const text = toTextPayload(inputData)
        outputData = format === "json" ? inputData : text
      }
      if (action === "normalize") {
        outputData = typeof inputData === "string" ? cleanText(inputData) : inputData
      }

      context.data = outputData
      continue
    }

    if (type === "condition") {
      const field = String(step.conditionField || "").trim()
      const operator = String(step.conditionOperator || "contains").trim()
      const expected = String(step.conditionValue || "")
      const value = field ? getByPath(context, field) : undefined

      let pass = true
      if (operator === "exists") {
        pass = typeof value !== "undefined" && value !== null && String(value).trim() !== ""
      } else if (operator === "equals") {
        pass = String(value ?? "") === expected
      } else if (operator === "not_equals") {
        pass = String(value ?? "") !== expected
      } else if (operator === "greater_than") {
        pass = (toNumberSafe(value) ?? Number.NEGATIVE_INFINITY) > (toNumberSafe(expected) ?? Number.POSITIVE_INFINITY)
      } else if (operator === "less_than") {
        pass = (toNumberSafe(value) ?? Number.POSITIVE_INFINITY) < (toNumberSafe(expected) ?? Number.NEGATIVE_INFINITY)
      } else if (operator === "regex") {
        try {
          pass = new RegExp(expected).test(String(value ?? ""))
        } catch {
          pass = false
        }
      } else {
        pass = String(value ?? "").toLowerCase().includes(expected.toLowerCase())
      }

      if (!pass) {
        const failure = String(step.conditionFailureAction || "skip").toLowerCase()
        if (failure === "stop") {
          return { ok: false, skipped: true, outputs, reason: "Condition failed with stop action." }
        }
        if (failure === "notify") {
          const warnText = `Mission \"${input.schedule.label}\" condition failed on field \"${field}\".`
          const notifyResults = await dispatchOutput(input.schedule.integration || "telegram", warnText, input.schedule.chatIds, input.schedule)
          outputs = outputs.concat(notifyResults)
        }
        skipped = true
        skipReason = "Condition check failed."
      }
      if (skipped) break
      continue
    }

    if (type === "ai") {
      const aiPrompt = String(step.aiPrompt || "").trim()
      if (!aiPrompt) continue
      const systemText = "You are Nova workflow AI. Execute this step with high precision. Return concise, actionable output."
      const userText = [
        `Step: ${step.title || "AI step"}`,
        `Instruction: ${aiPrompt}`,
        "Context JSON:",
        toTextPayload(context.data),
      ].join("\n\n")
      try {
        const completion = await completeWithConfiguredLlm(systemText, userText, 900)
        context.ai = completion.text
        context.lastAiProvider = completion.provider
        context.lastAiModel = completion.model
      } catch (error) {
        context.ai = `AI step failed: ${error instanceof Error ? error.message : "Unknown error"}`
      }
      continue
    }

    if (type === "output") {
      const channel = String(step.outputChannel || input.schedule.integration || "telegram").toLowerCase()
      const timing = String(step.outputTiming || "immediate").toLowerCase()
      const outputTime = String(step.outputTime || input.schedule.time || "").trim()
      if (input.enforceOutputTime && (timing === "scheduled" || timing === "digest")) {
        const target = parseTime(outputTime)
        const local = getLocalTimeParts(now, input.schedule.timezone || "America/New_York")
        if (target && local && (target.hour !== local.hour || target.minute !== local.minute)) {
          skipped = true
          skipReason = "Output timing does not match this tick."
          continue
        }
      }

      const rawTemplate = String(step.outputTemplate || "").trim()
      const baseText = rawTemplate
        ? interpolateTemplate(rawTemplate, context)
        : String(context.ai || parsed.description || input.schedule.message)

      const recipientString = String(step.outputRecipients || "").trim()
      const recipients = recipientString
        ? recipientString.split(/[,\n]/).map((r) => r.trim()).filter(Boolean)
        : input.schedule.chatIds

      const frequency = String(step.outputFrequency || "once").toLowerCase()
      const repeatCount = Math.max(1, Math.min(10, Number(step.outputRepeatCount || "1") || 1))
      const loops = frequency === "multiple" ? repeatCount : 1

      for (let i = 0; i < loops; i += 1) {
        const text = loops > 1 ? `${baseText}\n\n(${i + 1}/${loops})` : baseText
        const result = await dispatchOutput(channel, text, recipients, input.schedule)
        outputs = outputs.concat(result)
      }
      continue
    }
  }

  if (!steps.some((s) => String(s.type || "") === "output") && !skipped) {
    const fallbackText = String(context.ai || parsed.description || input.schedule.message)
    const result = await dispatchOutput(input.schedule.integration || "telegram", fallbackText, input.schedule.chatIds, input.schedule)
    outputs = outputs.concat(result)
  }

  if (skipped && outputs.length === 0) {
    return { ok: true, skipped: true, outputs: [], reason: skipReason || "Workflow skipped." }
  }

  const ok = outputs.some((r) => r.ok)
  return { ok, skipped: false, outputs, reason: ok ? undefined : "All workflow outputs failed." }
}
