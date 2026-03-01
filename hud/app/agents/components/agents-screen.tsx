"use client"

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useRouter } from "next/navigation"
import { Bot, Brain, Compass, GitBranch, Network, Settings, ShieldCheck, Workflow } from "lucide-react"

import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useTheme } from "@/lib/context/theme-context"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { useSpotlightEffect } from "@/app/integrations/hooks"
import { NOVA_VERSION } from "@/lib/meta/version"
import {
  NOVA_COUNCIL_NODES,
  NOVA_DOMAIN_MANAGERS,
  NOVA_OPERATOR_NODE,
  PROVIDER_RAIL,
  type AgentStatus,
  type DomainManagerNode,
} from "../agent-chart-data"

function statusClass(status: AgentStatus): string {
  if (status === "online") return "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
  if (status === "busy") return "border-amber-300/40 bg-amber-500/15 text-amber-200"
  return "border-rose-300/40 bg-rose-500/15 text-rose-200"
}

function providerClass(provider: string): string {
  const value = String(provider || "").trim().toLowerCase()
  if (value === "openai") return "border-emerald-300/35 bg-emerald-500/12 text-emerald-200"
  if (value === "claude") return "border-orange-300/35 bg-orange-500/12 text-orange-200"
  if (value === "grok") return "border-fuchsia-300/35 bg-fuchsia-500/12 text-fuchsia-200"
  if (value === "gemini") return "border-cyan-300/35 bg-cyan-500/12 text-cyan-200"
  return "border-white/20 bg-white/10 text-slate-200"
}

function managerAccentClass(accent: DomainManagerNode["accent"]): string {
  if (accent === "emerald") return "border-emerald-300/35"
  if (accent === "amber") return "border-amber-300/35"
  if (accent === "violet") return "border-violet-300/35"
  if (accent === "cyan") return "border-cyan-300/35"
  if (accent === "rose") return "border-rose-300/35"
  return "border-sky-300/35"
}

const COUNCIL_ICON_BY_ID: Record<string, ComponentType<{ className?: string }>> = {
  "routing-council": Compass,
  "policy-council": ShieldCheck,
  "memory-council": Brain,
}

export function AgentsScreen() {
  const router = useRouter()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)

  const shellRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const sync = () => {
      const settings = loadUserSettings()
      const cached = readShellUiCache()
      const nextOrbColor = cached.orbColor ?? settings.app.orbColor
      const nextSpotlight = cached.spotlightEnabled ?? (settings.app.spotlightEnabled ?? true)
      setOrbColor(nextOrbColor)
      setSpotlightEnabled(nextSpotlight)
      writeShellUiCache({ orbColor: nextOrbColor, spotlightEnabled: nextSpotlight })
    }

    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useSpotlightEffect(
    spotlightEnabled,
    [
      { ref: shellRef, showSpotlightCore: false },
      { ref: chartRef, showSpotlightCore: false },
      { ref: railRef, showSpotlightCore: false },
    ],
    [isLight, spotlightEnabled],
  )

  const palette = ORB_COLORS[orbColor]
  const presence = getNovaPresence({ agentConnected, novaState })

  const totalWorkers = useMemo(
    () => NOVA_DOMAIN_MANAGERS.reduce((sum, manager) => sum + manager.workers.length, 0),
    [],
  )
  const onlineWorkers = useMemo(
    () =>
      NOVA_DOMAIN_MANAGERS.reduce(
        (sum, manager) => sum + manager.workers.filter((worker) => worker.status === "online").length,
        0,
      ),
    [],
  )

  const panelClass = isLight
    ? "rounded-2xl border border-[#d9e0ea] bg-white"
    : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_20px_60px_-35px_rgba(var(--accent-rgb),0.35)]"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const railPanelClass = isLight
    ? "rounded-xl border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-xl border border-white/10 bg-black/25 backdrop-blur-md"

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>
      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden px-4 py-4 sm:px-6">
        <header className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/home")}
                className="h-11 w-11 rounded-full transition-transform duration-150 hover:scale-110"
                aria-label="Go to home"
              >
                <NovaOrbIndicator palette={palette} size={30} animated={pageActive} />
              </button>
              <div>
                <div className="flex items-baseline gap-3">
                  <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                  <p className="text-[11px] font-mono text-accent">{NOVA_VERSION}</p>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <Network className={cn("h-3.5 w-3.5", isLight ? "text-slate-600" : "text-slate-300")} />
                  <span className={cn("text-[12px]", isLight ? "text-s-50" : "text-slate-300")}>Agent Chart</span>
                  <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} />
                  <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>{presence.label}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/integrations")}
                className={cn("h-9 rounded-lg border px-3 text-xs font-semibold tracking-[0.14em] transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70" : "border-white/15 bg-black/25 text-slate-300")}
              >
                Provider Setup
              </button>
            </div>
          </div>
        </header>

        <section ref={shellRef} className={cn(panelClass, "home-spotlight-shell p-4 mb-4")}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}>
              <p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Managers</p>
              <p className="mt-1 text-2xl font-semibold">{NOVA_DOMAIN_MANAGERS.length}</p>
            </div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}>
              <p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Worker Agents</p>
              <p className="mt-1 text-2xl font-semibold">{totalWorkers}</p>
            </div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}>
              <p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Online</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-300">{onlineWorkers}</p>
            </div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}>
              <p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Provider Rail</p>
              <p className="mt-1 text-2xl font-semibold">{PROVIDER_RAIL.length}</p>
            </div>
          </div>
        </section>

        <section ref={chartRef} className={cn(panelClass, "home-spotlight-shell min-h-0 flex-1 overflow-auto p-4")}>
          <div className="mx-auto min-w-[980px] max-w-[1320px] pb-4">
            <div className="flex flex-col items-center">
              <div className={cn("home-spotlight-card home-border-glow w-[320px] rounded-xl border px-4 py-3 text-center", railPanelClass)}>
                <p className="text-[10px] uppercase tracking-[0.16em] text-accent">Operator</p>
                <p className={cn("mt-1 text-lg font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{NOVA_OPERATOR_NODE.name}</p>
                <p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>{NOVA_OPERATOR_NODE.role}</p>
              </div>

              <div className={cn("h-8 w-px", isLight ? "bg-[#c4d3e9]" : "bg-white/20")} />

              <div className="relative w-full px-12">
                <div className={cn("pointer-events-none absolute left-[14%] right-[14%] top-0 h-px", isLight ? "bg-[#c4d3e9]" : "bg-white/20")} />
                <div className="grid grid-cols-3 gap-3 pt-4">
                  {NOVA_COUNCIL_NODES.map((council) => {
                    const CouncilIcon = COUNCIL_ICON_BY_ID[council.id] || Workflow
                    return (
                      <div key={council.id} className={cn("home-spotlight-card home-border-glow rounded-xl border p-3", railPanelClass)}>
                        <div className="flex items-start gap-2">
                          <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent-30 bg-accent-10 text-accent")}>
                            <CouncilIcon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", isLight ? "text-s-80" : "text-slate-200")}>{council.label}</p>
                            <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>{council.summary}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className={cn("h-8 w-px", isLight ? "bg-[#c4d3e9]" : "bg-white/20")} />

              <div className="relative w-full">
                <div className={cn("pointer-events-none absolute left-[8%] right-[8%] top-0 h-px", isLight ? "bg-[#c4d3e9]" : "bg-white/20")} />
                <div className="grid grid-cols-3 gap-3 pt-4">
                  {NOVA_DOMAIN_MANAGERS.map((manager) => (
                    <section
                      key={manager.id}
                      className={cn(
                        "home-spotlight-card home-border-glow rounded-2xl border p-3",
                        railPanelClass,
                        managerAccentClass(manager.accent),
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={cn("text-[11px] uppercase tracking-[0.16em] text-accent")}>{manager.label}</p>
                          <p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>{manager.objective}</p>
                        </div>
                        <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-white/5 text-accent")}>
                          <GitBranch className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {manager.workers.map((worker) => (
                          <div key={worker.id} className={cn("home-spotlight-card home-border-glow rounded-xl border p-2.5", subPanelClass)}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className={cn("text-[12px] font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{worker.name}</p>
                                <p className={cn("mt-0.5 text-[10px]", isLight ? "text-s-50" : "text-slate-400")}>{worker.role}</p>
                              </div>
                              <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]", statusClass(worker.status))}>
                                {worker.status}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]", providerClass(worker.provider))}>
                                {worker.provider}
                              </span>
                              {worker.tags.map((tag) => (
                                <span key={`${worker.id}-${tag}`} className={cn("rounded-md border px-1.5 py-0.5 text-[9px]", isLight ? "border-[#cdd9ea] bg-[#edf2fb] text-s-60" : "border-white/10 bg-white/5 text-slate-300")}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section ref={railRef} className={cn(panelClass, "home-spotlight-shell mt-4 p-3")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn("home-spotlight-card home-border-glow inline-flex items-center gap-2 rounded-lg border px-3 py-2", railPanelClass)}>
              <Bot className="h-3.5 w-3.5 text-accent" />
              <span className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-70" : "text-slate-300")}>Provider Rail</span>
            </div>
            {PROVIDER_RAIL.map((provider) => (
              <div key={provider.id} className={cn("home-spotlight-card home-border-glow rounded-lg border px-3 py-2", railPanelClass)}>
                <p className={cn("text-[10px] uppercase tracking-[0.12em] text-accent")}>{provider.label}</p>
                <p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>{provider.model}</p>
              </div>
            ))}
            <button
              onClick={() => router.push("/home")}
              className={cn("ml-auto h-9 rounded-lg border px-3 text-xs font-semibold tracking-[0.14em] transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70" : "border-white/15 bg-black/25 text-slate-300")}
            >
              Back Home
            </button>
            <button
              onClick={() => router.push("/integrations")}
              className={cn("h-9 rounded-lg border px-3 text-xs font-semibold tracking-[0.14em] transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70" : "border-white/15 bg-black/25 text-slate-300")}
            >
              <span className="inline-flex items-center gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                Integrations
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
