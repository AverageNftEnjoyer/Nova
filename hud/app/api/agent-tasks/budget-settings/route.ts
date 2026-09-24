import { NextResponse } from "next/server"

import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  type ModelOption,
} from "@/app/integrations/constants"
import {
  AgentTaskValidationError,
  readTaskBudgetSettings,
  updateTaskBudgetSettings,
} from "@/lib/agents/task-store"
import type {
  AgentTaskBudgetProvider,
  AgentTaskBudgetSettings,
  AgentTaskBudgetSettingsResponse,
  AgentTaskEconomyModelCandidate,
} from "@/lib/agents/types"
import { requireLocalUser } from "@/lib/auth/local-user"
import {
  checkUserRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitExceededResponse,
  type RateLimitPolicy,
} from "@/lib/security/rate-limit"
import {
  AGENT_TASK_COST_BUDGET_LIMITS,
  AGENT_TASK_TOKEN_BUDGET_LIMITS,
  DEFAULT_AGENT_TASK_COST_BUDGET_USD,
  DEFAULT_AGENT_TASK_TOKEN_BUDGET,
  isValidEconomyModel,
} from "../../../../../src/runtime/modules/agent-tasks/budget-settings/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PICKER_MODELS: Record<AgentTaskBudgetProvider, readonly ModelOption[]> = {
  openai: OPENAI_MODEL_OPTIONS,
  claude: CLAUDE_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
  grok: GROK_MODEL_OPTIONS,
}

/** Economy-model choices: the provider's picker models that the budget module accepts (same provider, priced). */
function economyModelCandidates(): Record<AgentTaskBudgetProvider, AgentTaskEconomyModelCandidate[]> {
  const entries = (Object.keys(PICKER_MODELS) as AgentTaskBudgetProvider[]).map((provider) => [
    provider,
    PICKER_MODELS[provider]
      .filter((option) => isValidEconomyModel(provider, option.value))
      .map(({ value, label, priceHint }) => ({ value, label, priceHint })),
  ])
  return Object.fromEntries(entries) as Record<AgentTaskBudgetProvider, AgentTaskEconomyModelCandidate[]>
}

function payload(settings: AgentTaskBudgetSettings): { ok: true } & AgentTaskBudgetSettingsResponse {
  return {
    ok: true,
    settings,
    candidates: economyModelCandidates(),
    limits: {
      cost: { min: AGENT_TASK_COST_BUDGET_LIMITS.min, max: AGENT_TASK_COST_BUDGET_LIMITS.max },
      tokens: { min: AGENT_TASK_TOKEN_BUDGET_LIMITS.min, max: AGENT_TASK_TOKEN_BUDGET_LIMITS.max },
    },
    defaults: { costUsd: DEFAULT_AGENT_TASK_COST_BUDGET_USD, tokens: DEFAULT_AGENT_TASK_TOKEN_BUDGET },
  }
}

async function authorize(policy: RateLimitPolicy): Promise<{ userId: string } | { response: NextResponse }> {
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, policy)
  if (!limitDecision.allowed) return { response: rateLimitExceededResponse(limitDecision) }
  return { userId }
}

export async function GET() {
  const auth = await authorize(RATE_LIMIT_POLICIES.agentTasksRead)
  if ("response" in auth) return auth.response
  try {
    return NextResponse.json(payload(readTaskBudgetSettings(auth.userId)))
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load budget settings." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await authorize(RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response
  try {
    const body: unknown = await req.json().catch(() => null)
    return NextResponse.json(payload(updateTaskBudgetSettings(auth.userId, body)))
  } catch (error) {
    if (error instanceof AgentTaskValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save budget settings." },
      { status: 500 },
    )
  }
}
