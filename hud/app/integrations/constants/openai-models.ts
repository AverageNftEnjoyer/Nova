import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { ModelOption, ModelPricing } from "./types"

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-5.2", label: "GPT-5.2", priceHint: "Latest flagship quality, premium token cost" },
  { value: "gpt-5.2-pro", label: "GPT-5.2 Pro", priceHint: "Highest precision, highest cost (availability-based)" },
  { value: "gpt-5", label: "GPT-5", priceHint: "High-quality reasoning and coding" },
  { value: "gpt-5-mini", label: "GPT-5 Mini", priceHint: "Lower-cost GPT-5 variant" },
  { value: "gpt-5-nano", label: "GPT-5 Nano", priceHint: "Fastest and cheapest GPT-5 variant" },
  { value: "gpt-4.1", label: "GPT-4.1", priceHint: "Balanced quality/cost" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", priceHint: "Lower cost for routine tasks" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", priceHint: "Most cost-efficient GPT-4.1 variant" },
  { value: "gpt-4o", label: "GPT-4o", priceHint: "Strong multimodal quality" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", priceHint: "Lightweight multimodal" },
]

export const OPENAI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "gpt-5.2": { input: 1.75, output: 14.0 },
  "gpt-5.2-pro": { input: 12.0, output: 96.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.6, output: 2.4 },
}

export const OPENAI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = OPENAI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const OPENAI_DEFAULT_MODEL = "gpt-4.1"
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
