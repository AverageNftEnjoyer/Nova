import type { ModelPricing } from "./types"
import { OPENAI_MODEL_PRICING_USD_PER_1M } from "./openai-models"
import { CLAUDE_MODEL_PRICING_USD_PER_1M, CLAUDE_MODEL_OPTIONS } from "./claude-models"
import { GROK_MODEL_PRICING_USD_PER_1M } from "./grok-models"
import { GEMINI_MODEL_PRICING_USD_PER_1M } from "./gemini-models"

export function resolveModelPricing(model: string): ModelPricing | null {
  if (!model) return null
  if (OPENAI_MODEL_PRICING_USD_PER_1M[model]) return OPENAI_MODEL_PRICING_USD_PER_1M[model]
  if (CLAUDE_MODEL_PRICING_USD_PER_1M[model]) return CLAUDE_MODEL_PRICING_USD_PER_1M[model]
  if (GROK_MODEL_PRICING_USD_PER_1M[model]) return GROK_MODEL_PRICING_USD_PER_1M[model]
  if (GEMINI_MODEL_PRICING_USD_PER_1M[model]) return GEMINI_MODEL_PRICING_USD_PER_1M[model]

  const normalized = model.trim().toLowerCase()

  // Claude fallbacks
  if (normalized.includes("claude-opus-4-6") || normalized.includes("claude-opus-4.6")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 }

  // Grok fallbacks
  if (normalized.includes("grok-4-1-fast-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-1-fast-non-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-code-fast-1")) return { input: 0.2, output: 1.5 }
  if (normalized.includes("grok-4-fast-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-fast-non-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-0709")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("grok-3-mini")) return { input: 0.3, output: 0.5 }
  if (normalized.includes("grok-3")) return { input: 3.0, output: 15.0 }

  // Gemini fallbacks
  if (normalized.includes("gemini-3-pro")) return { input: 2.0, output: 12.0 }
  if (normalized.includes("gemini-3-flash-lite")) return { input: 0.2, output: 1.5 }
  if (normalized.includes("gemini-3-flash")) return { input: 0.35, output: 2.8 }
  if (normalized.includes("gemini-2.5-pro")) return { input: 1.25, output: 10.0 }
  if (normalized.includes("gemini-2.5-flash")) return { input: 0.3, output: 2.5 }
  if (normalized.includes("gemini-2.5-flash-lite")) return { input: 0.2, output: 1.6 }

  return null
}

export function estimateDailyCostRange(model: string): string {
  const pricing = resolveModelPricing(model)
  if (!pricing) return "N/A"
  const cacheHitRate = pricing.cachedInput ? 0.5 : 0
  const estimate = (totalTokens: number) => {
    const inputTokens = totalTokens / 2
    const outputTokens = totalTokens / 2
    const cachedInputTokens = inputTokens * cacheHitRate
    const uncachedInputTokens = inputTokens - cachedInputTokens
    const inputCost = (uncachedInputTokens / 1_000_000) * pricing.input
    const cachedInputCost = pricing.cachedInput ? (cachedInputTokens / 1_000_000) * pricing.cachedInput : 0
    const outputCost = (outputTokens / 1_000_000) * pricing.output
    return inputCost + cachedInputCost + outputCost
  }
  const min = estimate(20_000)
  const max = estimate(40_000)
  return `$${min.toFixed(2)}-$${max.toFixed(2)}/day`
}

export function getClaudePriceHint(model: string): string {
  const preset = CLAUDE_MODEL_OPTIONS.find((option) => option.value === model)
  if (preset) return preset.priceHint
  const pricing = resolveModelPricing(model)
  if (!pricing) return "Pricing for this model is not in local presets yet."
  return `Estimated pricing for this model tier: $${pricing.input.toFixed(2)} in / $${pricing.output.toFixed(2)} out per 1M tokens.`
}
