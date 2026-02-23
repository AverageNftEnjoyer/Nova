import "server-only"

import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { fetchCoinbaseMissionData, parseCoinbaseFetchQuery } from "../coinbase/fetch"
import type { WorkflowStep } from "../types"
import {
  buildCoinbaseArtifactContextSnippet,
  loadRecentCoinbaseStepArtifacts,
  persistCoinbaseStepArtifact,
  type CoinbaseStepArtifactRecord,
} from "./coinbase-artifacts"

type CoinbaseIntent = "status" | "price" | "portfolio" | "transactions" | "report"
type CoinbaseErrorCode =
  | "CB_STEP_TIMEOUT"
  | "CB_STEP_FETCH_FAILED"
  | "CB_STEP_SCOPE_MISSING"
  | "CB_STEP_INVALID_INTENT"
  | "CB_STEP_ABORTED"
  | "CB_STEP_UNKNOWN"

export interface ExecuteCoinbaseStepInput {
  step: WorkflowStep
  userContextId: string
  conversationId: string
  missionId: string
  missionRunId: string
  scope?: IntegrationsStoreScope
  contextNowMs?: number
  logger?: (entry: Record<string, unknown>) => void
}

export interface ExecuteCoinbaseStepResult {
  ok: boolean
  errorCode?: CoinbaseErrorCode
  userMessage?: string
  retryCount: number
  artifactRef?: string
  output?: unknown
  summary: string
  recentArtifacts: CoinbaseStepArtifactRecord[]
  priorArtifactContextSnippet: string
}

const COINBASE_STEP_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_COINBASE_STEP_TIMEOUT_MS || "", 10)
  return Number.isFinite(parsed) && parsed >= 2_000 ? parsed : 10_000
})()

const COINBASE_STEP_MAX_ATTEMPTS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_COINBASE_STEP_MAX_ATTEMPTS || "", 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(4, parsed) : 2
})()

const inFlightIdempotencyKeys = new Set<string>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

function normalizeIntent(raw: unknown): CoinbaseIntent {
  const intent = String(raw || "").trim().toLowerCase()
  if (intent === "status" || intent === "price" || intent === "portfolio" || intent === "transactions" || intent === "report") return intent
  return "report"
}

function mapIntentToPrimitive(intent: CoinbaseIntent): "daily_portfolio_summary" | "price_alert_digest" | "weekly_pnl_summary" {
  if (intent === "price") return "price_alert_digest"
  if (intent === "transactions") return "weekly_pnl_summary"
  return "daily_portfolio_summary"
}

function userMessageForError(code: CoinbaseErrorCode): string {
  if (code === "CB_STEP_TIMEOUT") return "Coinbase step timed out. Please retry in a moment."
  if (code === "CB_STEP_SCOPE_MISSING") return "Coinbase step needs a valid user context before it can run."
  if (code === "CB_STEP_INVALID_INTENT") return "Coinbase step intent was invalid for this workflow."
  if (code === "CB_STEP_ABORTED") return "Coinbase step was skipped because another identical step is already running."
  if (code === "CB_STEP_FETCH_FAILED") return "Coinbase data could not be verified for this run."
  return "Coinbase step failed unexpectedly."
}

function summarizeOutput(intent: CoinbaseIntent, output: unknown): string {
  const payload = output && typeof output === "object" ? (output as Record<string, unknown>) : {}
  const quote = String(payload.quoteCurrency || "USD")
  const assets = Array.isArray(payload.assets) ? payload.assets.map((item) => String(item)).slice(0, 8) : []
  const ok = Boolean(payload.ok)
  const priceCount = Array.isArray(payload.prices) ? payload.prices.length : 0
  const txCount = Array.isArray(payload.transactions) ? payload.transactions.length : 0
  const hasPortfolio = Boolean(payload.portfolio && typeof payload.portfolio === "object")
  return `intent=${intent} ok=${ok} assets=${assets.join(",") || "none"} quote=${quote} prices=${priceCount} portfolio=${hasPortfolio ? "yes" : "no"} tx=${txCount}`
}

function logCoinbaseStep(
  logger: ExecuteCoinbaseStepInput["logger"],
  event: string,
  payload: Record<string, unknown>,
) {
  const entry = {
    event,
    provider: "coinbase",
    ...payload,
    ts: new Date().toISOString(),
  }
  if (logger) logger(entry)
  else console.info("[MissionCoinbaseStep]", entry)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function deriveCoinbaseStepPayload(step: WorkflowStep): {
  intent: CoinbaseIntent
  params: {
    assets?: string[]
    quoteCurrency?: string
    thresholdPct?: number
    cadence?: string
    transactionLimit?: number
  }
} {
  const query = parseCoinbaseFetchQuery(String(step.fetchQuery || ""))
  const intentFromPrimitive = (() => {
    if (query.primitive === "price_alert_digest") return "price"
    if (query.primitive === "weekly_pnl_summary") return "transactions"
    if (query.primitive === "daily_portfolio_summary") return "report"
    return ""
  })()
  const intent = normalizeIntent(step.coinbaseIntent || intentFromPrimitive || "report")
  const params = {
    assets: Array.isArray(step.coinbaseParams?.assets)
      ? step.coinbaseParams.assets.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : query.assets,
    quoteCurrency:
      (typeof step.coinbaseParams?.quoteCurrency === "string" && step.coinbaseParams.quoteCurrency.trim()) ||
      (typeof query.quoteCurrency === "string" ? query.quoteCurrency : "USD"),
    thresholdPct:
      Number.isFinite(Number(step.coinbaseParams?.thresholdPct))
        ? Number(step.coinbaseParams?.thresholdPct)
        : Number.isFinite(Number(query.thresholdPct))
          ? Number(query.thresholdPct)
          : undefined,
    cadence:
      (typeof step.coinbaseParams?.cadence === "string" && step.coinbaseParams.cadence.trim()) ||
      (typeof query.cadence === "string" ? query.cadence : undefined),
    transactionLimit: Number.isFinite(Number(step.coinbaseParams?.transactionLimit))
      ? Number(step.coinbaseParams?.transactionLimit)
      : undefined,
  }
  return { intent, params }
}

export async function executeCoinbaseWorkflowStep(input: ExecuteCoinbaseStepInput): Promise<ExecuteCoinbaseStepResult> {
  const nowMs = Number.isFinite(Number(input.contextNowMs)) ? Number(input.contextNowMs) : Date.now()
  const userContextId = sanitizeUserContextId(input.userContextId)
  if (!userContextId) {
    return {
      ok: false,
      errorCode: "CB_STEP_SCOPE_MISSING",
      userMessage: userMessageForError("CB_STEP_SCOPE_MISSING"),
      retryCount: 0,
      summary: "Coinbase step missing user context.",
      recentArtifacts: [],
      priorArtifactContextSnippet: "",
    }
  }
  const stepId = String(input.step.id || "coinbase-step").trim() || "coinbase-step"
  const missionId = String(input.missionId || "").trim() || "mission"
  const conversationId = String(input.conversationId || "").trim() || missionId
  const missionRunId = String(input.missionRunId || "").trim() || "run"
  const idempotencyKey = `${userContextId}:${missionRunId}:${stepId}`
  if (inFlightIdempotencyKeys.has(idempotencyKey)) {
    return {
      ok: false,
      errorCode: "CB_STEP_ABORTED",
      userMessage: userMessageForError("CB_STEP_ABORTED"),
      retryCount: 0,
      summary: "Skipped duplicate in-flight Coinbase step.",
      recentArtifacts: [],
      priorArtifactContextSnippet: "",
    }
  }

  const includePreviousArtifactContext = input.step.coinbaseParams?.includePreviousArtifactContext !== false
  const priorArtifacts = includePreviousArtifactContext
    ? await loadRecentCoinbaseStepArtifacts({
      userContextId,
      conversationId,
      missionId,
      nowMs,
      limit: 4,
    })
    : []
  if (includePreviousArtifactContext && priorArtifacts.length > 0) {
    logCoinbaseStep(input.logger, "coinbase.step.read-from-artifact", {
      userContextId,
      conversationId,
      missionRunId,
      stepId,
      missionId,
      count: priorArtifacts.length,
      refs: priorArtifacts.map((item) => item.artifactRef),
    })
  }
  const priorArtifactContextSnippet = buildCoinbaseArtifactContextSnippet({ artifacts: priorArtifacts, maxChars: 6000 })
  const { intent, params } = deriveCoinbaseStepPayload(input.step)

  logCoinbaseStep(input.logger, "coinbase.step.generated", {
    userContextId,
    conversationId,
    missionRunId,
    stepId,
    missionId,
    intent,
    hasPriorArtifacts: priorArtifacts.length > 0,
  })

  inFlightIdempotencyKeys.add(idempotencyKey)
  try {
    let lastErrorCode: CoinbaseErrorCode | undefined
    let lastUserMessage = ""
    let lastRawOutput: unknown = null
    let attempts = 0
    for (let attempt = 1; attempt <= COINBASE_STEP_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt
      try {
        const primitive = mapIntentToPrimitive(intent)
        const result = await withTimeout(
          fetchCoinbaseMissionData(
            {
              primitive,
              assets: params.assets,
              quoteCurrency: params.quoteCurrency || "USD",
              thresholdPct: params.thresholdPct,
              cadence: params.cadence,
            },
            input.scope,
          ),
          COINBASE_STEP_TIMEOUT_MS,
        )
        lastRawOutput = result
        if (!result.ok) {
          lastErrorCode = "CB_STEP_FETCH_FAILED"
          lastUserMessage = userMessageForError("CB_STEP_FETCH_FAILED")
          if (attempt < COINBASE_STEP_MAX_ATTEMPTS) {
            await delay(120 * attempt)
            continue
          }
        } else {
          const summary = summarizeOutput(intent, result)
          const artifact = await persistCoinbaseStepArtifact({
            userContextId,
            conversationId,
            missionId,
            missionRunId,
            stepId,
            intent,
            summary,
            output: result,
            metadata: {
              ok: true,
              retryCount: attempt - 1,
              quoteCurrency: result.quoteCurrency,
              assets: result.assets,
            },
          })
          logCoinbaseStep(input.logger, "coinbase.step.executed", {
            userContextId,
            conversationId,
            missionRunId,
            stepId,
            missionId,
            intent,
            artifactRef: artifact.artifactRef,
            retryCount: attempt - 1,
          })
          return {
            ok: true,
            retryCount: attempt - 1,
            artifactRef: artifact.artifactRef,
            output: result,
            summary,
            recentArtifacts: priorArtifacts,
            priorArtifactContextSnippet,
          }
        }
      } catch (error) {
        const timeoutLike = error instanceof Error && /timeout/i.test(error.message)
        lastErrorCode = timeoutLike ? "CB_STEP_TIMEOUT" : "CB_STEP_UNKNOWN"
        lastUserMessage = userMessageForError(lastErrorCode)
        lastRawOutput = { error: error instanceof Error ? error.message : String(error) }
        if (attempt < COINBASE_STEP_MAX_ATTEMPTS) {
          await delay(120 * attempt)
          continue
        }
      }
    }

    const failSummary = `intent=${intent} ok=false code=${lastErrorCode || "CB_STEP_UNKNOWN"}`
    logCoinbaseStep(input.logger, "coinbase.step.failed", {
      userContextId,
      conversationId,
      missionRunId,
      stepId,
      missionId,
      intent,
      errorCode: lastErrorCode || "CB_STEP_UNKNOWN",
      retryCount: Math.max(0, attempts - 1),
    })
    return {
      ok: false,
      errorCode: lastErrorCode || "CB_STEP_UNKNOWN",
      userMessage: lastUserMessage || userMessageForError("CB_STEP_UNKNOWN"),
      retryCount: Math.max(0, attempts - 1),
      output: lastRawOutput,
      summary: failSummary,
      recentArtifacts: priorArtifacts,
      priorArtifactContextSnippet,
    }
  } finally {
    inFlightIdempotencyKeys.delete(idempotencyKey)
  }
}
