export type ModelTier = "trivial" | "standard" | "hard"
export type ModelRoutingMode = "off" | "trivial" | "cost-saving"
export type ModelCallSite =
  | "chat.turn"
  | "chat.output-correction"
  | "chat.empty-reply-recovery"
  | "spotify.intent-parse"
  | "mission.ai-classify"
  | "mission.ai-extract"
  | "mission.ai-summarize"
  | "mission.ai-generate"
  | "mission.ai-chat"
  | "mission.build-from-prompt"
  | "utility.nova-suggest"
  | "utility.gmail-summary"

export type ModelRouteReason =
  | "routed"
  | "unknown-call-site"
  | "routing-off"
  | "hard-never-routed"
  | "tier-not-routed"
  | "explicit-model"
  | "no-selected-model"
  | "no-economy-model"
  | "already-economy"
  | "unpriced"
  | "economy-not-cheaper"
  | "cache-makes-selected-cheaper"

export type TurnTierReason =
  | "agent-task"
  | "lane-analysis"
  | "multi-step-reasoning"
  | "ambiguous-tool-routing"
  | "tool-result-synthesis"
  | "chat"

export interface ModelRoutingSettings {
  mode: ModelRoutingMode
  updatedAt: string | null
}

export interface ModelRoutingSettingsPatch {
  mode?: string
}

export interface ModelRouteEstimate {
  inputTokens: number
  outputTokens?: number
  /** Leading input tokens the selected model has cached right now. */
  mainWarmPrefixTokens?: number
  /** Leading input tokens the economy model has cached right now (usually 0). */
  economyWarmPrefixTokens?: number
  /** Leading input tokens the request marks for caching (Claude cache_control). */
  writePrefixTokens?: number
}

export interface ModelRoute {
  provider: string
  /** The model to send. */
  model: string
  /** The model the call would have used without routing. */
  selectedModel: string
  tier: ModelTier | null
  mode: ModelRoutingMode
  routed: boolean
  reason: ModelRouteReason
  estimatedCostUsd: { selected: number | null; economy: number | null } | null
}

export interface ResolveModelRouteInput {
  userContextId?: string
  provider: string
  model: string
  callSite: ModelCallSite | string
  turnTier?: ModelTier | string | null
  tier?: ModelTier | string | null
  explicitModel?: boolean
  settings?: { mode: string } | null
  economyModel?: string | null
  estimate?: ModelRouteEstimate | null
}

export const MODEL_ROUTING_KV_NAMESPACE: string
export const MODEL_ROUTING_KV_KEY: string
export const MODEL_TIERS: readonly ModelTier[]
export const MODEL_ROUTING_MODES: readonly ModelRoutingMode[]
export const DEFAULT_MODEL_ROUTING_MODE: ModelRoutingMode
export const MODEL_CALL_SITES: Readonly<Record<ModelCallSite, ModelTier | "turn">>
export const DEFAULT_ESTIMATED_OUTPUT_TOKENS: number

export function normalizeModelRoutingMode(value: unknown): ModelRoutingMode
export function normalizeModelTier(value: unknown): ModelTier | null
export function normalizeModelRoutingSettings(raw: unknown): ModelRoutingSettings
export function readModelRoutingSettings(userId: string): ModelRoutingSettings
/** Throws on a missing user id or an invalid mode. */
export function writeModelRoutingSettings(userId: string, patch: ModelRoutingSettingsPatch): ModelRoutingSettings
export function modeRoutesTier(mode: string, tier: string): boolean
export function classifyTurnTier(input?: {
  source?: string
  toolLoop?: boolean
  operatorLane?: { id?: string } | null
  operatorWorker?: { agentId?: string; reasoningMode?: string } | null
  text?: string
}): { tier: "standard" | "hard"; reason: TurnTierReason }
export function resolveCallSiteTier(callSite: string, options?: { turnTier?: string | null }): ModelTier | null
export function resolveCacheMinPrefixTokens(provider: string, model: string): number
export function estimateCallCostUsd(input: {
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  warmPrefixTokens?: number
  writePrefixTokens?: number
}): number | null
export function resolveEconomyModelForProvider(userId: string, provider: string): string | null
export function resolveModelRoute(input: ResolveModelRouteInput): ModelRoute
export function isModelUnavailableError(err: unknown): boolean
export function runWithRouteFallback<T>(
  route: ModelRoute,
  call: (model: string) => Promise<T>,
): Promise<{ result: T; model: string }>
export function approxTokens(value: unknown): number
