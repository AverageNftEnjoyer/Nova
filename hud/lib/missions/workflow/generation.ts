/**
 * Workflow Generation
 *
 * Functions for generating workflows from prompts.
 */

import "server-only"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { cleanText, parseJsonObject } from "../text/cleaning"
import { generateShortTitle } from "../text/formatting"
import { normalizeWorkflowStep, normalizeOutputRecipientsForChannel } from "../utils/config"
import { isInvalidConditionFieldPath } from "../utils/validation"
import { extractSearchQueryFromUrl } from "../web/fetch"
import { isSearchLikeUrl } from "../web/quality"
import { completeWithConfiguredLlm } from "../llm/providers"
import { detectTopicsInPrompt, type DetectedTopic } from "../topics/detection"
import type { WorkflowStep, WorkflowSummary, Provider } from "../types"

/**
 * Check if prompt requests immediate output.
 */
export function promptRequestsImmediateOutput(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(now|immediately|immediate|right away|asap)\b/.test(text)
}

function normalizeScheduleTime(value: string): string {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim())
  if (!m) return ""
  return `${m[1].padStart(2, "0")}:${m[2]}`
}

function normalizePromptTextForExtraction(prompt: string): string {
  return cleanText(String(prompt || ""))
    .replace(/\bhey\s+nova\b/gi, " ")
    .replace(/\bnova\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractTimeFromPrompt(prompt: string): string {
  const text = normalizePromptTextForExtraction(prompt)
  const ampm = text.match(/\b([01]?\d)(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
  if (ampm) {
    const rawHour = Number.parseInt(ampm[1], 10)
    const minute = Number.parseInt(ampm[2] || "0", 10)
    const suffix = String(ampm[3] || "").toLowerCase()
    if (Number.isFinite(rawHour) && rawHour >= 1 && rawHour <= 12 && Number.isFinite(minute)) {
      let hour = rawHour % 12
      if (suffix.startsWith("p")) hour += 12
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    }
  }

  const hhmm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (hhmm) {
    const normalized = normalizeScheduleTime(`${hhmm[1]}:${hhmm[2]}`)
    if (normalized) return normalized
  }

  return ""
}

function extractTimezoneFromPrompt(prompt: string): string {
  const text = normalizePromptTextForExtraction(prompt)
  const tz = text.match(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\b/i)
  const token = String(tz?.[1] || "").toUpperCase()
  if (!token) return ""
  const map: Record<string, string> = {
    EST: "America/New_York",
    EDT: "America/New_York",
    ET: "America/New_York",
    CST: "America/Chicago",
    CDT: "America/Chicago",
    CT: "America/Chicago",
    MST: "America/Denver",
    MDT: "America/Denver",
    MT: "America/Denver",
    PST: "America/Los_Angeles",
    PDT: "America/Los_Angeles",
    PT: "America/Los_Angeles",
    UTC: "UTC",
    GMT: "Etc/UTC",
  }
  return map[token] || ""
}

function deriveScheduleFromPrompt(prompt: string): { time: string; timezone: string } {
  const time = extractTimeFromPrompt(prompt)
  const timezone = extractTimezoneFromPrompt(prompt)
  return { time, timezone }
}

function inferRequestedOutputChannel(
  prompt: string,
  outputSet: Set<string>,
  fallback: string,
): string {
  const text = normalizePromptTextForExtraction(prompt).toLowerCase()
  if (/\btelegram\b/.test(text) && outputSet.has("telegram")) return "telegram"
  if (/\bdiscord\b/.test(text) && outputSet.has("discord")) return "discord"
  if (/\b(webhook|http)\b/.test(text) && outputSet.has("webhook")) return "webhook"
  if (/\b(chat|nova ?chat|hud)\b/.test(text) && outputSet.has("novachat")) return "novachat"
  return fallback
}

function promptLooksLikeReminderTask(prompt: string): boolean {
  const text = normalizePromptTextForExtraction(prompt).toLowerCase()
  return (
    /\b(remind me to|reminder to|set a reminder|remember to|dont let me forget|don't let me forget)\b/.test(text) ||
    /\b(reminder)\b.*\b(pay|bill|loan|rent|deadline|due|appointment)\b/.test(text)
  )
}

function extractReminderBody(prompt: string): string {
  const text = normalizePromptTextForExtraction(prompt)
  const m =
    text.match(/\b(?:remind me to|reminder to|remember to|set a reminder to)\s+(.+)/i) ||
    text.match(/\breminder\b\s*(?:for|about)?\s*(.+)/i)
  const raw = String((m?.[1] || text) || "")
    .replace(/\b(at|by)\s+([01]?\d(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|[01]?\d:[0-5]\d)\b/gi, " ")
    .replace(/\b(every day|daily|every morning|every night|tomorrow|today)\b/gi, " ")
    .replace(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleanText(raw || text).slice(0, 200)
}

function buildReminderWorkflow(input: {
  prompt: string
  time: string
  timezone: string
  channel: string
}): { label: string; integration: string; summary: WorkflowSummary } {
  const reminderBody = extractReminderBody(input.prompt) || "Complete your reminder task."
  const description = cleanText(`Reminder: ${reminderBody}`)
  const label = generateShortTitle(reminderBody)
  const steps: WorkflowStep[] = [
    normalizeWorkflowStep(
      {
        type: "trigger",
        title: "Reminder trigger",
        triggerMode: "daily",
        triggerTime: input.time,
        triggerTimezone: input.timezone,
        triggerDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
      0,
    ),
    normalizeWorkflowStep(
      {
        type: "output",
        title: "Send reminder",
        outputChannel: input.channel,
        outputTiming: "scheduled",
        outputTime: input.time,
        outputFrequency: "once",
        outputRepeatCount: "1",
      },
      1,
    ),
  ]

  return {
    label,
    integration: input.channel,
    summary: {
      description,
      priority: "medium",
      schedule: {
        mode: "daily",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        time: input.time,
        timezone: input.timezone,
      },
      missionActive: true,
      tags: ["automation", "reminder"],
      apiCalls: [`OUTPUT:${input.channel}`],
      workflowSteps: steps,
    },
  }
}

function isLowValueFetchQuery(query: string, prompt: string): boolean {
  const q = cleanText(String(query || "")).toLowerCase().trim()
  const p = cleanText(String(prompt || "")).toLowerCase().trim()
  if (!q) return true
  if (q.length < 4) return true
  if (q === p) return true
  if (/\b(build|create|make)\b.*\bmission\b/.test(q)) return true
  if (/\b(hey nova|nova|need you to)\b/.test(q)) return true
  const boilerplate =
    /\b(send me|remind me|every day|daily|every morning|every night|mission|workflow|automation|notification|telegram|discord|novachat|at\s+[01]?\d(?::[0-5]\d)?\s*(am|pm)?)\b/g
  if (boilerplate.test(q)) {
    const core = q.replace(boilerplate, " ").replace(/\s+/g, " ").trim()
    if (core.length < 18) return true
  }
  return false
}

function derivePromptSearchQuery(prompt: string): string {
  const cleaned = cleanText(String(prompt || ""))
  const core = cleaned
    .replace(/^\s*(hey|hi|yo)\s+nova[\s,:-]*/i, "")
    .replace(/^\s*nova[\s,:-]*/i, "")
    .replace(/\b(create|build|make|generate|setup|set up)\b\s+(?:me\s+)?(?:a\s+)?(mission|workflow|automation)\b/gi, " ")
    .replace(/\b(send|deliver|post|notify)\s+me\b/gi, " ")
    .replace(/\b(remind me to|set a reminder to)\b/gi, " ")
    .replace(/\b(every day|daily|every morning|every night|weekly)\b/gi, " ")
    .replace(/\b(at|around|by)\s+[01]?\d(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?\b/gi, " ")
    .replace(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\b/gi, " ")
    .replace(/\b(to|on)\s+(telegram|discord|novachat|chat|email|webhook)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleanText(core || cleaned).slice(0, 180)
}

function shouldSkipFetchForTopic(topic: DetectedTopic, prompt: string): boolean {
  if (topic.category !== "motivation") return false
  const normalized = String(prompt || "").toLowerCase().replace(/\s+/g, " ")
  return /\b(from you|your own|custom|write me|hype up|personal speech)\b/.test(normalized)
}

/**
 * Check if prompt looks like a web lookup task.
 */
export function promptLooksLikeWebLookupTask(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  const asksLookup = /\b(search|scrape|lookup|find|latest|recap|scores|news|web|quote|quotes|weather|forecast|headline|story)\b/.test(text)
  const domainHint = /\b(nba|nfl|mlb|nhl|wnba|soccer|crypto|market|stocks|headline|motivational|inspirational)\b/.test(text)
  return asksLookup || domainHint
}

/**
 * Check if prompt requests condition logic.
 */
export function promptRequestsConditionLogic(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(if|when|only if|unless|threshold|above|below|greater than|less than|at least|at most)\b/.test(text)
}

/**
 * Check if prompt requests transform logic.
 */
export function promptRequestsTransformLogic(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(transform|normalize|dedupe|aggregate|format|enrich|map|filter)\b/.test(text)
}

/**
 * Build fallback workflow payload.
 */
function buildFallbackWorkflowPayload(
  prompt: string,
  defaultOutput: string,
  scheduleHint: { time: string; timezone: string },
): Record<string, unknown> {
  const description = cleanText(prompt) || "Generated workflow"
  const topicResult = detectTopicsInPrompt(prompt)
  const detectedTopic = topicResult.topics[0]
  const searchQueryBase = detectedTopic?.searchQuery || description
  const searchQuery = searchQueryBase.length > 180 ? searchQueryBase.slice(0, 180) : searchQueryBase
  const scheduleTime = scheduleHint.time || "09:00"
  const scheduleTimezone = scheduleHint.timezone || "America/New_York"
  return {
    label: generateShortTitle(prompt),
    description,
    integration: defaultOutput,
    priority: "medium",
    schedule: {
      mode: "daily",
      days: ["mon", "tue", "wed", "thu", "fri"],
      time: scheduleTime,
      timezone: scheduleTimezone,
    },
    tags: ["automation"],
    workflowSteps: [
      {
        type: "trigger",
        title: "Mission triggered",
        triggerMode: "daily",
        triggerTime: scheduleTime,
        triggerTimezone: scheduleTimezone,
        triggerDays: ["mon", "tue", "wed", "thu", "fri"],
      },
      {
        type: "fetch",
        title: "Fetch data",
        fetchSource: "web",
        fetchMethod: "GET",
        fetchUrl: "",
        fetchQuery: searchQuery,
        fetchHeaders: "",
        fetchSelector: "a[href]",
        fetchIncludeSources: false,
      },
      {
        type: "ai",
        title: "Summarize report",
        aiPrompt: topicResult.aiPrompt,
        aiDetailLevel: "standard",
      },
      {
        type: "output",
        title: "Send notification",
        outputChannel: defaultOutput,
        outputTiming: "immediate",
        outputTime: scheduleTime,
        outputFrequency: "once",
      },
    ],
  }
}

/**
 * Simplify generated workflow steps.
 */
function simplifyGeneratedWorkflowSteps(input: {
  steps: WorkflowStep[]
  prompt: string
  schedule: { time: string; timezone: string; days: string[] }
  defaultOutput: string
  defaultLlm: string
}): WorkflowStep[] {
  const wantsCondition = promptRequestsConditionLogic(input.prompt)
  const wantsTransform = promptRequestsTransformLogic(input.prompt)
  const immediate = promptRequestsImmediateOutput(input.prompt)
  const defaultTopicPrompt = detectTopicsInPrompt(input.prompt).aiPrompt

  const trigger = input.steps.find((step) => step.type === "trigger")
  const fetch = input.steps.find((step) => step.type === "fetch")
  const transform = wantsTransform ? input.steps.find((step) => step.type === "transform") : null
  const ai = input.steps.find((step) => step.type === "ai")
  const condition = wantsCondition ? input.steps.find((step) => step.type === "condition" && String(step.conditionField || "").trim()) : null
  const output = input.steps.find((step) => step.type === "output")

  const ordered: WorkflowStep[] = []
  ordered.push(normalizeWorkflowStep(
    trigger || {
      type: "trigger",
      title: "Mission triggered",
      triggerMode: "daily",
      triggerTime: input.schedule.time || "09:00",
      triggerTimezone: input.schedule.timezone || "America/New_York",
      triggerDays: input.schedule.days.length > 0 ? input.schedule.days : ["mon", "tue", "wed", "thu", "fri"],
    },
    ordered.length,
  ))

  if (fetch) ordered.push(normalizeWorkflowStep(fetch, ordered.length))
  if (transform) ordered.push(normalizeWorkflowStep(transform, ordered.length))

  ordered.push(normalizeWorkflowStep(
    ai || {
      type: "ai",
      title: "Summarize report",
      aiPrompt: defaultTopicPrompt,
      aiIntegration: input.defaultLlm,
      aiDetailLevel: "standard",
    },
    ordered.length,
  ))

  if (condition) ordered.push(normalizeWorkflowStep(condition, ordered.length))

  ordered.push(normalizeWorkflowStep(
    output || {
      type: "output",
      title: "Send notification",
      outputChannel: input.defaultOutput,
      outputTiming: immediate ? "immediate" : "scheduled",
      outputTime: input.schedule.time || "09:00",
      outputFrequency: "once",
      outputRepeatCount: "1",
    },
    ordered.length,
  ))

  return ordered
}

/**
 * Build stable web summary steps.
 * Now supports multi-topic detection - creates separate fetch steps for each topic.
 */
export function buildStableWebSummarySteps(input: {
  prompt: string
  time: string
  timezone: string
  defaultOutput: string
  defaultLlm: string
}): WorkflowStep[] {
  // Detect topics in the prompt
  const topicResult = detectTopicsInPrompt(input.prompt)
  const topics = topicResult.topics

  // Build steps array
  const steps: WorkflowStep[] = []
  let stepIndex = 0

  // Trigger step
  steps.push(normalizeWorkflowStep({
    type: "trigger",
    title: "Mission triggered",
    triggerMode: "daily",
    triggerTime: input.time || "09:00",
    triggerTimezone: input.timezone || "America/New_York",
    triggerDays: ["mon", "tue", "wed", "thu", "fri"],
  }, stepIndex++))

  // Create a fetch step for each detected topic
  for (const topic of topics) {
    if (shouldSkipFetchForTopic(topic, input.prompt)) continue
    const siteFilter = topic.siteHints.length > 0
      ? ` site:${topic.siteHints.slice(0, 2).join(" OR site:")}`
      : ""
    const query = `${topic.searchQuery}${siteFilter}`.slice(0, 200)

    steps.push(normalizeWorkflowStep({
      type: "fetch",
      title: `Fetch ${topic.label}`,
      fetchSource: "web",
      fetchMethod: "GET",
      fetchUrl: "",
      fetchQuery: query,
      fetchSelector: "a[href]",
      fetchHeaders: "",
      fetchRefreshMinutes: "15",
      fetchIncludeSources: false,
    }, stepIndex++))
  }

  // AI step with multi-topic prompt
  const aiPrompt = topicResult.aiPrompt
  steps.push(normalizeWorkflowStep({
    type: "ai",
    title: "Summarize report",
    aiPrompt,
    aiIntegration: input.defaultLlm,
    aiDetailLevel: "standard",
  }, stepIndex++))

  // Output step
  steps.push(normalizeWorkflowStep({
    type: "output",
    title: "Send notification",
    outputChannel: input.defaultOutput,
    outputTiming: promptRequestsImmediateOutput(input.prompt) ? "immediate" : "scheduled",
    outputTime: input.time || "09:00",
    outputFrequency: "once",
    outputRepeatCount: "1",
  }, stepIndex++))

  return steps
}

/**
 * Build fetch steps for detected topics.
 * Used by both AI generator and manual workflow builder.
 */
export function buildFetchStepsForTopics(topics: DetectedTopic[], startIndex: number): WorkflowStep[] {
  return topics.map((topic, idx) => {
    const siteFilter = topic.siteHints.length > 0
      ? ` site:${topic.siteHints.slice(0, 2).join(" OR site:")}`
      : ""
    const query = `${topic.searchQuery}${siteFilter}`.slice(0, 200)

    return normalizeWorkflowStep({
      type: "fetch",
      title: `Fetch ${topic.label}`,
      fetchSource: "web",
      fetchMethod: "GET",
      fetchUrl: "",
      fetchQuery: query,
      fetchSelector: "a[href]",
      fetchHeaders: "",
      fetchRefreshMinutes: "15",
      fetchIncludeSources: false,
    }, startIndex + idx)
  })
}

/**
 * Build a workflow from a user prompt.
 */
export async function buildWorkflowFromPrompt(
  prompt: string,
  scope?: IntegrationsStoreScope,
): Promise<{ workflow: { label: string; integration: string; summary: WorkflowSummary }; provider: Provider; model: string }> {
  const config = await loadIntegrationsConfig(scope)
  const catalog = await loadIntegrationCatalog(scope)
  const llmOptions = catalog.filter((item) => item.kind === "llm" && item.connected).map((item) => item.id).filter(Boolean)
  const outputOptions = catalog.filter((item) => item.kind === "channel" && item.connected).map((item) => item.id).filter(Boolean)
  const apiIntegrations = catalog
    .filter((item) => item.kind === "api" && item.connected && item.endpoint)
    .map((item) => ({ id: item.id, label: item.label, endpoint: item.endpoint as string }))
  const outputSet = new Set(outputOptions.length > 0 ? outputOptions : ["novachat", "telegram", "discord", "webhook"])
  const defaultOutput = outputOptions[0] || "telegram"
  const requestedOutput = inferRequestedOutputChannel(prompt, outputSet, defaultOutput)
  const activeLlmProvider = config.activeLlmProvider
  const defaultLlm =
    llmOptions.includes(activeLlmProvider)
      ? activeLlmProvider
      : (llmOptions[0] || "openai")
  const forceImmediateOutput = promptRequestsImmediateOutput(prompt)
  const scheduleHint = deriveScheduleFromPrompt(prompt)
  const defaultSchedule = {
    mode: "daily",
    days: ["mon", "tue", "wed", "thu", "fri"],
    time: scheduleHint.time || "09:00",
    timezone: scheduleHint.timezone || "America/New_York",
  }

  // Deterministic path for reminder-style prompts
  if (promptLooksLikeReminderTask(prompt)) {
    return {
      workflow: buildReminderWorkflow({
        prompt,
        time: defaultSchedule.time,
        timezone: defaultSchedule.timezone,
        channel: requestedOutput,
      }),
      provider:
        defaultLlm === "claude" || defaultLlm === "grok" || defaultLlm === "gemini" || defaultLlm === "openai"
          ? defaultLlm
          : "openai",
      model: "deterministic-reminder-template",
    }
  }

  // Deterministic path for web lookup prompts
  if (promptLooksLikeWebLookupTask(prompt)) {
    const schedule = { ...defaultSchedule }
    const integration = requestedOutput
    const steps = buildStableWebSummarySteps({
      prompt,
      time: schedule.time,
      timezone: schedule.timezone,
      defaultOutput: integration,
      defaultLlm,
    }).map((step) => {
      if (step.type !== "output") return step
      if (forceImmediateOutput) step.outputTiming = "immediate"
      step.outputRecipients = normalizeOutputRecipientsForChannel(String(step.outputChannel || integration), step.outputRecipients)
      return step
    })

    const summary: WorkflowSummary = {
      description: cleanText(prompt),
      priority: "medium",
      schedule,
      missionActive: true,
      tags: ["automation", "web-research"],
      apiCalls: ["FETCH:web", `LLM:${defaultLlm}`, `OUTPUT:${integration}`],
      workflowSteps: steps,
    }

    return {
      workflow: {
        label: generateShortTitle(prompt),
        integration,
        summary,
      },
      provider:
        defaultLlm === "claude" || defaultLlm === "grok" || defaultLlm === "gemini" || defaultLlm === "openai"
          ? defaultLlm
          : "openai",
      model: "deterministic-web-template",
    }
  }

  const systemText = [
    "You are Nova's workflow architect. Build production-grade automation workflows.",
    "Return only strict JSON.",
    "Design complete, executable workflows with trigger, fetch, transform/ai, condition, and output steps when relevant.",
    "For mission generation, every fetch step must use fetchSource=web (Brave web search pipeline). Do not emit api/crypto/rss/database fetch sources.",
    "If the user asks for market/news/web updates, you must include at least one fetch step that retrieves real external data before any AI summary step.",
    "Do not invent source facts. The workflow must be grounded in fetched data.",
    "For web/news summaries, keep outputs legible. Include at most 2 source links only when source sharing is enabled.",
    "Do not use auth-required endpoints unless credentials are explicitly provided by the user prompt.",
    "Do not use template expressions in conditionField. Use plain dot-paths like data.payload.price.",
    "When no reliable data is fetched, prefer workflow condition failure action 'skip' or explicit no-data output.",
    "Use 24h HH:mm time and realistic defaults.",
    `Connected AI providers: ${llmOptions.join(", ") || "openai"}.`,
    `Connected output channels: ${outputOptions.join(", ") || "novachat, telegram, discord, webhook"}.`,
    `Configured API integrations: ${apiIntegrations.length > 0 ? JSON.stringify(apiIntegrations) : "none"}.`,
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
        { type: "fetch", title: "Fetch web data", fetchSource: "web", fetchMethod: "GET", fetchApiIntegrationId: "", fetchUrl: "", fetchQuery: "", fetchSelector: "a[href]", fetchHeaders: "" },
        { type: "ai", title: "Summarize report", aiPrompt: "Summarize in concise bullets. Include sources only if enabled.", aiIntegration: "openai", aiModel: "", aiDetailLevel: "standard" },
        { type: "condition", title: "Check threshold", conditionField: "", conditionOperator: "greater_than", conditionValue: "", conditionLogic: "all", conditionFailureAction: "skip" },
        { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "scheduled", outputTime: "09:00", outputFrequency: "once", outputRecipients: "" }
      ]
    }),
  ].join("\n")

  const completion = await completeWithConfiguredLlm(systemText, userText, 1800, scope)
  const parsed = parseJsonObject(completion.text) || buildFallbackWorkflowPayload(prompt, requestedOutput, scheduleHint)

  const parsedLabel = cleanText(String(parsed.label || ""))
  const label = parsedLabel && parsedLabel.length <= 35 ? parsedLabel : generateShortTitle(prompt)
  const description = cleanText(String(parsed.description || "")) || cleanText(prompt)
  const integrationRaw = cleanText(String(parsed.integration || "telegram")).toLowerCase() || "telegram"
  const priority = cleanText(String(parsed.priority || "medium")).toLowerCase() || "medium"

  const scheduleObj = parsed.schedule && typeof parsed.schedule === "object" ? (parsed.schedule as Record<string, unknown>) : {}
  const schedule = {
    mode: String(scheduleObj.mode || "daily").trim() || "daily",
    days: Array.isArray(scheduleObj.days) ? scheduleObj.days.map((d) => String(d).trim()).filter(Boolean) : ["mon", "tue", "wed", "thu", "fri"],
    time: normalizeScheduleTime(String(scheduleObj.time || defaultSchedule.time).trim()) || defaultSchedule.time,
    timezone: String(scheduleObj.timezone || defaultSchedule.timezone).trim() || defaultSchedule.timezone,
  }
  if (scheduleHint.time) schedule.time = scheduleHint.time
  if (scheduleHint.timezone) schedule.timezone = scheduleHint.timezone

  const stepsRaw = Array.isArray(parsed.workflowSteps)
    ? parsed.workflowSteps.map((step, index) => normalizeWorkflowStep((step || {}) as WorkflowStep, index))
    : []

  const llmSet = new Set(llmOptions.length > 0 ? llmOptions : ["openai", "claude", "grok", "gemini"])
  const integration = outputSet.has(integrationRaw) ? integrationRaw : requestedOutput
  const apiById = new Map(apiIntegrations.map((item) => [item.id, item.endpoint]))

  let steps = stepsRaw.map((step) => {
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
        step.outputChannel = requestedOutput
      }
      if (forceImmediateOutput) {
        step.outputTiming = "immediate"
      } else if (String(step.outputTiming || "").trim() !== "immediate" && String(step.outputTiming || "").trim() !== "scheduled" && String(step.outputTiming || "").trim() !== "digest") {
        step.outputTiming = "immediate"
      }
      step.outputRecipients = normalizeOutputRecipientsForChannel(String(step.outputChannel || requestedOutput), step.outputRecipients)
      return step
    }
    if (step.type === "condition") {
      let field = String(step.conditionField || "").trim()
      if (/credibleSourceCount/i.test(field)) {
        field = "data.credibleSourceCount"
      }
      if (isInvalidConditionFieldPath(field)) {
        return null
      }
      step.conditionField = field
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "web") {
      const rawUrl = String(step.fetchUrl || "").trim()
      const rawQuery = String(step.fetchQuery || "").trim()
      if (rawUrl && isSearchLikeUrl(rawUrl)) {
        const extracted = extractSearchQueryFromUrl(rawUrl)
        if (extracted && !rawQuery) step.fetchQuery = extracted
        if (extracted || rawQuery) step.fetchUrl = ""
      }
      step.fetchHeaders = ""
      if (!String(step.fetchSelector || "").trim() || isSearchLikeUrl(rawUrl) || String(step.fetchQuery || "").trim()) {
        step.fetchSelector = "a[href]"
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
      const rawUrl = String(step.fetchUrl || "").trim()
      if (isSearchLikeUrl(rawUrl)) {
        const extracted = extractSearchQueryFromUrl(rawUrl)
        step.fetchSource = "web"
        step.fetchMethod = "GET"
        step.fetchUrl = extracted ? "" : rawUrl
        step.fetchQuery = extracted || String(step.fetchQuery || "")
        step.fetchHeaders = ""
        step.fetchSelector = "a[href]"
        return step
      }
      const isCryptoPanic = /cryptopanic\.com\/api\/v1\/posts/i.test(rawUrl)
      const hasMissingAuthToken = /auth_token=\s*(?:&|$)/i.test(rawUrl) || (!/auth_token=/i.test(rawUrl))
      if (isCryptoPanic && hasMissingAuthToken) {
        step.fetchSource = "rss"
        step.fetchUrl = "https://feeds.feedburner.com/coindesk"
        step.fetchQuery = ""
        step.fetchHeaders = ""
        step.fetchSelector = ""
      }
      return step
    }
    if (step.type === "fetch" && String(step.fetchSource || "").toLowerCase() === "rss") {
      if (!String(step.fetchUrl || "").trim()) {
        step.fetchUrl = "https://feeds.feedburner.com/coindesk"
      }
      return step
    }
    return step
  }).filter((step): step is WorkflowStep => Boolean(step))

  steps = simplifyGeneratedWorkflowSteps({
    steps,
    prompt,
    schedule,
    defaultOutput: integration,
    defaultLlm,
  })

  // Enforce Brave web-search fetches
  const detectedTopics = detectTopicsInPrompt(prompt).topics
  const dynamicAiPrompt = detectTopicsInPrompt(prompt).aiPrompt
  const promptCoreQuery = derivePromptSearchQuery(prompt)
  let fetchTopicCursor = 0
  steps = steps.map((step, index) => {
    if (step.type !== "fetch") return step
    const topic = detectedTopics[Math.min(fetchTopicCursor, Math.max(0, detectedTopics.length - 1))]
    fetchTopicCursor += 1
    const topicQuery = topic
      ? `${topic.searchQuery}${topic.siteHints.length > 0 ? ` site:${topic.siteHints.slice(0, 2).join(" OR site:")}` : ""}`
      : ""
    const currentQuery = String(step.fetchQuery || "").trim()
    const preferredQueryBase = !isLowValueFetchQuery(currentQuery, prompt)
      ? currentQuery
      : topicQuery
    const query = cleanText(
      preferredQueryBase ||
      promptCoreQuery ||
      extractSearchQueryFromUrl(String(step.fetchUrl || "").trim()) ||
      String(step.title || "").trim() ||
      description ||
      prompt,
    ).slice(0, 180) || "latest updates"
    return normalizeWorkflowStep(
      {
        ...step,
        fetchSource: "web",
        fetchMethod: "GET",
        fetchApiIntegrationId: "",
        fetchUrl: "",
        fetchQuery: query,
        fetchHeaders: "",
        fetchSelector: "a[href]",
      },
      index,
    )
  })

  steps = steps.map((step, index) => {
    if (step.type !== "ai") return step
    const aiPrompt = String(step.aiPrompt || "").trim()
    const isLowValuePrompt =
      !aiPrompt ||
      /summarize fetched data in clear bullet points/i.test(aiPrompt) ||
      /summarize fetched web sources in clear bullet points/i.test(aiPrompt) ||
      /summarize key facts as 2-4 concise bullet points/i.test(aiPrompt)
    if (!isLowValuePrompt) return step
    return normalizeWorkflowStep(
      {
        ...step,
        aiPrompt: dynamicAiPrompt,
        aiIntegration: String(step.aiIntegration || defaultLlm).trim() || defaultLlm,
        aiDetailLevel: step.aiDetailLevel || "standard",
      },
      index,
    )
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
