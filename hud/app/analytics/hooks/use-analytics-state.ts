import { useEffect, useMemo, useState } from "react"

import { ANALYTICS_FILTER_STORAGE_KEY, ANALYTICS_LAYOUT_STORAGE_KEY, ANALYTICS_MODULES, DEFAULT_ANALYTICS_FILTERS } from "../constants"
import type { AnalyticsFilters, AnalyticsLayoutState, AnalyticsModuleKey } from "../types"

function getDefaultLayout(): AnalyticsLayoutState {
  return {
    moduleVisibility: ANALYTICS_MODULES.reduce(
      (acc, module) => ({ ...acc, [module.key]: module.defaultEnabled }),
      {} as Record<AnalyticsModuleKey, boolean>,
    ),
  }
}

function parseLayout(raw: string | null): AnalyticsLayoutState {
  if (!raw) return getDefaultLayout()
  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsLayoutState>
    return {
      moduleVisibility: {
        ...getDefaultLayout().moduleVisibility,
        ...(parsed.moduleVisibility || {}),
      },
    }
  } catch {
    return getDefaultLayout()
  }
}

function parseFilters(raw: string | null): AnalyticsFilters {
  if (!raw) return DEFAULT_ANALYTICS_FILTERS
  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsFilters>
    return {
      ...DEFAULT_ANALYTICS_FILTERS,
      ...parsed,
      category: "all",
    }
  } catch {
    return DEFAULT_ANALYTICS_FILTERS
  }
}

export function useAnalyticsState() {
  const [layout, setLayout] = useState<AnalyticsLayoutState>(() => {
    if (typeof window === "undefined") return getDefaultLayout()
    return parseLayout(window.localStorage.getItem(ANALYTICS_LAYOUT_STORAGE_KEY))
  })
  const [filters, setFilters] = useState<AnalyticsFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_ANALYTICS_FILTERS
    return parseFilters(window.localStorage.getItem(ANALYTICS_FILTER_STORAGE_KEY))
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(ANALYTICS_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  }, [layout])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(ANALYTICS_FILTER_STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const enabledModules = useMemo(() => layout.moduleVisibility, [layout.moduleVisibility])

  const toggleModule = (key: AnalyticsModuleKey) => {
    setLayout((prev) => ({
      moduleVisibility: {
        ...prev.moduleVisibility,
        [key]: !prev.moduleVisibility[key],
      },
    }))
  }

  const resetLayout = () => setLayout(getDefaultLayout())
  const resetFilters = () => setFilters(DEFAULT_ANALYTICS_FILTERS)

  return {
    filters,
    setFilters,
    enabledModules,
    toggleModule,
    resetLayout,
    resetFilters,
  }
}
