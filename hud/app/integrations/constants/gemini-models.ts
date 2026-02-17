import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { ModelOption, ModelPricing } from "./types"

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", priceHint: "Highest quality Gemini reasoning profile." },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", priceHint: "Fast/efficient Gemini profile for frequent runs." },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", priceHint: "Lowest-cost Gemini 2.5 option for lightweight automations." },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", priceHint: "Low-latency, cost-efficient Gemini option." },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", priceHint: "Most efficient legacy Gemini 2.0 profile." },
]

export const GEMINI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.2, output: 1.6 },
  "gemini-2.0-flash": { input: 0.15, output: 1.2 },
  "gemini-2.0-flash-lite": { input: 0.1, output: 0.9 },
}

export const GEMINI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GEMINI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-pro"
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
