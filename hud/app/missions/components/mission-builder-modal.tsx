"use client"

import type { CSSProperties, MutableRefObject } from "react"
import { ChevronDown, ChevronRight, Clock3, GitBranch, GripVertical, Sparkles, X, Zap } from "lucide-react"

import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"
import type { IntegrationsSettings } from "@/lib/integrations/client-store"
import { cn } from "@/lib/utils"
import {
  AI_DETAIL_LEVEL_OPTIONS,
  AI_PROVIDER_LABELS,
  PRIORITY_OPTIONS,
  SCHEDULE_MODE_OPTIONS,
  STEP_CONDITION_FAILURE_OPTIONS,
  STEP_CONDITION_LOGIC_OPTIONS,
  STEP_CONDITION_OPERATOR_OPTIONS,
  STEP_FETCH_METHOD_OPTIONS,
  STEP_FETCH_SOURCE_OPTIONS,
  STEP_OUTPUT_FREQUENCY_OPTIONS,
  STEP_OUTPUT_TIMING_OPTIONS,
  STEP_TEXT_THEME,
  STEP_THEME,
  STEP_TRANSFORM_ACTION_OPTIONS,
  STEP_TRANSFORM_FORMAT_OPTIONS,
  STEP_TYPE_OPTIONS,
  WEEKDAY_OPTIONS,
} from "../constants"
import {
  getDefaultModelForProvider,
  getModelOptionsForProvider,
  hexToRgba,
  normalizeAiDetailLevel,
  renderStepIcon,
  sanitizeOutputRecipients,
} from "../helpers"
import type { AiIntegrationType, WorkflowStep } from "../types"
import { TimeField } from "./time-field"

interface MissionBuilderModalProps {
  [key: string]: unknown
}

export function MissionBuilderModal(props: MissionBuilderModalProps) {
  const {
    builderOpen,
    playClickSound,
    setBuilderOpen,
    panelStyle,
    isLight,
    orbPalette,
    builderBodyRef,
    subPanelClass,
    newLabel,
    setNewLabel,
    newDescription,
    setNewDescription,
    newPriority,
    setNewPriority,
    tagInput,
    setTagInput,
    addTag,
    missionTags,
    removeTag,
    newTime,
    setNewTime,
    newScheduleDays,
    toggleScheduleDay,
    newScheduleMode,
    setNewScheduleMode,
    workflowSteps,
    draggingStepId,
    setDragOverStepId,
    moveWorkflowStepByDrop,
    setDraggingStepId,
    dragOverStepId,
    updateWorkflowStepTitle,
    toggleWorkflowStepCollapsed,
    collapsedStepIds,
    removeWorkflowStep,
    detectedTimezone,
    updateWorkflowStep,
    apiFetchIntegrationOptions,
    catalogApiById,
    outputChannelOptions,
    updateWorkflowStepAi,
    resolveDefaultAiIntegration,
    integrationsSettings,
    configuredAiIntegrationOptions,
    novaSuggestForAiStep,
    novaSuggestingByStepId,
    addWorkflowStep,
    builderFooterRef,
    missionActive,
    setMissionActive,
    runImmediatelyOnCreate,
    setRunImmediatelyOnCreate,
    editingMissionId,
    deployMissionFromBuilder,
    deployingMission,
  } = props as {
    builderOpen: boolean
    playClickSound: () => void
    setBuilderOpen: (open: boolean) => void
    panelStyle: CSSProperties
    isLight: boolean
    orbPalette: { circle1: string; circle2: string }
    builderBodyRef: MutableRefObject<HTMLDivElement | null>
    subPanelClass: string
    newLabel: string
    setNewLabel: (value: string) => void
    newDescription: string
    setNewDescription: (value: string) => void
    newPriority: string
    setNewPriority: (value: string) => void
    tagInput: string
    setTagInput: (value: string) => void
    addTag: () => void
    missionTags: string[]
    removeTag: (tag: string) => void
    newTime: string
    setNewTime: (value: string) => void
    newScheduleDays: string[]
    toggleScheduleDay: (day: string) => void
    newScheduleMode: string
    setNewScheduleMode: (mode: string) => void
    workflowSteps: WorkflowStep[]
    draggingStepId: string | null
    setDragOverStepId: (id: string | null) => void
    moveWorkflowStepByDrop: (fromId: string, toId: string) => void
    setDraggingStepId: (id: string | null) => void
    dragOverStepId: string | null
    updateWorkflowStepTitle: (id: string, title: string) => void
    toggleWorkflowStepCollapsed: (id: string) => void
    collapsedStepIds: Record<string, boolean>
    removeWorkflowStep: (id: string) => void
    detectedTimezone: string
    updateWorkflowStep: (id: string, updates: Partial<WorkflowStep>) => void
    apiFetchIntegrationOptions: Array<{ value: string; label: string }>
    catalogApiById: Record<string, { endpoint?: string }>
    outputChannelOptions: Array<{ value: string; label: string }>
    updateWorkflowStepAi: (
      id: string,
      updates: Partial<Pick<WorkflowStep, "aiPrompt" | "aiModel" | "aiIntegration" | "aiDetailLevel">>,
    ) => void
    resolveDefaultAiIntegration: () => AiIntegrationType
    integrationsSettings: IntegrationsSettings
    configuredAiIntegrationOptions: Array<{ value: string; label: string }>
    novaSuggestForAiStep: (stepId: string) => Promise<void>
    novaSuggestingByStepId: Record<string, boolean>
    addWorkflowStep: (type: WorkflowStep["type"]) => void
    builderFooterRef: MutableRefObject<HTMLDivElement | null>
    missionActive: boolean
    setMissionActive: (updater: (prev: boolean) => boolean) => void
    runImmediatelyOnCreate: boolean
    setRunImmediatelyOnCreate: (updater: (prev: boolean) => boolean) => void
    editingMissionId: string | null
    deployMissionFromBuilder: () => Promise<void>
    deployingMission: boolean
  }

  if (!builderOpen) return null

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => {
              playClickSound()
              setBuilderOpen(false)
            }}
            aria-label="Close mission builder"
          />
          <div
            style={panelStyle}
            className={cn(
              "mission-builder-popup-no-glow relative z-10 w-full max-w-3xl rounded-2xl border overflow-hidden",
              isLight
                ? "border-[#d9e0ea] bg-white"
                : "border-white/20 bg-white/6 backdrop-blur-2xl",
            )}
          >
            {!isLight && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(165deg, ${hexToRgba(orbPalette.circle1, 0.16)} 0%, rgba(6,10,20,0.75) 45%, ${hexToRgba(orbPalette.circle2, 0.14)} 100%)`,
                }}
              />
            )}
            <div
              className={cn(
                "relative z-10 flex items-center justify-between px-5 py-4 border-b",
                isLight ? "border-[#e2e8f2]" : "border-white/10",
              )}
              style={{
                background: `linear-gradient(90deg, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.12)} 100%)`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-accent-20 border border-accent-30 inline-flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <h3 className={cn("text-2xl font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>Mission Builder</h3>
                  <p className={cn("text-sm", isLight ? "text-s-60" : "text-slate-300")}>Design your automated workflow</p>
                </div>
              </div>
              <button
                onClick={() => {
                  playClickSound()
                  setBuilderOpen(false)
                }}
                className={cn(
                  "mission-builder-hover-gleam h-8 w-8 rounded-md border inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                  isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/12 bg-black/20 text-slate-300",
                )}
                aria-label="Close mission builder"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              ref={builderBodyRef}
              className="hide-scrollbar relative z-10 p-3.5 h-[68vh] overflow-y-auto! overflow-x-hidden! overscroll-contain touch-pan-y space-y-2.5 home-spotlight-shell"
            >
              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Mission Name</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Daily Team Sync"
                  className={cn("mt-0.5 h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                />
              </div>

              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this mission accomplish?"
                  className={cn("mt-0.5 w-full resize-none bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                />
              </div>

              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                  <div>
                    <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Priority</label>
                    <FluidSelect value={newPriority} onChange={setNewPriority} options={PRIORITY_OPTIONS} isLight={isLight} className="mt-0.5 w-full" />
                  </div>
                  <div>
                    <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Tags</label>
                    <div className={cn("mt-0.5 flex items-center gap-2 rounded-lg border px-2.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            addTag()
                          }
                        }}
                        placeholder="Add tag..."
                        className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                      />
                      <button onClick={() => { playClickSound(); addTag() }} className="text-xs text-accent">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {missionTags.map((tag) => (
                        <button key={tag} onClick={() => { playClickSound(); removeTag(tag) }} className={cn("rounded-md px-2 py-1 text-xs border", isLight ? "border-[#d5dce8] bg-white text-s-80" : "border-white/10 bg-black/20 text-slate-200")}>
                          #{tag} <span className="opacity-70">x</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={cn("rounded-xl border p-3.5 home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock3 className="w-4 h-4 text-accent" />
                  <h4 className={cn("text-lg font-semibold", isLight ? "text-s-90" : "text-slate-100")}>Schedule</h4>
                </div>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[208px_minmax(0,1fr)_168px] lg:items-center">
                  <div className="w-full max-w-full">
                    <TimeField value24={newTime} onChange24={setNewTime} isLight={isLight} />
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const selected = newScheduleDays.includes(day.id)
                      return (
                        <button
                          key={day.id}
                        onClick={() => {
                          playClickSound()
                          toggleScheduleDay(day.id)
                        }}
                        className={cn(
                          "h-8 w-full px-2 rounded-md text-xs font-medium border transition-colors",
                          selected
                            ? "border-accent-30 bg-accent-20 text-accent"
                            : isLight
                              ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]"
                              : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/8",
                          )}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="w-full min-w-40 lg:max-w-45 lg:justify-self-end">
                    <FluidSelect value={newScheduleMode} onChange={setNewScheduleMode} options={SCHEDULE_MODE_OPTIONS} isLight={isLight} />
                  </div>
                </div>
              </div>

              <div className={cn("rounded-xl border p-3.5 home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                <div className="flex items-center justify-between">
                  <h4 className={cn("text-lg font-semibold inline-flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
                    <Zap className="w-4 h-4 text-accent" />
                    Workflow Steps
                  </h4>
                  <span className={cn("text-xs", isLight ? "text-s-60" : "text-slate-400")}>{workflowSteps.length} steps</span>
                </div>
                <div className="mt-3 space-y-2">
                  {workflowSteps.length === 0 && (
                    <div className={cn("rounded-lg border px-3 py-2 text-sm", isLight ? "border-[#d5dce8] bg-white text-s-60" : "border-white/12 bg-black/20 text-slate-400")}>
                      No workflow steps yet. Add workflow steps below.
                    </div>
                  )}
                  {workflowSteps.map((step, index) => (
                    <div
                      key={step.id}
                      onDragOver={(event) => {
                        if (!draggingStepId || draggingStepId === step.id) return
                        event.preventDefault()
                        setDragOverStepId(step.id)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (!draggingStepId || draggingStepId === step.id) return
                        moveWorkflowStepByDrop(draggingStepId, step.id)
                        setDraggingStepId(null)
                        setDragOverStepId(null)
                      }}
                      onDragLeave={() => {
                        if (dragOverStepId === step.id) setDragOverStepId(null)
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2",
                        isLight ? STEP_THEME[step.type].light : STEP_THEME[step.type].dark,
                        dragOverStepId === step.id && (isLight ? "ring-2 ring-accent-30" : "ring-2 ring-accent-30/80"),
                      )}
                    >
                      <div className="grid grid-cols-[18px_18px_36px_minmax(0,1fr)_auto] items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move"
                            event.dataTransfer.setData("text/plain", step.id)
                            setDraggingStepId(step.id)
                          }}
                          onDragEnd={() => {
                            setDraggingStepId(null)
                            setDragOverStepId(null)
                          }}
                          className={cn(
                            "h-5 w-5 inline-flex items-center justify-center rounded cursor-grab active:cursor-grabbing transition-all duration-150",
                            isLight ? "hover:bg-black/5" : "hover:bg-white/10",
                          )}
                          aria-label={`Drag step ${index + 1} to reorder`}
                        >
                          <GripVertical className={cn("w-3.5 h-3.5", isLight ? "text-s-40" : "text-slate-500")} />
                        </button>
                        <span className={cn("text-xs tabular-nums", isLight ? "text-s-60" : "text-slate-400")}>{index + 1}</span>
                        <span
                          className={cn(
                            "h-8 w-8 rounded-md border inline-flex items-center justify-center",
                            isLight ? STEP_THEME[step.type].pillLight : STEP_THEME[step.type].pillDark,
                          )}
                        >
                          {renderStepIcon(step.type, cn("w-3.5 h-3.5", isLight ? STEP_TEXT_THEME[step.type].light : STEP_TEXT_THEME[step.type].dark))}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            value={step.title}
                            onChange={(e) => updateWorkflowStepTitle(step.id, e.target.value)}
                            className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90" : "text-slate-100")}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleWorkflowStepCollapsed(step.id)}
                            className={cn(
                              "h-7 w-7 rounded border inline-flex items-center justify-center transition-colors",
                              isLight ? "border-[#d5dce8] bg-white text-s-60 hover:bg-[#eef3fb]" : "border-white/15 bg-black/20 text-slate-300 hover:bg-white/8",
                            )}
                            aria-label={collapsedStepIds[step.id] ? "Expand step details" : "Collapse step details"}
                          >
                            {collapsedStepIds[step.id] ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => {
                              playClickSound()
                              removeWorkflowStep(step.id)
                            }}
                            className="h-7 w-7 rounded border border-rose-300/40 bg-rose-500/15 text-rose-200 inline-flex items-center justify-center transition-all duration-150 hover:-translate-y-px hover:bg-rose-500/25 hover:shadow-[0_8px_20px_-12px_rgba(244,63,94,0.75)] active:translate-y-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {!collapsedStepIds[step.id] && (
                        <>
                          {step.type === "trigger" && (
                            <div className={cn("mt-3 space-y-1.5 border-t pt-3", isLight ? "border-amber-200/80" : "border-amber-300/20")}>
                              <p className={cn("text-xs", isLight ? "text-amber-700" : "text-amber-300")}>
                                Mission trigger uses the schedule above and automatically uses your detected timezone ({detectedTimezone}).
                              </p>
                            </div>
                          )}
                      {step.type === "fetch" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-sky-200/80" : "border-sky-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Data Source</label>
                              <FluidSelect value={step.fetchSource ?? "web"} onChange={(next) => updateWorkflowStep(step.id, { fetchSource: next as WorkflowStep["fetchSource"] })} options={STEP_FETCH_SOURCE_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>HTTP Method</label>
                              <FluidSelect value={step.fetchMethod ?? "GET"} onChange={(next) => updateWorkflowStep(step.id, { fetchMethod: next as WorkflowStep["fetchMethod"] })} options={STEP_FETCH_METHOD_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Refresh (Minutes)</label>
                              <input
                                value={step.fetchRefreshMinutes ?? "15"}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchRefreshMinutes: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                                placeholder="15"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          {step.fetchSource === "api" && apiFetchIntegrationOptions.length > 0 && (
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>API Integration</label>
                              <FluidSelect
                                value={step.fetchApiIntegrationId ?? ""}
                                onChange={(next) => {
                                  const selected = catalogApiById[next]
                                  updateWorkflowStep(step.id, {
                                    fetchApiIntegrationId: next,
                                    fetchUrl: selected?.endpoint || step.fetchUrl || "",
                                  })
                                }}
                                options={apiFetchIntegrationOptions}
                                isLight={isLight}
                              />
                            </div>
                          )}
                          {step.fetchSource === "web" ? (
                            <div className={cn("rounded-md border px-3 py-2 text-xs", isLight ? "border-sky-200 bg-sky-50/80 text-sky-800" : "border-sky-300/25 bg-sky-500/10 text-sky-200")}>
                              Brave search is managed automatically. No endpoint URL or auth headers are needed.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Endpoint / URL</label>
                              <input
                                value={step.fetchUrl ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchUrl: e.target.value })}
                                placeholder="https://api.example.com/data"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Query / Params</label>
                              <input
                                value={step.fetchQuery ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchQuery: e.target.value })}
                                placeholder={step.fetchSource === "web" ? "nba last night highlights final scores top performers" : "symbol=BTC&window=24h"}
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>CSS Selector (Web Scrape)</label>
                              <input
                                value={step.fetchSelector ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchSelector: e.target.value })}
                                placeholder="a[href]"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className={cn("flex items-center justify-between rounded-md border px-3 py-2", isLight ? "border-sky-200 bg-white/90" : "border-sky-300/30 bg-black/20")}>
                            <div>
                              <p className={cn("text-xs font-medium", isLight ? "text-sky-700" : "text-sky-300")}>Include Sources In Output</p>
                              <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>
                                Adds 1 source per Web Request.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateWorkflowStep(step.id, { fetchIncludeSources: !(step.fetchIncludeSources !== false) })}
                              className="inline-flex items-center"
                              aria-label="Toggle source links in output"
                            >
                              <NovaSwitch checked={step.fetchIncludeSources !== false} />
                            </button>
                          </div>
                          {step.fetchSource !== "web" && (
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Headers / Auth JSON</label>
                              <textarea
                                value={step.fetchHeaders ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchHeaders: e.target.value })}
                                placeholder='{"Authorization":"Bearer ...","X-Source":"nova"}'
                                className={cn(
                                  "min-h-16 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      {step.type === "transform" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-emerald-200/80" : "border-emerald-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Transform Action</label>
                              <FluidSelect value={step.transformAction ?? "normalize"} onChange={(next) => updateWorkflowStep(step.id, { transformAction: next as WorkflowStep["transformAction"] })} options={STEP_TRANSFORM_ACTION_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Output Format</label>
                              <FluidSelect value={step.transformFormat ?? "markdown"} onChange={(next) => updateWorkflowStep(step.id, { transformFormat: next as WorkflowStep["transformFormat"] })} options={STEP_TRANSFORM_FORMAT_OPTIONS} isLight={isLight} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Transform Rules</label>
                            <textarea
                              value={step.transformInstruction ?? ""}
                              onChange={(e) => updateWorkflowStep(step.id, { transformInstruction: e.target.value })}
                              placeholder="Normalize fields, dedupe by ID, sort by priority, format for output."
                              className={cn(
                                "min-h-18 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                isLight ? "border-emerald-200 bg-white text-s-90 placeholder:text-s-40" : "border-emerald-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                        </div>
                      )}
                      {step.type === "condition" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-orange-200/80" : "border-orange-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Data Field</label>
                              <input
                                value={step.conditionField ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { conditionField: e.target.value })}
                                placeholder="priceChangePct"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-orange-200 bg-white text-s-90 placeholder:text-s-40" : "border-orange-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Operator</label>
                              <FluidSelect value={step.conditionOperator ?? "contains"} onChange={(next) => updateWorkflowStep(step.id, { conditionOperator: next as WorkflowStep["conditionOperator"] })} options={STEP_CONDITION_OPERATOR_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Expected Value</label>
                              <input
                                value={step.conditionValue ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { conditionValue: e.target.value })}
                                placeholder="5"
                                disabled={(step.conditionOperator ?? "contains") === "exists"}
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none disabled:opacity-50",
                                  isLight ? "border-orange-200 bg-white text-s-90 placeholder:text-s-40" : "border-orange-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Rule Logic</label>
                              <FluidSelect value={step.conditionLogic ?? "all"} onChange={(next) => updateWorkflowStep(step.id, { conditionLogic: next as WorkflowStep["conditionLogic"] })} options={STEP_CONDITION_LOGIC_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>If Condition Fails</label>
                              <FluidSelect value={step.conditionFailureAction ?? "skip"} onChange={(next) => updateWorkflowStep(step.id, { conditionFailureAction: next as WorkflowStep["conditionFailureAction"] })} options={STEP_CONDITION_FAILURE_OPTIONS} isLight={isLight} />
                            </div>
                          </div>
                        </div>
                      )}
                      {step.type === "output" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-pink-200/80" : "border-pink-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Delivery Channel</label>
                              <FluidSelect
                                value={step.outputChannel ?? "telegram"}
                                onChange={(next) => {
                                  const nextChannel = next as WorkflowStep["outputChannel"]
                                  updateWorkflowStep(step.id, {
                                    outputChannel: nextChannel,
                                    outputTime: newTime,
                                    outputTiming: step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate",
                                    outputFrequency: step.outputFrequency === "multiple" ? "multiple" : "once",
                                    outputRepeatCount: step.outputFrequency === "multiple" ? (step.outputRepeatCount || "3") : "1",
                                    outputRecipients: sanitizeOutputRecipients(nextChannel, step.outputRecipients),
                                    outputTemplate: "",
                                  })
                                }}
                                options={outputChannelOptions}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Notify When</label>
                              <FluidSelect
                                value={step.outputTiming ?? "immediate"}
                                onChange={(next) => updateWorkflowStep(step.id, {
                                  outputTiming: next as WorkflowStep["outputTiming"],
                                  outputTime: newTime,
                                })}
                                options={STEP_OUTPUT_TIMING_OPTIONS}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Notification Count</label>
                              <FluidSelect
                                value={step.outputFrequency ?? "once"}
                                onChange={(next) => {
                                  const outputFrequency = next as WorkflowStep["outputFrequency"]
                                  updateWorkflowStep(step.id, {
                                    outputFrequency,
                                    outputRepeatCount: outputFrequency === "multiple" ? (step.outputRepeatCount || "3") : "1",
                                  })
                                }}
                                options={STEP_OUTPUT_FREQUENCY_OPTIONS}
                                isLight={isLight}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      {step.type === "ai" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-violet-200/80" : "border-violet-300/20")}>
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>AI Prompt</label>
                            <textarea
                              value={step.aiPrompt ?? ""}
                              onChange={(e) => updateWorkflowStepAi(step.id, { aiPrompt: e.target.value })}
                              placeholder="Describe what the AI should do with the data..."
                              className={cn(
                                "min-h-22 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                isLight
                                  ? "border-violet-200 bg-white text-s-90 placeholder:text-s-40"
                                  : "border-violet-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>Model</label>
                              <FluidSelect
                                value={step.aiModel ?? ""}
                                onChange={(next) => updateWorkflowStepAi(step.id, { aiModel: next })}
                                options={getModelOptionsForProvider(step.aiIntegration ?? resolveDefaultAiIntegration(), integrationsSettings)}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>Integration</label>
                              <FluidSelect
                                value={step.aiIntegration ?? resolveDefaultAiIntegration()}
                                onChange={(next) => {
                                  const nextIntegration = next as AiIntegrationType
                                  updateWorkflowStepAi(step.id, {
                                    aiIntegration: nextIntegration,
                                    aiModel: getDefaultModelForProvider(nextIntegration, integrationsSettings),
                                  })
                                }}
                                options={configuredAiIntegrationOptions.length > 0 ? configuredAiIntegrationOptions : [{ value: integrationsSettings.activeLlmProvider, label: AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider] }]}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>Detail Level</label>
                              <FluidSelect
                                value={step.aiDetailLevel ?? "standard"}
                                onChange={(next) => updateWorkflowStepAi(step.id, { aiDetailLevel: normalizeAiDetailLevel(next) })}
                                options={AI_DETAIL_LEVEL_OPTIONS}
                                isLight={isLight}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", isLight ? "text-violet-700" : "text-violet-300")}>
                              <GitBranch className="w-3.5 h-3.5" />
                              Conditional Logic
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                playClickSound()
                                void novaSuggestForAiStep(step.id)
                              }}
                              disabled={Boolean(novaSuggestingByStepId[step.id])}
                              className={cn(
                                "h-7 px-2.5 rounded-md border inline-flex items-center gap-1 text-xs font-medium transition-all duration-150 disabled:opacity-60 disabled:transform-none hover:-translate-y-px active:translate-y-0",
                                isLight
                                  ? "border-violet-300 bg-violet-100/70 text-violet-700 hover:bg-violet-100 hover:shadow-[0_8px_18px_-12px_rgba(124,58,237,0.45)]"
                                  : "border-violet-300/35 bg-violet-500/12 text-violet-200 hover:bg-violet-500/20 hover:shadow-[0_10px_22px_-12px_rgba(167,139,250,0.6)]",
                              )}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {novaSuggestingByStepId[step.id] ? "Nova Suggesting..." : "Nova Suggest"}
                            </button>
                          </div>
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STEP_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      onClick={() => {
                        playClickSound()
                        addWorkflowStep(option.type)
                      }}
                      className={cn(
                        "h-8 px-3 rounded-md border text-xs transition-all duration-150 inline-flex items-center gap-1.5 hover:-translate-y-px active:translate-y-0",
                        isLight ? STEP_THEME[option.type].light : STEP_THEME[option.type].dark,
                        isLight ? STEP_TEXT_THEME[option.type].light : STEP_TEXT_THEME[option.type].dark,
                        isLight
                          ? "hover:shadow-[0_10px_18px_-12px_rgba(15,23,42,0.35)]"
                          : "hover:shadow-[0_10px_22px_-12px_rgba(148,163,184,0.35)]",
                      )}
                    >
                      {renderStepIcon(option.type, "w-3 h-3")}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <div ref={builderFooterRef} className={cn("home-spotlight-shell relative z-10 border-t px-5 py-3 flex items-center justify-between", isLight ? "border-[#e2e8f2] bg-[#f9fbff]" : "border-white/10 bg-black/30")}>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    playClickSound()
                    setMissionActive((prev) => !prev)
                  }}
                  className="inline-flex items-center gap-2 text-sm"
                  aria-label="Toggle mission active"
                >
                  <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>Mission Active</span>
                  <NovaSwitch checked={missionActive} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playClickSound()
                    setRunImmediatelyOnCreate((prev) => !prev)
                  }}
                  className="inline-flex items-center gap-2 text-sm"
                  aria-label={editingMissionId ? "Run once immediately after saving mission" : "Run once immediately after creating mission"}
                >
                  <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>Run Once Now</span>
                  <NovaSwitch checked={runImmediatelyOnCreate} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    playClickSound()
                    setBuilderOpen(false)
                  }}
                  className={cn(
                    "mission-builder-hover-gleam h-8 px-3 rounded-lg transition-colors inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                    subPanelClass,
                    isLight ? "text-s-70" : "text-slate-300",
                  )}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    playClickSound()
                    void deployMissionFromBuilder()
                  }}
                  disabled={deployingMission}
                  className="mission-builder-hover-gleam h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent text-sm font-medium inline-flex items-center justify-center disabled:opacity-50 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover"
                >
                  {deployingMission ? (editingMissionId ? "Saving..." : "Deploying...") : (editingMissionId ? "Save Mission" : "Deploy Mission")}
                </button>
              </div>
            </div>
          </div>
        </div>
  )
}
