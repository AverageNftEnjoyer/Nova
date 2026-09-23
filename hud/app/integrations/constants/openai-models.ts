import type { FluidSelectOption } from "@/components/ui/fluid-select"
import { formatModelPriceHint } from "./pricing"
import type { ModelOption } from "./types"

export { OPENAI_MODEL_PRICING_USD_PER_1M } from "../../../../src/providers/pricing/index.js"

// Default first. GPT-6 models are priced (src/providers/pricing) but not offered: on Chat Completions they only
// support function calling with reasoning_effort "none" (GPT-6 Astra not at all), which Nova's tool loop doesn't send.
export const OPENAI_DEFAULT_MODEL = "gpt-5.6-terra"

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  { value: OPENAI_DEFAULT_MODEL, label: "GPT-5.6 Terra", priceHint: formatModelPriceHint(OPENAI_DEFAULT_MODEL) },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", priceHint: formatModelPriceHint("gpt-5.6-sol") },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", priceHint: formatModelPriceHint("gpt-5.6-luna") },
]

export const OPENAI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = OPENAI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
