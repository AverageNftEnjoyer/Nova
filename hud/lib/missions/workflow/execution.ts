/**
 * Workflow Execution
 *
 * Main workflow execution logic.
 */

import "server-only"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { cleanText, stripHtmlToText, truncateForModel, extractHtmlTitle } from "../text/cleaning"
import { getByPath, toTextPayload } from "../utils/paths"
import { toNumberSafe } from "../utils/paths"
import { hasUsableContextData, isNoDataText } from "../utils/validation"
import { normalizeWorkflowStep, parseHeadersJson, hasHeader, resolveIncludeSources, resolveAiDetailLevel } from "../utils/config"
import { isSearchEngineUrl, isUsableWebResult, hasWebSearchUsableSources } from "../web/quality"
import { fetchWebDocument, extractHtmlLinks, normalizeWebSearchRequestUrl, deriveWebSearchQuery } from "../web/fetch"
import { searchWebAndCollect } from "../web/search"
import { humanizeMissionOutputText } from "../output/formatters"
import { dispatchOutput } from "../output/dispatch"
import { completeWithConfiguredLlm } from "../llm/providers"
import { buildWebEvidenceContext, buildForcedWebSummaryPrompt, deriveCredibleSourceCountFromContext } from "../llm/prompts"
import { parseMissionWorkflow } from "./parsing"
import { getLocalTimeParts, parseTime } from "./scheduling"
import type {
  ExecuteMissionWorkflowInput,
  ExecuteMissionWorkflowResult,
  WorkflowStep,
  WorkflowStepTrace,
} from "../types"

/**
 * Execute a mission workflow.
 */
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
    presentation: {
      includeSources: true,
      detailLevel: "standard",
    },
  }

  let skipped = false
  let skipReason = ""
  let outputs: Array<{ ok: boolean; error?: string; status?: number }> = []
  const stepTraces: WorkflowStepTrace[] = []

  const completeStepTrace = (
    step: WorkflowStep,
    status: WorkflowStepTrace["status"],
    detail?: string,
    startedAt?: string,
  ) => {
    stepTraces.push({
      stepId: String(step.id || "").trim() || `step-${stepTraces.length + 1}`,
      type: String(step.type || "output"),
      title: String(step.title || step.type || "Step"),
      status,
      detail: detail?.trim() || undefined,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
    })
  }

  for (const step of steps) {
    const type = String(step.type || "").toLowerCase()

    if (type === "trigger") {
      const startedAt = new Date().toISOString()
      context.trigger = {
        mode: step.triggerMode || "daily",
        time: step.triggerTime || input.schedule.time,
        timezone: step.triggerTimezone || input.schedule.timezone,
      }
      completeStepTrace(step, "completed", "Trigger context prepared.", startedAt)
      continue
    }

    if (type === "fetch") {
      const startedAt = new Date().toISOString()
      let source = String(step.fetchSource || "api").toLowerCase()
      const includeSourcesForStep = resolveIncludeSources(step.fetchIncludeSources, true)
      context.presentation = {
        ...(context.presentation && typeof context.presentation === "object"
          ? (context.presentation as Record<string, unknown>)
          : {}),
        includeSources: includeSourcesForStep,
      }
      const method = String(step.fetchMethod || "GET").toUpperCase() === "POST" ? "POST" : "GET"
      let url = String(step.fetchUrl || "").trim()
      const apiId = String(step.fetchApiIntegrationId || "").trim()
      if (!url && source === "api") {
        if (apiId && apiEndpointById.has(apiId)) {
          url = String(apiEndpointById.get(apiId) || "")
        }
      }
      if (!url && source === "crypto") url = "https://api.coingecko.com/api/v3/global"
      if (!url && source === "calendar") url = "/api/calendar/events"
      if (!url && source === "rss") url = "https://feeds.feedburner.com/coindesk"

      const headers = parseHeadersJson(step.fetchHeaders)
      const query = String(step.fetchQuery || "").trim()
      const requestHeaders: Record<string, string> = {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...headers,
      }
      if (source === "web") {
        if (!hasHeader(requestHeaders, "Accept")) {
          requestHeaders.Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        if (!hasHeader(requestHeaders, "User-Agent")) {
          requestHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
      }
      const inferredSearchQuery = deriveWebSearchQuery({
        explicitQuery: query,
        url,
        stepTitle: step.title,
        workflowDescription: parsed.description,
        missionLabel: input.schedule.label,
      })
      if (source !== "web" && !url && !apiId && inferredSearchQuery.length > 0) {
        source = "web"
      }
      const useSearchPipeline = source === "web" && inferredSearchQuery.length > 0 && (!url || isSearchEngineUrl(url) || query.length > 0)
      if (useSearchPipeline) {
        const webResearch = await searchWebAndCollect(inferredSearchQuery, requestHeaders)
        const usable = webResearch.results.filter((item) => isUsableWebResult(item))
        context.data = {
          source,
          mode: "web-search",
          provider: webResearch.provider,
          query: webResearch.query,
          status: usable.length > 0 ? 200 : 502,
          ok: usable.length > 0,
          credibleSourceCount: usable.length,
          sourceUrls: usable.map((item) => item.url),
          payload: {
            searchUrl: webResearch.searchUrl,
            searchTitle: webResearch.searchTitle,
            searchText: webResearch.searchText,
            results: webResearch.results,
            credibleSourceCount: usable.length,
            sourceUrls: usable.map((item) => item.url),
            links: usable.map((item) => item.url),
            text: truncateForModel(
              usable
                .map((item) => `${item.title}\n${item.pageText || item.snippet}\n${item.url}`)
                .join("\n\n"),
              12000,
            ),
          },
        }
        if (usable.length > 0) {
          completeStepTrace(step, "completed", `Searched web via ${webResearch.provider} for "${inferredSearchQuery}" and found ${usable.length} usable sources.`, startedAt)
        } else {
          completeStepTrace(step, "failed", `Web search via ${webResearch.provider} for "${inferredSearchQuery}" returned no usable sources.`, startedAt)
        }
        continue
      }
      if (!url) {
        context.data = { source, error: source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured." }
        completeStepTrace(step, "failed", source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured.", startedAt)
        continue
      }

      const queryPrefix = query && !url.includes("?") ? "?" : query ? "&" : ""
      const requestUrl = url.startsWith("http") ? `${url}${queryPrefix}${query}` : `http://localhost:3000${url}${queryPrefix}${query}`
      const effectiveRequestUrl = source === "web" ? normalizeWebSearchRequestUrl(requestUrl) : requestUrl

      try {
        const res = await fetch(effectiveRequestUrl, {
          method,
          headers: requestHeaders,
          body: method === "POST" ? JSON.stringify({ query, scheduleId: input.schedule.id }) : undefined,
          cache: "no-store",
        })

        const contentType = String(res.headers.get("content-type") || "")
        let payload: unknown
        if (contentType.includes("application/json")) {
          payload = await res.json().catch(() => null)
        } else {
          const htmlText = await res.text().catch(() => "")
          payload = htmlText
          if (source === "web") {
            const links = extractHtmlLinks(htmlText, res.url || effectiveRequestUrl)
            const plainText = stripHtmlToText(htmlText)
            const selectedBySelector = step.fetchSelector && typeof htmlText === "string"
              ? (() => {
                  const selector = step.fetchSelector.trim().toLowerCase()
                  if (selector === "a[href]" || selector === "a") return links
                  return null
                })()
              : null
            payload = {
              title: extractHtmlTitle(htmlText),
              url: effectiveRequestUrl,
              finalUrl: res.url || effectiveRequestUrl,
              text: plainText.length > 12000 ? `${plainText.slice(0, 12000)}...` : plainText,
              sourceUrls: links.map((item) => item.href),
              links,
              selected: selectedBySelector || undefined,
            }
          }
          if (source === "web" && step.fetchSelector && typeof htmlText === "string") {
            const selector = step.fetchSelector.trim()
            const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(selector)
            const classMatch = /^\.([A-Za-z0-9_-]+)$/.exec(selector)
            if (idMatch) {
              const id = idMatch[1]
              const rx = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(htmlText)
              if (match && typeof payload === "object" && payload) {
                ;(payload as Record<string, unknown>).selected = cleanText(match[1].replace(/<[^>]+>/g, " "))
              }
            } else if (classMatch) {
              const cls = classMatch[1]
              const rx = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
              const match = rx.exec(htmlText)
              if (match && typeof payload === "object" && payload) {
                ;(payload as Record<string, unknown>).selected = cleanText(match[1].replace(/<[^>]+>/g, " "))
              }
            }
          }
        }

        const credibleSourceCount = source === "web"
          ? (() => {
              if (payload && typeof payload === "object") {
                const p = payload as Record<string, unknown>
                if (Array.isArray(p.sourceUrls)) return p.sourceUrls.filter(Boolean).length
                if (Array.isArray(p.links)) return p.links.filter(Boolean).length
              }
              return 0
            })()
          : 0
        context.data = {
          source,
          url: effectiveRequestUrl,
          status: res.status,
          ok: res.ok,
          payload,
          ...(source === "web"
            ? {
                credibleSourceCount,
                sourceUrls:
                  payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).sourceUrls)
                    ? ((payload as Record<string, unknown>).sourceUrls as unknown[]).map((item) => String(item)).filter(Boolean)
                    : [],
              }
            : {}),
        }
        if (!res.ok) {
          completeStepTrace(step, "failed", `Fetch returned status ${res.status} from ${effectiveRequestUrl}.`, startedAt)
        } else {
          completeStepTrace(step, "completed", `Fetched data from ${effectiveRequestUrl}.`, startedAt)
        }
      } catch (error) {
        context.data = { source, url: effectiveRequestUrl, error: error instanceof Error ? error.message : "fetch failed" }
        completeStepTrace(step, "failed", error instanceof Error ? error.message : "Fetch failed.", startedAt)
      }
      continue
    }

    if (type === "transform") {
      const startedAt = new Date().toISOString()
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
      completeStepTrace(step, "completed", `Transform action '${action}' applied (${format}).`, startedAt)
      continue
    }

    if (type === "condition") {
      const startedAt = new Date().toISOString()
      const field = String(step.conditionField || "").trim()
      const operator = String(step.conditionOperator || "contains").trim()
      const expected = String(step.conditionValue || "")
      let value = field ? getByPath(context, field) : undefined
      if (typeof value === "undefined" && /(^|\.)(credibleSourceCount)$/i.test(field)) {
        value = deriveCredibleSourceCountFromContext(context)
      }

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
          completeStepTrace(step, "failed", `Condition failed on '${field}' with stop action.`, startedAt)
          return { ok: false, skipped: true, outputs, reason: "Condition failed with stop action.", stepTraces }
        }
        if (failure === "notify") {
          const warnText = `Mission \"${input.schedule.label}\" condition failed on field \"${field}\".`
          const notifyResults = await dispatchOutput(
            input.schedule.integration || "telegram",
            warnText,
            input.schedule.chatIds,
            input.schedule,
            input.scope,
          )
          outputs = outputs.concat(notifyResults)
          completeStepTrace(step, "completed", `Condition failed and notify fallback was sent for '${field}'.`, startedAt)
        } else {
          completeStepTrace(step, "skipped", `Condition failed on '${field}'.`, startedAt)
        }
        skipped = true
        skipReason = "Condition check failed."
      } else {
        completeStepTrace(step, "completed", `Condition passed on '${field || "context"}'.`, startedAt)
      }
      if (skipped) break
      continue
    }

    if (type === "ai") {
      const startedAt = new Date().toISOString()
      const aiPrompt = String(step.aiPrompt || "").trim()
      if (!aiPrompt) {
        completeStepTrace(step, "skipped", "AI prompt is empty.", startedAt)
        continue
      }
      const includeSources = resolveIncludeSources(
        getByPath(context, "presentation.includeSources"),
        true,
      )
      const detailLevel = resolveAiDetailLevel(
        step.aiDetailLevel,
        resolveAiDetailLevel(getByPath(context, "presentation.detailLevel"), "standard"),
      )
      context.presentation = {
        ...(context.presentation && typeof context.presentation === "object"
          ? (context.presentation as Record<string, unknown>)
          : {}),
        detailLevel,
      }
      if (!hasUsableContextData(context.data)) {
        context.ai = "No reliable fetched data is available for this run. Skipping AI analysis to avoid fabricated output."
        context.aiSkipped = true
        completeStepTrace(step, "skipped", "No reliable fetched data available for AI analysis.", startedAt)
        continue
      }
      const detailInstruction = detailLevel === "concise"
        ? "Keep output brief and skimmable. Prefer short bullets and tight phrasing."
        : detailLevel === "detailed"
          ? "Provide fuller context and specifics while keeping structure readable."
          : "Keep output balanced: concise but informative."
      const sourceInstruction = includeSources
        ? "Include at most 2 source links when available."
        : "Do not include source links in the final output."
      const webEvidence = buildWebEvidenceContext(context.data, detailLevel)
      const systemText = [
        "You are Nova workflow AI.",
        "Use only the provided context data.",
        "Never fabricate facts, events, prices, or links.",
        "If context is incomplete, state that clearly.",
        detailInstruction,
        sourceInstruction,
      ].join(" ")
      const userText = [
        `Step: ${step.title || "AI step"}`,
        `Instruction: ${aiPrompt}`,
        webEvidence ? "Context (Fact Extracts):" : "Context JSON:",
        webEvidence || toTextPayload(context.data),
      ].join("\n\n")
      try {
        const completion = await completeWithConfiguredLlm(
          systemText,
          userText,
          900,
          input.scope,
          {
            provider:
              step.aiIntegration === "claude" ||
              step.aiIntegration === "grok" ||
              step.aiIntegration === "gemini" ||
              step.aiIntegration === "openai"
                ? step.aiIntegration
                : undefined,
            model: String(step.aiModel || "").trim() || undefined,
          },
        )
        let aiText = completion.text
        let provider = completion.provider
        let model = completion.model

        if (isNoDataText(aiText) && hasWebSearchUsableSources(context.data)) {
          const forcedPrompt = buildForcedWebSummaryPrompt(context.data, { includeSources, detailLevel })
          const retry = await completeWithConfiguredLlm(
            systemText,
            forcedPrompt,
            900,
            input.scope,
            {
              provider:
                step.aiIntegration === "claude" ||
                step.aiIntegration === "grok" ||
                step.aiIntegration === "gemini" ||
                step.aiIntegration === "openai"
                  ? step.aiIntegration
                  : undefined,
              model: String(step.aiModel || "").trim() || undefined,
            },
          )
          aiText = retry.text
          provider = retry.provider
          model = retry.model
        }

        aiText = humanizeMissionOutputText(aiText, context.data, { includeSources, detailLevel })

        context.ai = aiText
        context.lastAiProvider = provider
        context.lastAiModel = model
        completeStepTrace(step, "completed", `AI completed using ${provider}/${model}.`, startedAt)
      } catch (error) {
        const includeSources = resolveIncludeSources(
          getByPath(context, "presentation.includeSources"),
          true,
        )
        const detailLevel = resolveAiDetailLevel(
          getByPath(context, "presentation.detailLevel"),
          "standard",
        )
        if (hasWebSearchUsableSources(context.data)) {
          context.ai = humanizeMissionOutputText("", context.data, { includeSources, detailLevel })
        } else {
          context.ai = `AI step failed: ${error instanceof Error ? error.message : "Unknown error"}`
        }
        completeStepTrace(step, "failed", error instanceof Error ? error.message : "AI step failed.", startedAt)
      }
      continue
    }

    if (type === "output") {
      const startedAt = new Date().toISOString()
      const channel = String(step.outputChannel || input.schedule.integration || "telegram").toLowerCase()
      const timing = String(step.outputTiming || "immediate").toLowerCase()
      const outputTime = String(step.outputTime || input.schedule.time || "").trim()
      if (input.enforceOutputTime && (timing === "scheduled" || timing === "digest")) {
        const target = parseTime(outputTime)
        const local = getLocalTimeParts(now, input.schedule.timezone || "America/New_York")
        if (target && local && (target.hour !== local.hour || target.minute !== local.minute)) {
          skipped = true
          skipReason = "Output timing does not match this tick."
          completeStepTrace(step, "skipped", skipReason, startedAt)
          continue
        }
      }

      const rawTemplate = String(step.outputTemplate || "").trim()
      const interpolateTemplate = (template: string, ctx: Record<string, unknown>): string => {
        return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
          const value = getByPath(ctx, key)
          if (value === null || typeof value === "undefined") return ""
          if (typeof value === "string") return value
          if (typeof value === "number" || typeof value === "boolean") return String(value)
          return JSON.stringify(value)
        })
      }
      const baseTextRaw = rawTemplate
        ? interpolateTemplate(rawTemplate, context)
        : String(context.ai || parsed.description || input.schedule.message)
      const includeSources = resolveIncludeSources(getByPath(context, "presentation.includeSources"), true)
      const detailLevel = resolveAiDetailLevel(getByPath(context, "presentation.detailLevel"), "standard")
      const baseText = humanizeMissionOutputText(baseTextRaw, context.data, { includeSources, detailLevel })

      const recipientString = String(step.outputRecipients || "").trim()
      const parsedRecipients = recipientString
        ? recipientString.split(/[,\n]/).map((r) => r.trim()).filter(Boolean)
        : []
      const isTemplateRecipient = (value: string): boolean => {
        const text = String(value || "").trim()
        return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
      }
      const recipients = parsedRecipients.filter((recipient) => !isTemplateRecipient(recipient))
      const resolvedRecipients = recipients.length > 0 ? recipients : input.schedule.chatIds

      const frequency = String(step.outputFrequency || "once").toLowerCase()
      const repeatCount = Math.max(1, Math.min(10, Number(step.outputRepeatCount || "1") || 1))
      const loops = frequency === "multiple" ? repeatCount : 1

      for (let i = 0; i < loops; i += 1) {
        const missionTitle = input.schedule.label || "Mission Report"
        const textWithTitle = `**${missionTitle}**\n\n${baseText}`
        const text = loops > 1 ? `${textWithTitle}\n\n(${i + 1}/${loops})` : textWithTitle
        const result = await dispatchOutput(channel, text, resolvedRecipients, input.schedule, input.scope)
        outputs = outputs.concat(result)
      }
      const stepResults = outputs.slice(-loops)
      const outputOk = stepResults.some((result) => result.ok)
      const outputError = stepResults.find((result) => !result.ok && result.error)?.error
      completeStepTrace(
        step,
        outputOk ? "completed" : "failed",
        outputOk ? `Output sent via ${channel}.` : `Output failed via ${channel}${outputError ? `: ${outputError}` : "."}`,
        startedAt,
      )
      continue
    }
  }

  if (!steps.some((s) => String(s.type || "") === "output") && !skipped) {
    const startedAt = new Date().toISOString()
    const fallbackTextRaw = String(context.ai || parsed.description || input.schedule.message)
    const includeSources = resolveIncludeSources(getByPath(context, "presentation.includeSources"), true)
    const detailLevel = resolveAiDetailLevel(getByPath(context, "presentation.detailLevel"), "standard")
    const fallbackText = humanizeMissionOutputText(fallbackTextRaw, context.data, { includeSources, detailLevel })
    const result = await dispatchOutput(
      input.schedule.integration || "telegram",
      fallbackText,
      input.schedule.chatIds,
      input.schedule,
      input.scope,
    )
    outputs = outputs.concat(result)
    const fallbackOk = result.some((item) => item.ok)
    stepTraces.push({
      stepId: "fallback-output",
      type: "output",
      title: "Fallback output",
      status: fallbackOk ? "completed" : "failed",
      detail: fallbackOk ? "Fallback output sent." : "Fallback output failed.",
      startedAt,
      endedAt: new Date().toISOString(),
    })
  }

  if (skipped && outputs.length === 0) {
    return { ok: true, skipped: true, outputs: [], reason: skipReason || "Workflow skipped.", stepTraces }
  }

  const ok = outputs.some((r) => r.ok)
  return { ok, skipped: false, outputs, reason: ok ? undefined : "All workflow outputs failed.", stepTraces }
}
