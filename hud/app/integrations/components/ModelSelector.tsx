"use client"

import { cn } from "@/lib/utils"
import { FluidSelect, type FluidSelectOption } from "@/components/ui/fluid-select"

export interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
  options: FluidSelectOption[]
  label?: string
  costEstimate: string
  priceHint?: string
  usageNote?: string
  isLight: boolean
  subPanelClass: string
}

export function ModelSelector({
  value,
  onChange,
  options,
  label = "Default Model",
  costEstimate,
  priceHint,
  usageNote,
  isLight,
  subPanelClass,
}: ModelSelectorProps) {
  return (
    <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
      <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
        {label}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 items-stretch">
        <FluidSelect
          value={value}
          onChange={onChange}
          options={options}
          isLight={isLight}
        />
        <div
          className={cn(
            "h-9 rounded-md border px-2.5 flex items-center justify-end text-xs tabular-nums",
            isLight ? "border-[#d5dce8] bg-[#eef3fb] text-s-70" : "border-white/10 bg-black/20 text-slate-300"
          )}
          title="Estimated daily cost for 20k-40k total tokens/day (50/50 input/output)."
        >
          {costEstimate}
        </div>
      </div>
      {priceHint && (
        <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
          {priceHint}
        </p>
      )}
      {usageNote && (
        <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
          {usageNote}
        </p>
      )}
    </div>
  )
}
