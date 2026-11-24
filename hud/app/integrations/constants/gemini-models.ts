import type { FluidSelectOption } from "@/components/ui/fluid-select"
import { formatModelPriceHint } from "./pricing"
import type { ModelOption } from "./types"

export { GEMINI_MODEL_PRICING_USD_PER_1M } from "../../../../src/providers/pricing/index.js"

// Default first.
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { value: GEMINI_DEFAULT_MODEL, label: "Gemini 3.8 Flash", priceHint: formatModelPriceHint(GEMINI_DEFAULT_MODEL) },
  {
    value: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    priceHint: `Preview model. ${formatModelPriceHint("gemini-3.1-pro-preview")}`,
  },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", priceHint: formatModelPriceHint("gemini-3.5-flash-lite") },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", priceHint: formatModelPriceHint("gemini-3.1-flash-lite") },
]

export const GEMINI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GEMINI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
