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

/**
 * Check if prompt looks like a web lookup task.
 */
export function promptLooksLikeWebLookupTask(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  const asksLookup = /\b(search|scrape|lookup|find|latest|recap|scores|news|web)\b/.test(text)
  const domainHint = /\b(nba|nfl|mlb|nhl|wnba|soccer|crypto|market|stocks|headline)\b/.test(text)
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
function buildFallbackWorkflowPayload(prompt: string, defaultOutput: string): Record<string, unknown> {
  const description = cleanText(prompt) || "Generated workflow"
  const searchQuery = description.length > 180 ? description.slice(0, 180) : description
  return {
    label: generateShortTitle(prompt),
    description,
    integration: defaultOutput,
    priority: "medium",
    schedule: {
      mode: "daily",
      days: ["mon", "tue", "wed", "thu", "fri"],
      time: "09:00",
      timezone: "America/New_York",
    },
    tags: ["automation"],
    workflowSteps: [
      {
        type: "trigger",
        title: "Mission triggered",
        triggerMode: "daily",
        triggerTime: "09:00",
        triggerTimezone: "America/New_York",
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
        fetchIncludeSources: true,
      },
      {
        type: "ai",
        title: "Summarize report",
        aiPrompt: "Summarize fetched web sources in clear bullet points. If sources are weak, state uncertainty.",
        aiDetailLevel: "standard",
      },
      {
        type: "output",
        title: "Send notification",
        outputChannel: defaultOutput,
        outputTiming: "immediate",
        outputTime: "09:00",
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
      aiPrompt: "Summarize fetched data in clear bullet points. If data is missing, say that briefly.",
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
      fetchIncludeSources: true,
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
      fetchIncludeSources: true,
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
  const activeLlmProvider = config.activeLlmProvider
  const defaultLlm =
    llmOptions.includes(activeLlmProvider)
      ? activeLlmProvider
      : (llmOptions[0] || "openai")
  const forceImmediateOutput = promptRequestsImmediateOutput(prompt)

  // Deterministic path for web lookup prompts
  if (promptLooksLikeWebLookupTask(prompt)) {
    const schedule = {
      mode: "daily",
      days: ["mon", "tue", "wed", "thu", "fri"],
      time: "09:00",
      timezone: "America/New_York",
    }
    const integration = defaultOutput
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
  const parsed = parseJsonObject(completion.text) || buildFallbackWorkflowPayload(prompt, defaultOutput)

  const parsedLabel = cleanText(String(parsed.label || ""))
  const label = parsedLabel && parsedLabel.length <= 35 ? parsedLabel : generateShortTitle(prompt)
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
  const integration = outputSet.has(integrationRaw) ? integrationRaw : defaultOutput
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
        step.outputChannel = defaultOutput
      }
      if (forceImmediateOutput) {
        step.outputTiming = "immediate"
      } else if (String(step.outputTiming || "").trim() !== "immediate" && String(step.outputTiming || "").trim() !== "scheduled" && String(step.outputTiming || "").trim() !== "digest") {
        step.outputTiming = "immediate"
      }
      step.outputRecipients = normalizeOutputRecipientsForChannel(String(step.outputChannel || defaultOutput), step.outputRecipients)
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
  steps = steps.map((step, index) => {
    if (step.type !== "fetch") return step
    const query = cleanText(
      String(step.fetchQuery || "").trim() ||
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
