import type { SelectOption } from "@/components/ui/select"

// Same shape as ModelPricing in src/providers/pricing (USD per 1M tokens), the single price source.
export type ModelPricing = {
  input: number
  output: number
  cachedInput?: number
  cacheWrite?: number
}

export type ModelOption = {
  value: string
  label: string
  priceHint: string
}

export type { SelectOption }
