"use client"

import type { CSSProperties, RefObject } from "react"
import { LayoutGrid, List, MoreVertical, Network, Pin, Search, Sparkles, Trash2, WandSparkles } from "lucide-react"

import { FluidSelect } from "@/components/ui/fluid-select"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { MissionTemplate } from "@/lib/missions/templates"
import { cn } from "@/lib/shared/utils"
import {
  AI_PROVIDER_LABELS,
  MISSION_FILTER_STATUS_OPTIONS,
} from "../constants"
import {
  formatIntegrationLabel,
  getMissionIntegrationIcon,
  normalizePriority,
} from "../helpers"
import type {
  MissionRunProgress,
  MissionRuntimeStatus,
  NotificationSchedule,
} from "../types"

interface MissionsMainPanelsProps {
  isLight: boolean
  panelStyle?: CSSProperties
  panelClass: string
  moduleHeightClass: string
  subPanelClass: string
  createSectionRef: RefObject<HTMLElement | null>
  listSectionRef: RefObject<HTMLElement | null>
  templates: MissionTemplate[]
  integrationsSettings: IntegrationsSettings
  novaMissionPrompt: string
  novaGeneratingMission: boolean
  searchQuery: string
  statusFilter: string
  missionBoardView: "grid" | "list"
  loading: boolean
  filteredSchedules: NotificationSchedule[]
  busyById: Record<string, boolean>
  runProgress: MissionRunProgress | null
  missionRuntimeStatusById: Record<string, MissionRuntimeStatus>
  onNovaMissionPromptChange: (value: string) => void
  onSearchQueryChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onMissionBoardViewChange: (view: "grid" | "list") => void
  onApplyTemplate: (templateId: string) => void
  onGenerateMissionDraft: () => void
  onPlayClickSound: () => void
  formatStatusTime: (value: number) => string
  onMissionActionMenu: (mission: NotificationSchedule, left: number, top: number) => void
  onToggleMissionEnabled: (mission: NotificationSchedule) => void
  onRequestDeleteMission: (mission: NotificationSchedule) => void
  onViewInCanvas?: (missionId: string) => void
}

export function MissionsMainPanels({
  isLight,
  panelStyle,
  panelClass,
  moduleHeightClass,
  subPanelClass,
  createSectionRef,
  listSectionRef,
  templates,
  integrationsSettings,
  novaMissionPrompt,
  novaGeneratingMission,
  searchQuery,
  statusFilter,
  missionBoardView,
  loading,
  filteredSchedules,
  busyById,
  runProgress,
  missionRuntimeStatusById,
  onNovaMissionPromptChange,
  onSearchQueryChange,
  onStatusFilterChange,
  onMissionBoardViewChange,
  onApplyTemplate,
  onGenerateMissionDraft,
  onPlayClickSound,
  formatStatusTime,
  onMissionActionMenu,
  onToggleMissionEnabled,
  onRequestDeleteMission,
  onViewInCanvas,
}: MissionsMainPanelsProps) {
  return (
    <div className="grid w-full grid-cols-1 gap-5 xl:grid-cols-[minmax(360px,28vw)_minmax(0,1fr)]">
      <section
        ref={createSectionRef}
        style={panelStyle}
        className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} min-h-0 flex flex-col`}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Quick Start Templates</h2>
        </div>
        <p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
          Launch production-ready mission blueprints and fine-tune in Mission Builder.
        </p>
        <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
          {templates.map((template) => (
            <div key={template.id} className={cn("rounded-lg border p-2.5 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
              <div>
                <h3 className={cn("text-[13px] font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{template.label}</h3>
                <p className={cn("mt-0.5 line-clamp-2 text-[11px] leading-snug", isLight ? "text-s-60" : "text-slate-400")}>{template.description}</p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {template.tags.map((tag, tagIndex) => (
                  <span key={`${template.id}-${tag}-${tagIndex}`} className={cn("rounded-md px-1.5 py-0.5 text-[9px]", isLight ? "bg-[#e8eef9] text-s-70" : "bg-white/8 text-slate-300")}>
                    #{tag}
                  </span>
                ))}
              </div>
              <button
                onClick={() => onApplyTemplate(template.id)}
                className="mt-2 h-7 w-full rounded-md border border-accent-30 bg-accent-10 text-accent transition-all duration-150 text-[11px] home-spotlight-card home-border-glow"
              >
                Use Template
              </button>
            </div>
          ))}
        </div>
        <div className={cn("mt-3 rounded-xl border p-3.5 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
          <div className="flex items-center gap-2">
            <WandSparkles className="w-3.5 h-3.5 text-accent" />
            <h3 className={cn("text-xs uppercase tracking-[0.18em] font-semibold", isLight ? "text-s-80" : "text-slate-200")}>Nova Mission Generator</h3>
          </div>
          <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
            Uses your connected {AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider]} model to build a ready-to-review mission draft.
          </p>
          <textarea
            value={novaMissionPrompt}
            onChange={(e) => onNovaMissionPromptChange(e.target.value)}
            placeholder="Example: Monitor BTC moves above 3% in 1h, summarize drivers, and send alerts to Telegram."
            className={cn(
              "mt-2.5 min-h-22 w-full resize-y rounded-md border px-3 py-2 text-xs outline-none",
              isLight ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-40" : "border-white/14 bg-black/25 text-slate-100 placeholder:text-slate-500",
            )}
          />
          <button
            onClick={() => {
              onPlayClickSound()
              onGenerateMissionDraft()
            }}
            disabled={novaGeneratingMission}
            className="mt-2.5 h-8 w-full rounded-md border border-accent-30 bg-accent-10 text-accent transition-colors text-xs disabled:opacity-60 home-spotlight-card home-border-glow"
          >
            {novaGeneratingMission ? "Generating Draft..." : "Generate Mission Draft"}
          </button>
        </div>
      </section>

      <section
        ref={listSectionRef}
        style={panelStyle}
        className={`${panelClass} home-spotlight-shell p-5 ${moduleHeightClass} min-h-0 flex flex-col w-full`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pin className="w-4 h-4 text-accent" />
            <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline Settings</h2>
          </div>
          <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>{filteredSchedules.length} missions</p>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_190px_auto] gap-2">
          <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 home-spotlight-card home-border-glow", subPanelClass)}>
            <Search className={cn("w-3.5 h-3.5 shrink-0", isLight ? "text-s-50" : "text-slate-500")} />
            <input
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search missions..."
              className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
            />
          </div>
          <FluidSelect
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={MISSION_FILTER_STATUS_OPTIONS}
            isLight={isLight}
            className={cn(subPanelClass, "home-spotlight-card home-border-glow")}
          />
          <div className={cn("h-9 rounded-lg border px-1 flex items-center gap-1", subPanelClass)}>
            <button
              onClick={() => onMissionBoardViewChange("grid")}
              className={cn(
                "h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors home-spotlight-card home-border-glow",
                missionBoardView === "grid"
                  ? "bg-accent-20 text-accent border border-accent-30"
                  : isLight
                    ? "text-s-60 border border-[#d5dce8] bg-white"
                    : "text-slate-400 border border-white/12 bg-black/20",
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onMissionBoardViewChange("list")}
              className={cn(
                "h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors home-spotlight-card home-border-glow",
                missionBoardView === "list"
                  ? "bg-accent-20 text-accent border border-accent-30"
                  : isLight
                    ? "text-s-60 border border-[#d5dce8] bg-white"
                    : "text-slate-400 border border-white/12 bg-black/20",
              )}
              aria-label="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className={cn("mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1", missionBoardView === "grid" ? "" : "")}>
          {loading && <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>Loading missions...</p>}
          {!loading && filteredSchedules.length === 0 && (
            <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>No missions match the current filters.</p>
          )}

          <div className={cn(missionBoardView === "grid" ? "grid grid-cols-1 gap-3 xl:grid-cols-3" : "space-y-3")}>
            {filteredSchedules.map((mission) => {
              const busy = Boolean(busyById[mission.id])
              const workflowStepTypes = Array.isArray(mission.workflowSteps)
                ? mission.workflowSteps.map((step) => String(step?.type || "").trim().toLowerCase()).filter(Boolean)
                : []
              const priority = normalizePriority(mission.priority)
              const runs = Number.isFinite(mission.runCount) ? Number(mission.runCount) : 0
              const successes = Number.isFinite(mission.successCount) ? Number(mission.successCount) : 0
              const successRate = runs > 0 ? Math.round((successes / runs) * 100) : 100
              const processChips = (workflowStepTypes.length > 0 ? workflowStepTypes : ["trigger", "output"]).slice(0, 4)
              const missionDescription = String(mission.description || mission.message || "").trim()
              const missionMode = String(mission.mode || "daily").trim().toLowerCase() || "daily"
              const runState = runProgress && runProgress.missionId === mission.id ? runProgress : null
              const runtimeStatus = missionRuntimeStatusById[mission.id]
              const dynamicRunningTotal = runState?.running ? Math.max(runState.steps.length, 1) : null
              const dynamicRunningStep = runState?.running
                ? (() => {
                    const runningIndex = runState.steps.findIndex((step) => step.status === "running")
                    if (runningIndex >= 0) return runningIndex + 1
                    const completedCount = runState.steps.filter((step) => step.status === "completed" || step.status === "skipped").length
                    return Math.min(completedCount + 1, Math.max(runState.steps.length, 1))
                  })()
                : null
              const completedFromServer = mission.lastRunAt ? new Date(mission.lastRunAt).getTime() : null
              const missionStatusText = dynamicRunningStep && dynamicRunningTotal
                ? `Running ${dynamicRunningStep}/${dynamicRunningTotal}`
                : runtimeStatus?.kind === "running"
                  ? `Running ${runtimeStatus.step}/${runtimeStatus.total}`
                  : runtimeStatus?.kind === "completed"
                    ? `Completed at ${formatStatusTime(runtimeStatus.at)}`
                    : runtimeStatus?.kind === "failed"
                      ? `Failed at ${formatStatusTime(runtimeStatus.at)}`
                      : completedFromServer && Number.isFinite(completedFromServer)
                        ? `Completed at ${formatStatusTime(completedFromServer)}`
                        : mission.enabled
                          ? "Scheduled"
                          : "Paused and not running"
              const missionStatusToneClass = dynamicRunningStep && dynamicRunningTotal
                ? "text-sky-300"
                : runtimeStatus?.kind === "running"
                  ? "text-sky-300"
                  : runtimeStatus?.kind === "completed"
                    ? "text-emerald-300"
                    : runtimeStatus?.kind === "failed"
                      ? "text-rose-300"
                      : completedFromServer && Number.isFinite(completedFromServer)
                        ? "text-emerald-300"
                        : mission.enabled
                          ? "text-slate-300"
                          : "text-rose-300"
              const missionStatusDotClass = dynamicRunningStep && dynamicRunningTotal
                ? "bg-sky-400"
                : runtimeStatus?.kind === "running"
                  ? "bg-sky-400"
                  : runtimeStatus?.kind === "completed"
                    ? "bg-emerald-400"
                    : runtimeStatus?.kind === "failed"
                      ? "bg-rose-400"
                      : completedFromServer && Number.isFinite(completedFromServer)
                        ? "bg-emerald-400"
                        : mission.enabled
                          ? "bg-slate-400"
                          : "bg-rose-400"
              return (
                <div key={mission.id} className={cn("rounded-xl border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2.5">
                      <div className={cn("h-10 w-10 rounded-lg border inline-flex items-center justify-center shrink-0", isLight ? "border-[#d5dce8] bg-white" : "border-white/12 bg-black/30")}>
                        {getMissionIntegrationIcon(mission.integration, "w-4 h-4 text-accent")}
                      </div>
                      <div className="min-w-0">
                        <h3 className={cn("text-xl font-semibold truncate", isLight ? "text-s-90" : "text-slate-100")}>{mission.label || "Untitled mission"}</h3>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={cn("text-xs", isLight ? "text-s-60" : "text-slate-400")}>{formatIntegrationLabel(mission.integration)}</span>
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                              priority === "low" && (isLight ? "border border-emerald-300 bg-emerald-100 text-emerald-700" : "border border-emerald-300/40 bg-emerald-500/15 text-emerald-300"),
                              priority === "medium" && (isLight ? "border border-amber-300 bg-amber-100 text-amber-700" : "border border-amber-300/40 bg-amber-500/15 text-amber-300"),
                              priority === "high" && (isLight ? "border border-orange-300 bg-orange-100 text-orange-700" : "border border-orange-300/40 bg-orange-500/15 text-orange-300"),
                              priority === "critical" && (isLight ? "border border-rose-300 bg-rose-100 text-rose-700" : "border border-rose-300/40 bg-rose-500/15 text-rose-300"),
                            )}
                          >
                            {priority}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em]",
                          mission.enabled
                            ? (isLight
                                ? "border border-emerald-300 bg-emerald-100 text-emerald-700"
                                : "border border-emerald-300/40 bg-emerald-500/15 text-emerald-300")
                            : (isLight
                                ? "border border-rose-300 bg-rose-100 text-rose-700"
                                : "border border-rose-300/40 bg-rose-500/15 text-rose-300"),
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", mission.enabled ? "bg-emerald-400" : "bg-rose-400")} />
                        {mission.enabled ? "Active" : "Paused"}
                      </span>
                      <button
                        onClick={(event) => {
                          const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
                          const menuWidth = 180
                          const viewportPadding = 8
                          const left = Math.max(
                            viewportPadding,
                            Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding),
                          )
                          const top = rect.bottom + 6
                          onMissionActionMenu(mission, left, top)
                        }}
                        className={cn(
                          "h-8 w-8 rounded-md inline-flex items-center justify-center transition-all duration-150",
                          "home-spotlight-card home-border-glow",
                          isLight ? "text-s-50" : "text-slate-500",
                        )}
                        aria-label="Mission actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className={cn("mt-3 text-sm line-clamp-2", isLight ? "text-s-70" : "text-slate-300")}>
                    {missionDescription || "Mission automation flow"}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {processChips.map((stepType, index) => (
                      <span key={`${mission.id}-${stepType}-${index}`} className={cn("rounded-md px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]", isLight ? "border border-[#d5dce8] bg-white text-s-70" : "border border-white/12 bg-white/6 text-slate-300")}>
                        {stepType}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Schedule</p>
                      <p className={cn("text-2xl font-semibold leading-none mt-1", isLight ? "text-s-90" : "text-slate-100")}>{mission.time}</p>
                      <p className={cn("text-[11px] mt-1", isLight ? "text-s-50" : "text-slate-500")}>{missionMode}</p>
                    </div>
                    <div>
                      <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Runs</p>
                      <p className={cn("text-2xl font-semibold leading-none mt-1", isLight ? "text-s-90" : "text-slate-100")}>{runs}</p>
                      <p className={cn("text-[11px] mt-1", isLight ? "text-s-50" : "text-slate-500")}>total</p>
                    </div>
                    <div>
                      <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Success</p>
                      <p className="text-2xl font-semibold leading-none mt-1 text-emerald-300">{successRate}%</p>
                      <div className={cn("mt-2 h-1 rounded-full", isLight ? "bg-[#dfe6f2]" : "bg-white/10")}>
                        <div className="h-1 rounded-full bg-emerald-400" style={{ width: `${Math.max(4, Math.min(100, successRate))}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className={cn("mt-4 pt-3 border-t", isLight ? "border-[#dde4ef]" : "border-white/10")}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <span className={cn("inline-flex items-start gap-1 text-sm font-medium min-w-0", missionStatusToneClass)}>
                          <span className={cn("h-2 w-2 rounded-full", missionStatusDotClass)} />
                          <span className="min-w-0 whitespace-normal wrap-break-word leading-snug">{missionStatusText}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {onViewInCanvas && (
                          <button
                            onClick={() => onViewInCanvas(mission.id)}
                            className="h-7 w-7 rounded-md border border-violet-400/40 bg-violet-500/15 text-violet-300 transition-colors inline-flex items-center justify-center home-spotlight-card home-border-glow"
                            title="View in Canvas"
                          >
                            <Network className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => onToggleMissionEnabled(mission)}
                          disabled={busy}
                          className={cn(
                            "h-7 px-2 rounded-md border text-xs transition-colors disabled:opacity-50 home-spotlight-card home-border-glow",
                            mission.enabled ? "border-rose-300/40 bg-rose-500/15 text-rose-200" : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200",
                          )}
                        >
                          {mission.enabled ? "Pause" : "Activate"}
                        </button>
                        <button
                          onClick={() => onRequestDeleteMission(mission)}
                          disabled={busy}
                          className="h-7 w-7 rounded-md border border-rose-300/40 bg-rose-500/15 text-rose-200 transition-colors disabled:opacity-50 inline-flex items-center justify-center home-spotlight-card home-border-glow"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
