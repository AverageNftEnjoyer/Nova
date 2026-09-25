import { NextResponse } from "next/server"

import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  type ModelOption,
} from "@/app/integrations/constants"
import { readTaskBudgetSettings } from "@/lib/agents/task-store"
import type { AgentTaskBudgetProvider } from "@/lib/agents/types"
import { requireLocalUser } from "@/lib/auth/local-user"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import {
  checkUserRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitExceededResponse,
  type RateLimitPolicy,
} from "@/lib/security/rate-limit"
import type { ModelRoutingSettings, ModelRoutingSettingsResponse } from "@/lib/settings/model-routing/types"
import {
  DEFAULT_MODEL_ROUTING_MODE,
  MODEL_ROUTING_MODES,
  readModelRoutingSettings,
  writeModelRoutingSettings,
} from "../../../../src/runtime/modules/model-routing/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PICKER_MODELS: Record<AgentTaskBudgetProvider, readonly ModelOption[]> = {
  openai: OPENAI_MODEL_OPTIONS,
  claude: CLAUDE_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
  grok: GROK_MODEL_OPTIONS,
}

function modelLabel(provider: AgentTaskBudgetProvider, model: string): string {
  return PICKER_MODELS[provider].find((option) => option.value === model)?.label ?? model
}

/** The active provider and its selected model (never a key); nulls when the integrations config can't be read. */
async function readActiveSelection(
  userId: string,
): Promise<Pick<ModelRoutingSettingsResponse, "activeProvider" | "activeModel">> {
  try {
    const config = await loadIntegrationsConfig({ userId })
    const provider = config.activeLlmProvider
    return { activeProvider: provider, activeModel: config[provider].defaultModel.trim() || null }
  } catch {
    return { activeProvider: null, activeModel: null }
  }
}

async function payload(userId: string, settings: ModelRoutingSettings): Promise<{ ok: true } & ModelRoutingSettingsResponse> {
  const { economyModels } = readTaskBudgetSettings(userId)
  const providers = Object.keys(PICKER_MODELS) as AgentTaskBudgetProvider[]
  const economyModelLabels = Object.fromEntries(
    providers.map((provider) => [provider, modelLabel(provider, economyModels[provider])]),
  ) as Record<AgentTaskBudgetProvider, string>
  return {
    ok: true,
    settings,
    defaultMode: DEFAULT_MODEL_ROUTING_MODE,
    modes: [...MODEL_ROUTING_MODES],
    economyModels,
    economyModelLabels,
    ...(await readActiveSelection(userId)),
  }
}

// Same buckets as the Agent budgets settings: both are small per-user settings rows edited from the Settings modal.
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
    return NextResponse.json(await payload(auth.userId, readModelRoutingSettings(auth.userId)))
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load model routing settings." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await authorize(RATE_LIMIT_POLICIES.agentTasksWrite)
  if ("response" in auth) return auth.response
  const body: unknown = await req.json().catch(() => null)
  const mode = body && typeof body === "object" && !Array.isArray(body) ? (body as { mode?: unknown }).mode : undefined
  if (typeof mode !== "string" || !(MODEL_ROUTING_MODES as readonly string[]).includes(mode.trim().toLowerCase())) {
    return NextResponse.json(
      { ok: false, error: "Choose a routing mode: Off, Trivial calls only or Cost-saving." },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json(await payload(auth.userId, writeModelRoutingSettings(auth.userId, { mode })))
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save model routing settings." },
      { status: 500 },
    )
  }
}
