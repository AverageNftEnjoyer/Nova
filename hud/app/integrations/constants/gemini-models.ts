import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { ModelOption, ModelPricing } from "./types"

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gemini-3-pro", label: "Gemini 3 Pro", priceHint: "Top-tier text model for deep reasoning and complex planning." },
  { value: "gemini-3-flash", label: "Gemini 3 Flash", priceHint: "Fast general-purpose text model with strong quality/cost balance." },
  { value: "gemini-3-flash-lite", label: "Gemini 3 Flash Lite", priceHint: "Lowest-cost Gemini 3 text model for lightweight tasks." },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", priceHint: "Reliable high-quality text model for demanding workflows." },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", priceHint: "Efficient text model for everyday chat and automation." },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", priceHint: "Budget-friendly text model for short, frequent requests." },
]

export const GEMINI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "gemini-3-pro": { input: 2.0, output: 12.0 },
  "gemini-3-flash": { input: 0.35, output: 2.8 },
  "gemini-3-flash-lite": { input: 0.2, output: 1.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.2, output: 1.6 },
}

export const GEMINI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GEMINI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-pro"
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
