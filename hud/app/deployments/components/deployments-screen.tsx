"use client"

import { Plus } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState, type CSSProperties } from "react"

import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { WindowControls } from "@/components/window/window-controls"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useTheme } from "@/lib/context/theme-context"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { primaryButtonClass } from "@/lib/shared/surfaces"
import { cn } from "@/lib/shared/utils"
import { useHomeVisuals } from "@/app/home/hooks/use-home-visuals"
import { isRunActive, runNeedsReview, useDeploymentsData } from "../hooks/use-deployments-data"
import { DeploymentsOverview } from "./deployments-overview"
import { newDeploymentTabFromParams, newDeploymentTabHref, type NewDeploymentTab } from "./new-deployment-tabs"
import { LazyNewDeploymentModal, preloadNewDeploymentModal } from "./new-deployment-modal-lazy"

const DRAG_REGION = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG_REGION = { WebkitAppRegion: "no-drag" } as CSSProperties

export function DeploymentsScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { panelClass, subPanelClass, panelStyle, orbPalette, homeShellRef } = useHomeVisuals({ isLight })
  const nova = useNovaState()
  const data = useDeploymentsData()
  const presence = getNovaPresence({ agentConnected: nova.connected, novaState: nova.state })
  // Deep links (`?mode=simple`, `?mode=advanced&kind=task|automation`) open the popup over this page.
  const deepLinkMode = searchParams.get("mode")
  const [composerTab, setComposerTab] = useState<NewDeploymentTab | null>(() =>
    deepLinkMode ? newDeploymentTabFromParams(deepLinkMode, searchParams.get("kind")) : null,
  )

  const stats = useMemo(() => {
    let active = 0
    let review = 0
    let succeeded = 0
    for (const run of data.runs) {
      if (runNeedsReview(run)) review += 1
      else if (isRunActive(run)) active += 1
      if (run.status === "succeeded") succeeded += 1
    }
    return [
      { label: "Deployments", value: data.deployments.length, dot: isLight ? "bg-s-40" : "bg-slate-400" },
      { label: "Active runs", value: active, dot: "bg-sky-400" },
      { label: "Needs review", value: review, dot: "bg-amber-400" },
      { label: "Succeeded", value: succeeded, dot: "bg-emerald-400" },
    ]
  }, [data.deployments.length, data.runs, isLight])

  const openComposer = () => setComposerTab("describe")
  const closeComposer = () => {
    setComposerTab(null)
    if (deepLinkMode) router.replace("/deployments", { scroll: false })
  }
  const mutedText = isLight ? "text-s-50" : "text-slate-400"

  return (
    <div
      style={panelStyle}
      className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}
    >
      <div ref={homeShellRef} className="home-spotlight-shell relative flex-1 overflow-hidden">
        <div className="relative z-10 flex h-full w-full flex-col gap-1.5 px-4 pb-4 pt-3">
          <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3" style={DRAG_REGION}>
            <div className="flex min-w-0 items-center gap-3" style={NO_DRAG_REGION}>
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="grid h-11 w-11 place-items-center rounded-full transition-transform duration-150 hover:scale-110"
                aria-label="Back to Home"
                title="Home"
              >
                <NovaOrbIndicator palette={orbPalette} size={30} animated={pageActive} />
              </button>
              <div className="min-w-0 leading-tight">
                <div className="flex items-baseline gap-3">
                  <h1 className={cn("text-[30px] font-semibold leading-none tracking-tight", isLight ? "text-s-90" : "text-white")}>
                    NovaAIO
                  </h1>
                  <p className="font-mono text-[11px] text-accent">{NOVA_VERSION}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 animate-pulse rounded-full", presence.dotClassName)} aria-hidden="true" />
                    <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                      {presence.label}
                    </span>
                  </span>
                  <p className={cn("whitespace-nowrap text-[13px]", mutedText)}>Deployments</p>
                </div>
              </div>
            </div>

            <div className="min-w-0 px-1" style={NO_DRAG_REGION}>
              <dl className="mx-auto hidden w-full max-w-176 grid-cols-4 gap-1.5 lg:grid">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className={cn("flex h-11 items-center justify-between gap-2 rounded-md px-2.5 home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <div className="min-w-0">
                      <dt className={cn("truncate text-[9px] uppercase tracking-[0.12em]", mutedText)}>{stat.label}</dt>
                      <dd className={cn("text-sm font-semibold leading-tight tabular-nums", isLight ? "text-s-90" : "text-slate-100")}>
                        {data.loading ? "–" : stat.value}
                      </dd>
                    </div>
                    <span className={cn("h-2 w-2 shrink-0 rounded-sm", stat.dot)} aria-hidden="true" />
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex items-center gap-2" style={NO_DRAG_REGION}>
              <button
                type="button"
                onClick={openComposer}
                onPointerEnter={() => void preloadNewDeploymentModal()}
                onFocus={() => void preloadNewDeploymentModal()}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
                  "home-spotlight-card home-border-glow home-spotlight-card--hover",
                  primaryButtonClass(isLight),
                )}
              >
                <Plus className="h-4 w-4 text-accent" />
                New deployment
              </button>
              <WindowControls />
            </div>
          </header>

          <DeploymentsOverview
            isLight={isLight}
            panelClass={panelClass}
            subPanelClass={subPanelClass}
            panelStyle={panelStyle}
            data={data}
            onCreate={openComposer}
          />
        </div>
      </div>

      {composerTab ? (
        <LazyNewDeploymentModal
          isLight={isLight}
          nova={nova}
          initialTab={composerTab}
          onClose={closeComposer}
          onTabChange={(tab) => {
            if (deepLinkMode) router.replace(newDeploymentTabHref(tab), { scroll: false })
          }}
          onOpenGuidedBuilder={() => router.push("/missions?create=builder&returnTo=/deployments")}
          onViewAutomations={() => router.push("/missions?returnTo=/deployments")}
        />
      ) : null}
    </div>
  )
}
