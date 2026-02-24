"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart3, Settings } from "lucide-react"

import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { SettingsModal } from "@/components/settings/settings-modal"
import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor } from "@/lib/settings/userSettings"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { NOVA_VERSION } from "@/lib/meta/version"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { hexToRgba } from "@/app/integrations/constants"

import { FilterBar } from "./filter-bar"
import { StatsStrip } from "./stats-strip"
import { IntegrationBreakdownTable } from "./integration-breakdown-table"
import { ApiBalancesPanel } from "./api-balances-panel"
import { ActivityFeedPanel } from "./activity-feed-panel"
import { RequestVolumePanel } from "./request-volume-panel"
import { UsageDistributionPanel } from "./usage-distribution-panel"
import { ModuleSettingsMenu } from "./module-settings-menu"
import { useAnalyticsState } from "../hooks/use-analytics-state"
import { useAnalyticsData } from "../hooks/use-analytics-data"
import { useAnalyticsSpotlight } from "../hooks/use-analytics-spotlight"
import { DEFAULT_ANALYTICS_FILTERS } from "../constants"


export function AnalyticsScreen() {
  const router = useRouter()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"

  const [orbHovered, setOrbHovered] = useState(false)
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const statsRef = useRef<HTMLDivElement | null>(null)
  const apiBalancesRef = useRef<HTMLDivElement | null>(null)
  const integrationRef = useRef<HTMLDivElement | null>(null)
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const requestVolumeRef = useRef<HTMLDivElement | null>(null)
  const usageDistributionRef = useRef<HTMLDivElement | null>(null)

  const { filters, setFilters, enabledModules, toggleModule, resetLayout, resetFilters } = useAnalyticsState()
  const { integrationRows, requestVolume, usageSlices, apiBalances, activityFeed } = useAnalyticsData(filters)

  useAnalyticsSpotlight(
    spotlightEnabled,
    [
      { ref: shellRef, showSpotlightCore: false },
      { ref: statsRef },
      { ref: apiBalancesRef },
      { ref: integrationRef },
      { ref: activityFeedRef, showSpotlightCore: false },
      { ref: requestVolumeRef },
      { ref: usageDistributionRef },
    ],
    [enabledModules, filters.dateRange, filters.integration],
  )

  useEffect(() => {
    const syncFromSettings = () => {
      const user = loadUserSettings()
      const cached = readShellUiCache()
      const nextOrb = cached.orbColor ?? user.app.orbColor
      const nextSpotlight = cached.spotlightEnabled ?? (user.app.spotlightEnabled ?? true)
      setOrbColor(nextOrb)
      setSpotlightEnabled(nextSpotlight)
      writeShellUiCache({ orbColor: nextOrb, spotlightEnabled: nextSpotlight })
    }

    syncFromSettings()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
  }, [])

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }

    window.addEventListener("mousedown", handleOutside)
    return () => window.removeEventListener("mousedown", handleOutside)
  }, [])

  const orbPalette = ORB_COLORS[orbColor]
  const presence = getNovaPresence({ agentConnected, novaState })
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`

  // Same glass panel treatment as Mission Pipeline on home page.
  // Background + spotlight ref live on the same element so the glow renders ON the glass.
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const panelClass = isLight
    ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
    : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  // Module shells must always use this exact pair to keep frosted-glass stable.
  const moduleShellStyle = panelStyle
  const moduleShellClass = `home-spotlight-shell ${panelClass}`

  const integrationOptions = useMemo(
    () => [{ value: "all", label: "All Integrations" }, ...integrationRows.map((row) => ({ value: row.slug, label: row.name }))],
    [integrationRows],
  )

  const updateFilters = useCallback((next: typeof filters) => setFilters(next), [setFilters])

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden px-4 py-4 sm:px-6">
        <header className="mb-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/home")}
                onMouseEnter={() => setOrbHovered(true)}
                onMouseLeave={() => setOrbHovered(false)}
                className="h-11 w-11 rounded-full transition-transform duration-150 hover:scale-110"
                aria-label="Go to home"
              >
                <NovaOrbIndicator
                  palette={orbPalette}
                  size={30}
                  animated={pageActive}
                  className="transition-all duration-200"
                  style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                />
              </button>
              <div>
                <div className="flex items-baseline gap-3">
                  <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                  <p className="text-[11px] font-mono text-accent">{NOVA_VERSION}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} />
                  <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>{presence.label}</span>
                  <p className={cn("text-[13px]", isLight ? "text-s-50" : "text-slate-400")}>Analytics Hub</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div ref={shellRef} className="home-spotlight-shell">
                <FilterBar
                  filters={filters}
                  integrationOptions={integrationOptions}
                  onFiltersChange={updateFilters}
                  onClear={() => {
                    resetFilters()
                    setFilters(DEFAULT_ANALYTICS_FILTERS)
                  }}
                  isLight={isLight}
                />
              </div>

              {/* Header icon controls only. Do not use moduleShellClass here. */}
              <div ref={menuRef} className="relative">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMenuOpen((prev) => !prev)}
                    className={cn(
                      "h-8 w-8 rounded-lg transition-colors home-spotlight-card home-spotlight-card--hover",
                      isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md",
                    )}
                    aria-label="Analytics module settings"
                    title="Analytics module settings"
                  >
                    <BarChart3 className="w-3.5 h-3.5 mx-auto text-s-50 transition-colors hover:text-accent" />
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setSettingsOpen(true)
                    }}
                    className={cn(
                      "h-8 w-8 rounded-lg transition-colors home-spotlight-card home-spotlight-card--hover group/gear",
                      isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md",
                    )}
                    aria-label="Open user settings"
                    title="Open user settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>
                <ModuleSettingsMenu
                  open={menuOpen}
                  isLight={isLight}
                  enabledModules={enabledModules}
                  onToggle={toggleModule}
                  onReset={resetLayout}
                  onClose={() => setMenuOpen(false)}
                />
              </div>
            </div>
          </div>

          {enabledModules.stats && (
            <div ref={statsRef} style={moduleShellStyle} className={`${moduleShellClass} p-4`}>
              <StatsStrip rows={integrationRows} isLight={isLight} />
            </div>
          )}
        </header>

        <div className="overflow-y-auto pb-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {enabledModules.apiBalances && (
              <div ref={apiBalancesRef} style={moduleShellStyle} className={moduleShellClass}>
                <ApiBalancesPanel balances={apiBalances} isLight={isLight} />
              </div>
            )}
            {enabledModules.integrationBreakdown && (
              <div ref={integrationRef} style={moduleShellStyle} className={moduleShellClass}>
                <IntegrationBreakdownTable rows={integrationRows} isLight={isLight} />
              </div>
            )}
            {enabledModules.activityFeed && (
              <div ref={activityFeedRef} style={moduleShellStyle} className={cn(moduleShellClass, "h-140 min-h-0")}>
                <ActivityFeedPanel events={activityFeed} isLight={isLight} />
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div ref={requestVolumeRef} style={moduleShellStyle} className={cn(moduleShellClass, "h-140 xl:col-span-2")}>
              <RequestVolumePanel points={requestVolume} category={filters.category} isLight={isLight} />
            </div>
            <div ref={usageDistributionRef} style={moduleShellStyle} className={`${moduleShellClass} h-140`}>
              <UsageDistributionPanel slices={usageSlices} isLight={isLight} />
            </div>
          </div>
        </div>
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
