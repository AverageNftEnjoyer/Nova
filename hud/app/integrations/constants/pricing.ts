import {
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  OPENAI_MODEL_PRICING_USD_PER_1M,
  resolveModelPricing as resolveSharedModelPricing,
} from "../../../../src/providers/pricing/index.js"
import type { ModelPricing } from "./types"

// Prices come from the single shared table in src/providers/pricing (official rates, sources documented there).
// Lookup is by exact model ID: an unknown ID is unpriced (null) rather than guessed from its family prefix.

const CURRENT_PRICING_TABLES: readonly Readonly<Record<string, ModelPricing>>[] = [
  OPENAI_MODEL_PRICING_USD_PER_1M,
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
]

export function resolveModelPricing(model: string): ModelPricing | null {
  return resolveSharedModelPricing(model)
}

/** True for a model still priced (it still answers API calls) but no longer offered in Nova's pickers. */
function isLegacyPricedModel(model: string): boolean {
  const key = String(model || "").trim().toLowerCase()
  if (!key || !resolveModelPricing(key)) return false
  return !CURRENT_PRICING_TABLES.some((table) => Object.prototype.hasOwnProperty.call(table, key))
}

function formatUsdRate(value: number): string {
  // Keep sub-cent rates exact (e.g. $0.075) instead of rounding them to a misleading two decimals.
  return value >= 0.1 ? value.toFixed(2) : String(Number(value.toFixed(4)))
}

/** Picker hint built from the shared price table only; unpriced models say so instead of showing an estimate. */
export function formatModelPriceHint(model: string): string {
  const pricing = resolveModelPricing(model)
  if (!pricing) return "Pricing unknown for this model."
  const cached = typeof pricing.cachedInput === "number" ? `, cached input $${formatUsdRate(pricing.cachedInput)}` : ""
  const legacy = isLegacyPricedModel(model) ? " Older model, no longer in Nova's list." : ""
  return `$${formatUsdRate(pricing.input)} in / $${formatUsdRate(pricing.output)} out per 1M tokens${cached}.${legacy}`
}

export function estimateDailyCostRange(model: string): string {
  const pricing = resolveModelPricing(model)
  if (!pricing) return "Pricing unknown"
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
  return formatModelPriceHint(model)
}
