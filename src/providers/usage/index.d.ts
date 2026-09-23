export type LlmUsageSource = "chat" | "agent-task" | "mission"

/** Normalised usage for one call (or a sum of calls). inputTokens is the TOTAL input, cached and cache-write included. */
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
}

export interface LlmUsageRecord extends LlmUsage {
  userId: string
  ts: string
  source: LlmUsageSource
  refId: string
  provider: string
  model: string
  /** null when the model has no known pricing. */
  costUsd: number | null
}

export interface RecordLlmUsageInput {
  userContextId?: string
  /** Explicit ledger source; when omitted it is derived from conversationId. */
  source?: LlmUsageSource
  refId?: string
  conversationId?: string
  provider?: string
  model?: string
  usage?: Partial<LlmUsage> | null
  ts?: string
}

export const LLM_USAGE_SOURCES: readonly LlmUsageSource[]
export function emptyLlmUsage(): LlmUsage
export function normalizeOpenAiCompatibleUsage(raw: unknown): LlmUsage
export function normalizeAnthropicUsage(raw: unknown): LlmUsage
export function mergeAnthropicStreamUsage(
  accumulator: Record<string, number> | null | undefined,
  rawUsage: unknown,
): Record<string, number>
export function normalizeLlmUsage(provider: string, raw: unknown): LlmUsage
export function addLlmUsage(...usages: Array<Partial<LlmUsage> | null | undefined>): LlmUsage
export function toLegacyUsageFields(usage: Partial<LlmUsage> | null | undefined): { promptTokens: number; completionTokens: number }
export function resolveLlmUsageSource(input?: { source?: string; refId?: string; conversationId?: string }): {
  source: LlmUsageSource
  refId: string
}
export function withLlmUsageObserver<T>(observer: (record: LlmUsageRecord) => void, fn: () => T): T
/** Never throws. Returns the ledger row id, or null when nothing was written. */
export function recordLlmUsageSafe(input?: RecordLlmUsageInput): string | null
