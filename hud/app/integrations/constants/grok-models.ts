import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { ModelOption, ModelPricing } from "./types"

export const GROK_MODEL_OPTIONS: ModelOption[] = [
  { value: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning", priceHint: "Fastest 4.1 reasoning profile, very low token cost" },
  { value: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-Reasoning", priceHint: "Fast 4.1 non-reasoning profile, very low token cost" },
  { value: "grok-code-fast-1", label: "Grok Code Fast 1", priceHint: "Code-optimized fast model with higher output cost" },
  { value: "grok-4-fast-reasoning", label: "Grok 4 Fast Reasoning", priceHint: "Fast Grok 4 reasoning profile, low token cost" },
  { value: "grok-4-fast-non-reasoning", label: "Grok 4 Fast Non-Reasoning", priceHint: "Fast Grok 4 non-reasoning profile, low token cost" },
  { value: "grok-4-0709", label: "Grok 4 (0709)", priceHint: "Highest quality Grok 4 generation profile" },
  { value: "grok-3", label: "Grok 3", priceHint: "Strong general model at premium output pricing" },
  { value: "grok-3-mini", label: "Grok 3 Mini", priceHint: "Most cost-efficient Grok option" },
]

export const GROK_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "grok-4-1-fast-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-1-fast-non-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-code-fast-1": { input: 0.2, cachedInput: 0.05, output: 1.5 },
  "grok-4-fast-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-fast-non-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-0709": { input: 3.0, output: 15.0 },
  "grok-3": { input: 3.0, output: 15.0 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
  "grok-3-latest": { input: 3.0, output: 15.0 },
}

export const GROK_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GROK_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const GROK_DEFAULT_MODEL = "grok-4-0709"
export const GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1"
