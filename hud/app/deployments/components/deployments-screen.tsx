"use client"

import { Boxes, Loader2, MessageSquareText, Rocket, Workflow } from "lucide-react"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"

import { AdvancedTaskForm } from "@/components/agents/advanced-task-form"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { WindowControls } from "@/components/window/window-controls"
import type { CreateAgentTaskInput } from "@/lib/agents/types"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useTheme } from "@/lib/context/theme-context"
import type { Deployment } from "@/lib/deployments/types"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { defaultMissionSettings, type Mission } from "@/lib/missions/types"
import { cn } from "@/lib/shared/utils"
import { useHomeVisuals } from "@/app/home/hooks/use-home-visuals"
import { useDeploymentManager } from "../hooks/use-deployment-manager"
import { isRunActive, runNeedsReview, useDeploymentsData } from "../hooks/use-deployments-data"
import { AutomationPanel } from "./automation-panel"
import { PanelHeader } from "./deployment-ui"
import { DeploymentsOverview } from "./deployments-overview"
import { ManagerPanel } from "./manager-panel"

// The canvas pulls in ReactFlow, the node catalog and graph validation. It is only needed once the user opens it,
// so it lives in its own chunk; the Automation tab preloads it so the click itself stays instant.
const loadMissionCanvasModal = () =>
  import("@/app/missions/components/mission-canvas-modal").then((module) => module.MissionCanvasModal)
const MissionCanvasModal = dynamic(loadMissionCanvasModal, {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/90 backdrop-blur-sm">
      <Loader2 className="h-6 w-6 animate-spin text-slate-300" aria-label="Loading automation canvas" />
    </div>
  ),
})

type ComposerTab = "describe" | "task" | "automation"

const COMPOSER_TABS: Array<{ id: ComposerTab; label: string; icon: typeof Boxes; hint: string }> = [
  { id: "describe", label: "Describe it", icon: MessageSquareText, hint: "Nova plans it for you" },
  { id: "task", label: "One-off task", icon: Boxes, hint: "Pick the model and limits" },
  { id: "automation", label: "Automation", icon: Workflow, hint: "Scheduled or event-driven" },
]

const STATUS_DISMISS_MS = 8000

function tabFromParams(mode: string | null, kind: string | null): ComposerTab {
  if (mode !== "advanced") return "describe"
  return kind === "automation" ? "automation" : "task"
}

function tabHref(tab: ComposerTab): string {
  if (tab === "describe") return "/deployments?mode=simple"
  return `/deployments?mode=advanced&kind=${tab}`
}

function createMissionDraft(): Mission {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId: "",
    label: "New Automation",
    description: "",
    category: "personal",
    tags: [],
    status: "draft",
    version: 1,
    nodes: [],
    connections: [],
    variables: [],
    settings: defaultMissionSettings(),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T
  return { response, data }
}

export function DeploymentsScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { panelClass, subPanelClass, panelStyle, orbPalette, homeShellRef } = useHomeVisuals({ isLight })
  const [tab, setTab] = useState<ComposerTab>(() => tabFromParams(searchParams.get("mode"), searchParams.get("kind")))
  const [status, setStatus] = useState("")
  const [mission, setMission] = useState<Mission | null>(null)
  const [missionBusy, setMissionBusy] = useState(false)
  const manager = useDeploymentManager(setStatus)
  const data = useDeploymentsData()
  const presence = getNovaPresence({ agentConnected: manager.connected, novaState: manager.novaState })

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(""), STATUS_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (tab === "automation") void loadMissionCanvasModal()
  }, [tab])

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

  const selectTab = (next: ComposerTab) => {
    setTab(next)
    router.replace(tabHref(next), { scroll: false })
  }

  const createAdvancedTask = useCallback(
    async (input: CreateAgentTaskInput): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const created = await postJson<{ ok?: boolean; deployment?: Deployment; error?: string }>("/api/deployments", {
          kind: "task",
          status: "ready",
          title: input.name,
          outcome: input.prompt,
          config: {
            provider: input.agent,
            model: input.model,
            priority: input.priority,
            permissionMode: input.permissionMode,
            useWorktree: input.useWorktree,
            attachedFiles: input.attachedFiles,
            contextId: input.contextId,
            costBudgetUsd: input.costBudgetUsd,
            tokenBudget: input.tokenBudget,
          },
        })
        if (!created.response.ok || !created.data.ok || !created.data.deployment) {
          throw new Error(created.data.error || "Failed to create deployment.")
        }
        const launched = await postJson<{ ok?: boolean; error?: string }>("/api/deployment-runs", {
          deploymentId: created.data.deployment.id,
          idempotencyKey: crypto.randomUUID(),
        })
        if (!launched.response.ok || !launched.data.ok) throw new Error(launched.data.error || "Failed to queue deployment.")
        setStatus("Task queued.")
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Failed to queue deployment." }
      }
    },
    [],
  )

  const saveMission = async (draft: Mission): Promise<Mission> => {
    const { response, data: saved } = await postJson<{ ok?: boolean; mission?: Mission; error?: string }>("/api/missions", {
      mission: draft,
    })
    if (!response.ok || !saved.ok || !saved.mission) throw new Error(saved.error || "Failed to save automation.")
    return saved.mission
  }

  const createAutomationDeployment = async (saved: Mission, deploymentStatus: "draft" | "ready"): Promise<Deployment> => {
    const { response, data: created } = await postJson<{ ok?: boolean; deployment?: Deployment; error?: string }>(
      "/api/deployments",
      {
        kind: "automation",
        status: deploymentStatus,
        title: saved.label,
        outcome: saved.description || saved.label,
        missionId: saved.id,
      },
    )
    if (!response.ok || !created.ok || !created.deployment) {
      throw new Error(created.error || "Failed to create automation deployment.")
    }
    return created.deployment
  }

  const handleMissionSave = async (draft: Mission): Promise<boolean> => {
    setMissionBusy(true)
    setStatus("")
    try {
      const saved = await saveMission(draft)
      await createAutomationDeployment(saved, "draft")
      setMission(saved)
      setStatus(`Automation "${saved.label}" saved as a draft.`)
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save automation.")
      return false
    } finally {
      setMissionBusy(false)
    }
  }

  const handleMissionRun = async (draft: Mission) => {
    setMissionBusy(true)
    setStatus("")
    try {
      const saved = await saveMission(draft)
      setMission(saved)
      const deployment = await createAutomationDeployment(saved, "ready")
      const launched = await postJson<{ ok?: boolean; error?: string }>("/api/deployment-runs", {
        deploymentId: deployment.id,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!launched.response.ok || !launched.data.ok) throw new Error(launched.data.error || "Automation run failed.")
      setStatus("Automation queued.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to run automation.")
    } finally {
      setMissionBusy(false)
    }
  }

  const activeTab = COMPOSER_TABS.find((entry) => entry.id === tab) ?? COMPOSER_TABS[0]
  const mutedText = isLight ? "text-s-50" : "text-slate-400"

  return (
    <div
      style={panelStyle}
      className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}
    >
      <div ref={homeShellRef} className="home-spotlight-shell relative flex-1 overflow-hidden">
        <div className="relative z-10 flex h-full w-full flex-col gap-1.5 px-4 pb-4 pt-3">
          <header
            className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
            style={{ WebkitAppRegion: "drag" } as CSSProperties}
          >
            <div className="flex min-w-0 items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
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

            <div className="min-w-0 px-1" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
              <dl className="mx-auto hidden w-full max-w-176 grid-cols-4 gap-1.5 lg:grid">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className={cn("flex h-11 items-center justify-between gap-2 rounded-md px-2.5 home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <div className="min-w-0">
                      <dt className={cn("truncate text-[9px] uppercase tracking-[0.12em]", mutedText)}>{stat.label}</dt>
                      <dd className={cn("text-sm font-semibold leading-tight tabular-nums", isLight ? "text-s-90" : "text-slate-100")}>
                        {data.loading ? "—" : stat.value}
                      </dd>
                    </div>
                    <span className={cn("h-2 w-2 shrink-0 rounded-sm", stat.dot)} aria-hidden="true" />
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
              <WindowControls />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 gap-1.5">
            <section
              style={panelStyle}
              aria-label="New deployment"
              className={cn(panelClass, "home-spotlight-shell flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-2.5")}
            >
              <PanelHeader
                isLight={isLight}
                icon={<Rocket className="h-4 w-4 text-accent" />}
                title="New deployment"
              />

              <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
                <div role="tablist" aria-label="How to deploy" className={cn("inline-flex gap-1 rounded-lg p-1", subPanelClass)}>
                  {COMPOSER_TABS.map(({ id, label, icon: Icon }) => {
                    const selected = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => selectTab(id)}
                        className={cn(
                          "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] transition-colors",
                          selected
                            ? cn("border-accent-30 bg-accent-10 font-medium", isLight ? "text-s-90" : "text-white")
                            : cn("border-transparent", isLight ? "text-s-50 hover:text-s-80" : "text-slate-400 hover:text-slate-200"),
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5", selected && "text-accent")} />
                        {label}
                      </button>
                    )
                  })}
                </div>
                {status ? (
                  <p role="status" className={cn("min-w-0 truncate text-xs font-medium", isLight ? "text-emerald-700" : "text-emerald-300")}>
                    {status}
                  </p>
                ) : (
                  <p className={cn("hidden text-xs xl:block", mutedText)}>{activeTab.hint}</p>
                )}
              </div>

              <div role="tabpanel" aria-label={activeTab.label} className="mt-3 min-h-0 flex-1">
                {tab === "describe" ? (
                  <ManagerPanel isLight={isLight} subPanelClass={subPanelClass} manager={manager} />
                ) : tab === "task" ? (
                  <AdvancedTaskForm isLight={isLight} onCreate={createAdvancedTask} />
                ) : (
                  <AutomationPanel
                    isLight={isLight}
                    subPanelClass={subPanelClass}
                    onOpenBuilder={() => router.push("/missions?create=builder&returnTo=/deployments")}
                    onOpenCanvas={() => setMission(createMissionDraft())}
                    onViewAutomations={() => router.push("/missions?returnTo=/deployments")}
                  />
                )}
              </div>
            </section>

            <aside className="flex w-80 shrink-0 flex-col xl:w-[26rem] 2xl:w-[30rem]" aria-label="Deployments and runs">
              <DeploymentsOverview
                isLight={isLight}
                panelClass={panelClass}
                subPanelClass={subPanelClass}
                panelStyle={panelStyle}
                data={data}
              />
            </aside>
          </div>
        </div>
      </div>

      {mission ? (
        <MissionCanvasModal
          mission={mission}
          open
          onClose={() => setMission(null)}
          onSave={handleMissionSave}
          onRun={handleMissionRun}
          isSaving={missionBusy}
        />
      ) : null}
    </div>
  )
}
