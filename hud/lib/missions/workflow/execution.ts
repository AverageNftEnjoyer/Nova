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
import { extractHtmlLinks, normalizeWebSearchRequestUrl, deriveWebSearchQuery } from "../web/fetch"
import { searchWebAndCollect } from "../web/search"
import { humanizeMissionOutputText } from "../output/formatters"
import { applyMissionOutputQualityGuardrails } from "../output/quality"
import { dispatchOutput } from "../output/dispatch"
import { completeWithConfiguredLlm } from "../llm/providers"
import { fetchCoinbaseMissionData, parseCoinbaseFetchQuery } from "../coinbase/fetch"
import {
  buildWebEvidenceContext,
  buildForcedWebSummaryPrompt,
  deriveCredibleSourceCountFromContext,
  hasMultipleFetchResults,
  buildMultiFetchWebEvidenceContext,
  hasUsableMultiFetchData,
  type FetchResultItem,
} from "../llm/prompts"
import { parseMissionWorkflow } from "./parsing"
import { getLocalTimeParts, parseTime } from "./scheduling"
import type {
  ExecuteMissionWorkflowInput,
  ExecuteMissionWorkflowResult,
  WorkflowStep,
  WorkflowStepTrace,
} from "../types"

const MISSION_AI_CONTEXT_MAX_CHARS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_MISSION_AI_CONTEXT_MAX_CHARS || "9000", 10)
  return Number.isFinite(parsed) && parsed > 500 ? parsed : 9000
})()

const MISSION_AI_PROMPT_MAX_CHARS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_MISSION_AI_PROMPT_MAX_CHARS || "11000", 10)
  return Number.isFinite(parsed) && parsed > 1000 ? parsed : 11000
})()

const MISSION_AI_SKILL_GUIDANCE_MAX_CHARS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_MISSION_AI_SKILL_GUIDANCE_MAX_CHARS || "2600", 10)
  return Number.isFinite(parsed) && parsed >= 400 ? parsed : 2600
})()

const MISSION_OUTPUT_INCLUDE_HEADER = (() => {
  const raw = String(process.env.NOVA_MISSION_OUTPUT_INCLUDE_HEADER || "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
})()

/**
 * Execute a mission workflow.
 */
export async function executeMissionWorkflow(input: ExecuteMissionWorkflowInput): Promise<ExecuteMissionWorkflowResult> {
  const now = input.now ?? new Date()
  const missionRunId = String(input.missionRunId || "").trim() || crypto.randomUUID()
  const skillSnapshot = input.skillSnapshot
  const stableSkillGuidance = truncateForModel(
    String(skillSnapshot?.guidance || "").trim(),
    MISSION_AI_SKILL_GUIDANCE_MAX_CHARS,
  )
  const parsed = parseMissionWorkflow(input.schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const integrationCatalog = await loadIntegrationCatalog(input.scope)
  const apiEndpointById = new Map(
    integrationCatalog
      .filter((item) => item.kind === "api" && item.connected && item.endpoint)
      .map((item) => [item.id, String(item.endpoint || "").trim()]),
  )

  const context: Record<string, unknown> = {
    mission: {
      id: input.schedule.id,
      runId: missionRunId,
      runKey: String(input.runKey || "").trim() || undefined,
      attempt: Number.isFinite(Number(input.attempt || 0)) ? Math.max(1, Number(input.attempt || 1)) : 1,
      label: input.schedule.label,
      integration: input.schedule.integration,
      time: input.schedule.time,
      timezone: input.schedule.timezone,
      source: input.source,
    },
    description: parsed.description,
    summary: parsed.summary || {},
    nowIso: now.toISOString(),
    skillSnapshot:
      skillSnapshot && skillSnapshot.version
        ? {
            version: skillSnapshot.version,
            skillCount: Number(skillSnapshot.skillCount || 0),
            createdAt: skillSnapshot.createdAt,
          }
        : null,
    data: null,
    // Multi-fetch support: accumulate data from multiple fetch steps
    fetchResults: [] as Array<{ stepTitle: string; data: unknown }>,
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

  const emitStepTrace = async (trace: WorkflowStepTrace) => {
    if (input.onStepTrace) {
      await input.onStepTrace(trace)
    }
  }

  const startStepTrace = async (step: WorkflowStep): Promise<string> => {
    const startedAt = new Date().toISOString()
    const trace: WorkflowStepTrace = {
      stepId: String(step.id || "").trim() || `step-${stepTraces.length + 1}`,
      type: String(step.type || "output"),
      title: String(step.title || step.type || "Step"),
      status: "running",
      startedAt,
    }
    await emitStepTrace(trace)
    return startedAt
  }

  const completeStepTrace = async (
    step: WorkflowStep,
    status: WorkflowStepTrace["status"],
    detail?: string,
    startedAt?: string,
  ) => {
    const trace: WorkflowStepTrace = {
      stepId: String(step.id || "").trim() || `step-${stepTraces.length + 1}`,
      type: String(step.type || "output"),
      title: String(step.title || step.type || "Step"),
      status,
      detail: detail?.trim() || undefined,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
    }
    stepTraces.push(trace)
    await emitStepTrace(trace)
  }

  for (const step of steps) {
    const type = String(step.type || "").toLowerCase()

    if (type === "trigger") {
      const startedAt = await startStepTrace(step)
      context.trigger = {
        mode: step.triggerMode || "daily",
        time: step.triggerTime || input.schedule.time,
        timezone: step.triggerTimezone || input.schedule.timezone,
      }
      await completeStepTrace(step, "completed", "Trigger context prepared.", startedAt)
      continue
    }

    if (type === "fetch") {
      const startedAt = await startStepTrace(step)
      let source = String(step.fetchSource || "api").toLowerCase()
      if (source === "coinbase") {
        const summaryCoinbase =
          context.summary && typeof context.summary === "object"
            ? ((context.summary as Record<string, unknown>).coinbase as Record<string, unknown> | undefined)
            : undefined
        const queryInput = parseCoinbaseFetchQuery(String(step.fetchQuery || ""))
        const coinbaseData = await fetchCoinbaseMissionData(
          {
            primitive:
              typeof queryInput.primitive === "string"
                ? queryInput.primitive
                : (summaryCoinbase?.primitive as "daily_portfolio_summary" | "price_alert_digest" | "weekly_pnl_summary" | undefined),
            assets:
              Array.isArray(queryInput.assets) && queryInput.assets.length > 0
                ? queryInput.assets
                : Array.isArray(summaryCoinbase?.assets)
                  ? summaryCoinbase.assets.map((item) => String(item))
                  : [],
            quoteCurrency:
              typeof queryInput.quoteCurrency === "string" && queryInput.quoteCurrency.trim()
                ? queryInput.quoteCurrency
                : String(summaryCoinbase?.quoteCurrency || "USD"),
            thresholdPct:
              Number.isFinite(Number(queryInput.thresholdPct))
                ? Number(queryInput.thresholdPct)
                : Number.isFinite(Number(summaryCoinbase?.thresholdPct))
                  ? Number(summaryCoinbase?.thresholdPct)
                  : undefined,
            cadence:
              typeof queryInput.cadence === "string" && queryInput.cadence.trim()
                ? queryInput.cadence
                : String(summaryCoinbase?.cadence || ""),
          },
          input.scope,
        )
        const fetchData = {
          source,
          mode: "coinbase-spot",
          stepTitle: step.title || "Fetch Coinbase data",
          status: coinbaseData.ok ? 200 : 502,
          ok: coinbaseData.ok,
          payload: coinbaseData,
          error: coinbaseData.ok ? undefined : coinbaseData.error || "Coinbase fetch failed.",
        }
        context.data = fetchData
        const fetchResults = context.fetchResults as Array<{ stepTitle: string; data: unknown }>
        fetchResults.push({ stepTitle: step.title || "Fetch Coinbase data", data: fetchData })
        await completeStepTrace(
          step,
          coinbaseData.ok ? "completed" : "failed",
          coinbaseData.ok
            ? `Fetched Coinbase spot data for ${coinbaseData.assets.join(", ")} (${coinbaseData.quoteCurrency}).`
            : (coinbaseData.error || "Coinbase fetch failed."),
          startedAt,
        )
        continue
      }
      const includeSourcesForStep = resolveIncludeSources(step.fetchIncludeSources, false)
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
        const webResearch = await searchWebAndCollect(inferredSearchQuery, requestHeaders, input.scope)
        const usable = webResearch.results.filter((item) => isUsableWebResult(item))
        const fetchData = {
          source,
          mode: "web-search",
          provider: webResearch.provider,
          query: webResearch.query,
          stepTitle: step.title || "Fetch data",
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
        // Store in context.data for backward compatibility
        context.data = fetchData
        // Also accumulate in fetchResults for multi-fetch support
        const fetchResults = context.fetchResults as Array<{ stepTitle: string; data: unknown }>
        fetchResults.push({ stepTitle: step.title || "Fetch data", data: fetchData })
        if (usable.length > 0) {
          await completeStepTrace(step, "completed", `Searched web via ${webResearch.provider} for "${inferredSearchQuery}" and found ${usable.length} usable sources.`, startedAt)
        } else {
          const noKeyMessage = webResearch.provider === "brave-unconfigured"
            ? 'Brave API key missing. Add your key in Integrations -> Brave Search API to improve web search reliability.'
            : null
          await completeStepTrace(
            step,
            "failed",
            noKeyMessage || `Web search via ${webResearch.provider} for "${inferredSearchQuery}" returned no usable sources.`,
            startedAt,
          )
        }
        continue
      }
      if (!url) {
        const errorData = {
          source,
          stepTitle: step.title || "Fetch data",
          ok: false,
          error: source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured.",
        }
        context.data = errorData
        // Still add to fetchResults so we track all fetch attempts
        const fetchResults = context.fetchResults as Array<{ stepTitle: string; data: unknown }>
        fetchResults.push({ stepTitle: step.title || "Fetch data", data: errorData })
        await completeStepTrace(step, "failed", source === "web" ? "No fetch URL or search query configured." : "No fetch URL configured.", startedAt)
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
        const fetchData = {
          source,
          url: effectiveRequestUrl,
          stepTitle: step.title || "Fetch data",
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
        // Store in context.data for backward compatibility
        context.data = fetchData
        // Also accumulate in fetchResults for multi-fetch support
        const fetchResults = context.fetchResults as Array<{ stepTitle: string; data: unknown }>
        fetchResults.push({ stepTitle: step.title || "Fetch data", data: fetchData })
        if (!res.ok) {
          await completeStepTrace(step, "failed", `Fetch returned status ${res.status} from ${effectiveRequestUrl}.`, startedAt)
        } else {
          await completeStepTrace(step, "completed", `Fetched data from ${effectiveRequestUrl}.`, startedAt)
        }
      } catch (error) {
        const errorData = {
          source,
          url: effectiveRequestUrl,
          stepTitle: step.title || "Fetch data",
          ok: false,
          error: error instanceof Error ? error.message : "fetch failed",
        }
        context.data = errorData
        // Still add to fetchResults so we track all fetch attempts
        const fetchResultsErr = context.fetchResults as Array<{ stepTitle: string; data: unknown }>
        fetchResultsErr.push({ stepTitle: step.title || "Fetch data", data: errorData })
        await completeStepTrace(step, "failed", error instanceof Error ? error.message : "Fetch failed.", startedAt)
      }
      continue
    }

    if (type === "transform") {
      const startedAt = await startStepTrace(step)
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
      await completeStepTrace(step, "completed", `Transform action '${action}' applied (${format}).`, startedAt)
      continue
    }

    if (type === "condition") {
      const startedAt = await startStepTrace(step)
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
          await completeStepTrace(step, "failed", `Condition failed on '${field}' with stop action.`, startedAt)
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
            {
              missionRunId,
              runKey: String(input.runKey || "").trim() || undefined,
              attempt: Number.isFinite(Number(input.attempt || 0)) ? Math.max(1, Number(input.attempt || 1)) : 1,
              source: input.source,
            },
          )
          outputs = outputs.concat(notifyResults)
          await completeStepTrace(step, "completed", `Condition failed and notify fallback was sent for '${field}'.`, startedAt)
        } else {
          await completeStepTrace(step, "skipped", `Condition failed on '${field}'.`, startedAt)
        }
        skipped = true
        skipReason = "Condition check failed."
      } else {
        await completeStepTrace(step, "completed", `Condition passed on '${field || "context"}'.`, startedAt)
      }
      if (skipped) break
      continue
    }

    if (type === "ai") {
      const startedAt = await startStepTrace(step)
      const aiPrompt = String(step.aiPrompt || "").trim()
      if (!aiPrompt) {
        await completeStepTrace(step, "skipped", "AI prompt is empty.", startedAt)
        continue
      }
      const includeSources = resolveIncludeSources(
        getByPath(context, "presentation.includeSources"),
        false,
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

      // Check for multi-fetch results
      const fetchResults = context.fetchResults as FetchResultItem[] | undefined
      const isMultiFetch = hasMultipleFetchResults(context as Record<string, unknown>)
      const hasUsableData = isMultiFetch
        ? hasUsableMultiFetchData(fetchResults || [])
        : hasUsableContextData(context.data)
      const hasUsableWebSources = isMultiFetch
        ? hasUsableMultiFetchData(fetchResults || [])
        : hasWebSearchUsableSources(context.data)
      const formattingContextData = isMultiFetch && fetchResults
        ? { fetchResults }
        : context.data

      if (!hasUsableData) {
        context.ai = "No reliable fetched data is available for this run. Skipping AI analysis to avoid fabricated output."
        context.aiSkipped = true
        await completeStepTrace(step, "skipped", "No reliable fetched data available for AI analysis.", startedAt)
        continue
      }

      const detailInstruction = detailLevel === "concise"
        ? "Keep output brief and skimmable. Prefer short bullets and tight phrasing."
        : detailLevel === "detailed"
          ? "Provide fuller context and specifics while keeping structure readable."
          : "Keep output balanced: concise but informative."
      const sourceInstruction = includeSources
        ? "Include at most 2 source links per section when available."
        : "Do not include source links in the final output."

      // Build web evidence from either multi-fetch or single fetch
      const webEvidence = isMultiFetch && fetchResults
        ? buildMultiFetchWebEvidenceContext(fetchResults, detailLevel)
        : buildWebEvidenceContext(context.data, detailLevel)

      const systemText = [
        "You are Nova workflow AI.",
        "Use only the provided context data.",
        "Never fabricate facts, events, prices, or links.",
        "If context is incomplete for a section, state that clearly.",
        stableSkillGuidance
          ? `Stable skill snapshot guidance for this run:\n${stableSkillGuidance}`
          : "",
        isMultiFetch ? "Organize your output by the sections provided in the context." : "",
        detailInstruction,
        sourceInstruction,
      ].filter(Boolean).join(" ")
      const userText = [
        `Step: ${step.title || "AI step"}`,
        `Instruction: ${aiPrompt}`,
        webEvidence ? "Context (Fact Extracts):" : "Context JSON:",
        truncateForModel(webEvidence || toTextPayload(context.data), MISSION_AI_CONTEXT_MAX_CHARS),
      ].join("\n\n")
      const boundedUserText = truncateForModel(userText, MISSION_AI_PROMPT_MAX_CHARS)
      try {
        const completion = await completeWithConfiguredLlm(
          systemText,
          boundedUserText,
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

        if (isNoDataText(aiText) && hasUsableWebSources) {
          const forcedPrompt = isMultiFetch && fetchResults
            ? [
                "Use the multi-section context and produce a clean report.",
                "Keep section structure, summarize readable facts only, and avoid raw table dumps.",
                includeSources ? "Include at most 2 source links per section." : "Do not include source links.",
                "",
                truncateForModel(webEvidence || "No context available.", MISSION_AI_CONTEXT_MAX_CHARS),
              ].join("\n")
            : buildForcedWebSummaryPrompt(context.data, { includeSources, detailLevel })
          const boundedForcedPrompt = truncateForModel(forcedPrompt, MISSION_AI_PROMPT_MAX_CHARS)
          const retry = await completeWithConfiguredLlm(
            systemText,
            boundedForcedPrompt,
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

        aiText = humanizeMissionOutputText(aiText, formattingContextData, { includeSources, detailLevel })

        context.ai = aiText
        context.lastAiProvider = provider
        context.lastAiModel = model
        await completeStepTrace(step, "completed", `AI completed using ${provider}/${model}.`, startedAt)
      } catch (error) {
        const includeSources = resolveIncludeSources(
          getByPath(context, "presentation.includeSources"),
          false,
        )
        const detailLevel = resolveAiDetailLevel(
          getByPath(context, "presentation.detailLevel"),
          "standard",
        )
        if (hasUsableWebSources) {
          const fallbackAiText = isMultiFetch
            ? (webEvidence || "No reliable multi-topic evidence was available.")
            : ""
          context.ai = humanizeMissionOutputText(fallbackAiText, formattingContextData, { includeSources, detailLevel })
        } else {
          context.ai = `AI step failed: ${error instanceof Error ? error.message : "Unknown error"}`
        }
        await completeStepTrace(step, "failed", error instanceof Error ? error.message : "AI step failed.", startedAt)
      }
      continue
    }

    if (type === "output") {
      const startedAt = await startStepTrace(step)
      const channel = String(step.outputChannel || input.schedule.integration || "telegram").toLowerCase()
      const timing = String(step.outputTiming || "immediate").toLowerCase()
      const outputTime = String(step.outputTime || input.schedule.time || "").trim()
      if (input.enforceOutputTime && (timing === "scheduled" || timing === "digest")) {
        const target = parseTime(outputTime)
        const local = getLocalTimeParts(now, input.schedule.timezone || "America/New_York")
        if (target && local && (target.hour !== local.hour || target.minute !== local.minute)) {
          skipped = true
          skipReason = "Output timing does not match this tick."
          await completeStepTrace(step, "skipped", skipReason, startedAt)
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
      const includeSources = resolveIncludeSources(getByPath(context, "presentation.includeSources"), false)
      const detailLevel = resolveAiDetailLevel(getByPath(context, "presentation.detailLevel"), "standard")
      const fetchResults = context.fetchResults as FetchResultItem[] | undefined
      const formattingContextData = hasMultipleFetchResults(context as Record<string, unknown>) && fetchResults
        ? { fetchResults }
        : context.data
      const baseText = humanizeMissionOutputText(baseTextRaw, formattingContextData, { includeSources, detailLevel })
      const qualityGuard = applyMissionOutputQualityGuardrails(baseText, formattingContextData, { includeSources, detailLevel })
      const guardedText = qualityGuard.text

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
      const outputStartIndex = outputs.length

      for (let i = 0; i < loops; i += 1) {
        const textBase = MISSION_OUTPUT_INCLUDE_HEADER
          ? (() => {
              const missionTitle = input.schedule.label || "Mission Report"
              const reportDate = now.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: input.schedule.timezone || "America/New_York",
              })
              return `**${missionTitle}**\nDate: ${reportDate}\n\n${guardedText}`
            })()
          : guardedText
        const text = loops > 1 ? `${textBase}\n\n(${i + 1}/${loops})` : textBase
        const result = await dispatchOutput(
          channel,
          text,
          resolvedRecipients,
          input.schedule,
          input.scope,
          {
            missionRunId,
            runKey: String(input.runKey || "").trim() || undefined,
            attempt: Number.isFinite(Number(input.attempt || 0)) ? Math.max(1, Number(input.attempt || 1)) : 1,
            source: input.source,
          },
        )
        outputs = outputs.concat(result)
      }
      const stepResults = outputs.slice(outputStartIndex)
      const outputOk = stepResults.length > 0 && stepResults.every((result) => result.ok)
      const partialFailure = stepResults.some((result) => result.ok) && stepResults.some((result) => !result.ok)
      const outputError = stepResults.find((result) => !result.ok && result.error)?.error
      const qualityDetail = qualityGuard.applied
        ? ` Quality guardrail applied (${qualityGuard.report.score} -> ${qualityGuard.fallbackReport?.score ?? qualityGuard.report.score}).`
        : qualityGuard.report.lowSignal
          ? ` Low-signal output detected (score ${qualityGuard.report.score}) but no stronger fallback was available.`
          : ""
      await completeStepTrace(
        step,
        outputOk ? "completed" : "failed",
        outputOk
          ? `Output sent via ${channel}.${qualityDetail}`
          : `Output failed via ${channel}${outputError ? `: ${outputError}` : "."}${partialFailure ? " Partial delivery detected." : ""}${qualityDetail}`,
        startedAt,
      )
      continue
    }
  }

  if (!steps.some((s) => String(s.type || "") === "output") && !skipped) {
    const startedAt = new Date().toISOString()
    const fallbackTextRaw = String(context.ai || parsed.description || input.schedule.message)
    const includeSources = resolveIncludeSources(getByPath(context, "presentation.includeSources"), false)
    const detailLevel = resolveAiDetailLevel(getByPath(context, "presentation.detailLevel"), "standard")
    const fetchResults = context.fetchResults as FetchResultItem[] | undefined
    const formattingContextData = hasMultipleFetchResults(context as Record<string, unknown>) && fetchResults
      ? { fetchResults }
      : context.data
    const fallbackText = humanizeMissionOutputText(fallbackTextRaw, formattingContextData, { includeSources, detailLevel })
    const fallbackQualityGuard = applyMissionOutputQualityGuardrails(fallbackText, formattingContextData, { includeSources, detailLevel })
    const guardedFallbackText = fallbackQualityGuard.text
    const fallbackTextWithDate = MISSION_OUTPUT_INCLUDE_HEADER
      ? (() => {
          const fallbackDate = now.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: input.schedule.timezone || "America/New_York",
          })
          const fallbackMissionTitle = input.schedule.label || "Mission Report"
          return `**${fallbackMissionTitle}**\nDate: ${fallbackDate}\n\n${guardedFallbackText}`
        })()
      : guardedFallbackText
    const result = await dispatchOutput(
      input.schedule.integration || "telegram",
      fallbackTextWithDate,
      input.schedule.chatIds,
      input.schedule,
      input.scope,
      {
        missionRunId,
        runKey: String(input.runKey || "").trim() || undefined,
        attempt: Number.isFinite(Number(input.attempt || 0)) ? Math.max(1, Number(input.attempt || 1)) : 1,
        source: input.source,
      },
    )
    outputs = outputs.concat(result)
    const fallbackOk = result.some((item) => item.ok)
    stepTraces.push({
      stepId: "fallback-output",
      type: "output",
      title: "Fallback output",
      status: fallbackOk ? "completed" : "failed",
      detail: fallbackOk
        ? `Fallback output sent.${fallbackQualityGuard.applied ? ` Quality guardrail applied (${fallbackQualityGuard.report.score} -> ${fallbackQualityGuard.fallbackReport?.score ?? fallbackQualityGuard.report.score}).` : ""}`
        : "Fallback output failed.",
      startedAt,
      endedAt: new Date().toISOString(),
    })
  }

  if (skipped && outputs.length === 0) {
    return { ok: true, skipped: true, outputs: [], reason: skipReason || "Workflow skipped.", stepTraces }
  }

  const ok = outputs.length > 0 && outputs.every((r) => r.ok)
  return { ok, skipped: false, outputs, reason: ok ? undefined : "One or more workflow outputs failed.", stepTraces }
}
