/** USD per 1M tokens. cachedInput = cache read; cacheWrite = cache write (Anthropic: 5-minute rate). */
export interface ModelPricing {
  input: number
  output: number
  cachedInput?: number
  cacheWrite?: number
}

export const OPENAI_MODEL_PRICING_USD_PER_1M: Readonly<Record<string, ModelPricing>>
export const CLAUDE_MODEL_PRICING_USD_PER_1M: Readonly<Record<string, ModelPricing>>
export const GEMINI_MODEL_PRICING_USD_PER_1M: Readonly<Record<string, ModelPricing>>
export const GROK_MODEL_PRICING_USD_PER_1M: Readonly<Record<string, ModelPricing>>
/** Deprecated / superseded models that still answer API calls (cost only; not offered in pickers). */
export const LEGACY_MODEL_PRICING_USD_PER_1M: Readonly<Record<string, ModelPricing>>

export function resolveModelPricing(model: string): ModelPricing | null
/** promptTokens = total input; the optional split bills cached / cache-write input at their own rates. */
export function estimateTokenCostUsd(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
  cache?: { cachedInputTokens?: number; cacheWriteInputTokens?: number },
): number | null
