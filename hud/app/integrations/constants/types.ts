import type { FluidSelectOption } from "@/components/ui/fluid-select"

export type ModelPricing = {
  input: number
  output: number
  cachedInput?: number
}

export type ModelOption = {
  value: string
  label: string
  priceHint: string
}

export type { FluidSelectOption }
