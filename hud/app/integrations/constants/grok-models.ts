import type { FluidSelectOption } from "@/components/ui/fluid-select"
import { formatModelPriceHint } from "./pricing"
import type { ModelOption } from "./types"

export { GROK_MODEL_PRICING_USD_PER_1M } from "../../../../src/providers/pricing/index.js"

// Default first.
export const GROK_DEFAULT_MODEL = "grok-4.3"

export const GROK_MODEL_OPTIONS: ModelOption[] = [
  { value: GROK_DEFAULT_MODEL, label: "Grok 4.3", priceHint: formatModelPriceHint(GROK_DEFAULT_MODEL) },
  { value: "grok-4.7", label: "Grok 4.7", priceHint: formatModelPriceHint("grok-4.7") },
  { value: "grok-build-0.1", label: "Grok Build 0.1", priceHint: formatModelPriceHint("grok-build-0.1") },
]

export const GROK_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GROK_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))

export const GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1"
