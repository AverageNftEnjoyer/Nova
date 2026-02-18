import { FluidSelect } from "@/components/ui/fluid-select"

import type { AnalyticsDateRange, AnalyticsFilters } from "../types"
import { ANALYTICS_DATE_RANGE_OPTIONS } from "../constants"

interface FilterBarProps {
  filters: AnalyticsFilters
  integrationOptions: Array<{ value: string; label: string }>
  onFiltersChange: (next: AnalyticsFilters) => void
  onClear: () => void
  isLight: boolean
}

export function FilterBar({ filters, integrationOptions, onFiltersChange, onClear, isLight }: FilterBarProps) {
  const hasActiveFilters = filters.integration !== "all" || filters.dateRange !== "24h"

  const selectButtonClass = [
    "h-9 rounded-lg text-xs font-mono",
    isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md",
  ].join(" ")

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FluidSelect
        value={filters.dateRange}
        onChange={(value) => onFiltersChange({ ...filters, dateRange: value as AnalyticsDateRange })}
        options={ANALYTICS_DATE_RANGE_OPTIONS}
        isLight={isLight}
        className="w-[190px]"
        buttonClassName={selectButtonClass}
      />

      <FluidSelect
        value={filters.integration}
        onChange={(value) => onFiltersChange({ ...filters, integration: value })}
        options={integrationOptions}
        isLight={isLight}
        className="w-[190px]"
        buttonClassName={selectButtonClass}
      />

      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="h-9 rounded-lg border border-accent-30 bg-accent-10 px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent-20"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
