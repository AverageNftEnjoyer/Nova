"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Settings } from "lucide-react"

import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { SettingsModal } from "@/components/settings/settings-modal"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { DeleteMissionDialog } from "./components/delete-mission-dialog"
import { MissionActionMenu } from "./components/mission-action-menu"
import { MissionBuilderModal } from "./components/mission-builder-modal"
import { MissionCanvasModal } from "./components/mission-canvas-modal"
import { MissionsMainPanels } from "./components/missions-main-panels"
import { RunProgressPanel } from "./components/run-progress-panel"
import { defaultMissionSettings, type Mission } from "@/lib/missions/types"
import { MISSION_TEMPLATES } from "@/lib/missions/templates"
import { hexToRgba } from "./helpers"
import { useMissionsPageState } from "./hooks/use-missions-page-state"
import { missionToWorkflowSummaryForAutofix } from "./canvas/workflow-autofix-bridge"
import type { NotificationSchedule } from "./types"
import { resolveTimezone } from "@/lib/shared/timezone"

const WORKFLOW_MARKER = "[NOVA WORKFLOW]"

export default function MissionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get("returnTo")
  const [orbHovered, setOrbHovered] = useState(false)
  const [canvasModalOpen, setCanvasModalOpen] = useState(false)
  const [canvasMission, setCanvasMission] = useState<Mission | null>(null)
  const [canvasSaving, setCanvasSaving] = useState(false)
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"

  const {
    settingsOpen,
    setSettingsOpen,
    builderOpen,
    setBuilderOpen,
    status,
    setStatus,
    runProgress,
    setRunProgress,
    schedules,
    setSchedules,
    setBaselineById,
    createSectionRef,
    listSectionRef,
    integrationsSettings,
    novaMissionPrompt,
    novaGeneratingMission,
    searchQuery,
    statusFilter,
    missionBoardView,
    loading,
    filteredSchedules,
    busyById,
    missionRuntimeStatusById,
    setNovaMissionPrompt,
    setSearchQuery,
    setStatusFilter,
    setMissionBoardView,
    generateMissionDraftFromPrompt,
    playClickSound,
    formatStatusTime,
    setMissionActionMenu,
    updateLocalSchedule,
    saveMission,
    setPendingDeleteMission,
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
    workflowAutofixPreview,
    workflowAutofixSelectionById,
    workflowAutofixLoading,
    workflowAutofixApplying,
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
    configuredAiIntegrationOptions,
    novaSuggestForAiStep,
    novaSuggestingByStepId,
    addWorkflowStep,
    previewWorkflowFixes,
    toggleWorkflowAutofixSelection,
    applyWorkflowFixes,
    builderBodyRef,
    builderFooterRef,
    missionActive,
    setMissionActive,
    runImmediatelyOnCreate,
    setRunImmediatelyOnCreate,
    editingMissionId,
    deployMissionFromBuilder,
    deployingMission,
    missionActionMenu,
    missionActionMenuRef,
    editMissionFromActions,
    duplicateMission,
    runMissionNow,
    pendingDeleteMission,
    confirmDeleteMission,
    orbPalette,
    panelStyle,
    panelClass,
    moduleHeightClass,
    subPanelClass,
    heroHeaderRef,
    headerActionsRef,
    missionStats,
  } = useMissionsPageState({ isLight, returnTo })

  const editId = searchParams.get("editId")
  useEffect(() => {
    if (!editId || loading || builderOpen) return
    const target = schedules.find((s) => s.id === editId)
    if (target) editMissionFromActions(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, loading])

  const buildPipelineScheduleFromMission = (mission: Mission): NotificationSchedule => {
    const trigger = mission.nodes.find((node) => node.type === "schedule-trigger")
    const summary = missionToWorkflowSummaryForAutofix(mission)
    const workflowSummary = {
      description: String(mission.description || "").trim(),
      priority: "medium",
      schedule: {
        mode: trigger?.type === "schedule-trigger" ? trigger.triggerMode || "daily" : "daily",
        days: trigger?.type === "schedule-trigger" && Array.isArray(trigger.triggerDays) && trigger.triggerDays.length > 0
          ? trigger.triggerDays
          : ["mon", "tue", "wed", "thu", "fri"],
        time: trigger?.type === "schedule-trigger" ? trigger.triggerTime || "09:00" : "09:00",
        timezone: trigger?.type === "schedule-trigger"
          ? resolveTimezone(trigger.triggerTimezone, mission.settings?.timezone, detectedTimezone)
          : resolveTimezone(mission.settings?.timezone, detectedTimezone),
      },
      missionActive: mission.status === "active" || mission.status === "draft",
      tags: Array.isArray(mission.tags) ? mission.tags : [],
      workflowSteps: summary.workflowSteps || [],
    }
    const description = workflowSummary.description || mission.label || "Mission run"
    const message = `${description}\n\n${WORKFLOW_MARKER}\n${JSON.stringify(workflowSummary)}`
    return {
      id: mission.id,
      integration: mission.integration || "telegram",
      label: mission.label || "Untitled mission",
      message,
      time: workflowSummary.schedule.time,
      timezone: workflowSummary.schedule.timezone,
      enabled: workflowSummary.missionActive !== false,
      chatIds: Array.isArray(mission.chatIds) ? mission.chatIds : [],
      updatedAt: mission.updatedAt || new Date().toISOString(),
      runCount: Number.isFinite(mission.runCount) ? mission.runCount : 0,
      successCount: Number.isFinite(mission.successCount) ? mission.successCount : 0,
      failureCount: Number.isFinite(mission.failureCount) ? mission.failureCount : 0,
      lastRunAt: mission.lastRunAt,
    }
  }

  const upsertMissionInPipeline = (schedule: NotificationSchedule) => {
    setSchedules((prev) => {
      const idx = prev.findIndex((row) => row.id === schedule.id)
      if (idx < 0) return [schedule, ...prev]
      const next = [...prev]
      next[idx] = { ...next[idx], ...schedule }
      return next
    })
    setBaselineById((prev) => ({ ...prev, [schedule.id]: schedule }))
  }

  const upsertNotificationSchedule = async (schedule: NotificationSchedule): Promise<NotificationSchedule> => {
    const payload = {
      id: schedule.id,
      integration: schedule.integration,
      label: schedule.label,
      message: schedule.message,
      time: schedule.time,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      chatIds: Array.isArray(schedule.chatIds) ? schedule.chatIds : [],
    }
    const response = await fetch("/api/notifications/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({})) as { schedule?: NotificationSchedule; error?: string }
    if (!response.ok) {
      throw new Error(data.error || "Failed to save mission pipeline schedule.")
    }
    return data.schedule || schedule
  }

  const handleApplyTemplate = async (templateId: string) => {
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      })
      const data = await res.json() as { ok: boolean; mission?: Mission }
      if (data.ok && data.mission) {
        upsertMissionInPipeline(buildPipelineScheduleFromMission(data.mission))
        setCanvasMission(data.mission)
        setCanvasModalOpen(true)
        return
      }
    } catch {}
  }

  const handleViewInCanvas = async (missionId: string) => {
    try {
      const res = await fetch(`/api/missions?id=${encodeURIComponent(missionId)}`)
      const data = await res.json() as { ok: boolean; mission?: Mission }
      if (data.ok && data.mission) {
        setCanvasMission(data.mission)
        setCanvasModalOpen(true)
      }
    } catch {
      // Silently fail — canvas button is optional
    }
  }

  const handleCanvasSave = async (mission: Mission): Promise<boolean> => {
    setCanvasSaving(true)
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission }),
      })
      const data = await response.json().catch(() => ({})) as { ok?: boolean; mission?: Mission; error?: string }
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to save mission.")
      }
      const savedMission = data?.mission || mission
      const persistedSchedule = await upsertNotificationSchedule(buildPipelineScheduleFromMission(savedMission))
      upsertMissionInPipeline(persistedSchedule)
      setCanvasMission(savedMission)
      setCanvasModalOpen(false)
      setStatus({ type: "success", message: `Mission "${savedMission.label || "Untitled mission"}" saved to Mission Pipeline Settings.` })
      return true
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save mission." })
      return false
    } finally {
      setCanvasSaving(false)
    }
  }

  const handleCanvasRun = async (mission: Mission) => {
    setCanvasSaving(true)
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission }),
      })
      const data = await response.json().catch(() => ({})) as { ok?: boolean; mission?: Mission; error?: string }
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to save mission before run.")
      }
      const savedMission = data?.mission || mission
      const persistedSchedule = await upsertNotificationSchedule(buildPipelineScheduleFromMission(savedMission))
      upsertMissionInPipeline(persistedSchedule)
      setCanvasMission(savedMission)
      setCanvasModalOpen(false)
      await runMissionNow(persistedSchedule, {
        workflowSteps: missionToWorkflowSummaryForAutofix(savedMission).workflowSteps,
      })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to run mission." })
    } finally {
      setCanvasSaving(false)
    }
  }

  const handleCreateMissionInCanvas = () => {
    const now = new Date().toISOString()
    const draftMission: Mission = {
      id: crypto.randomUUID(),
      userId: "",
      label: "New Mission",
      description: "",
      category: "research",
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
    setCanvasMission(draftMission)
    setCanvasModalOpen(true)
  }

  const presence = getNovaPresence({ agentConnected, novaState })
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>

      <div className="relative z-10 flex-1 h-dvh overflow-hidden transition-all duration-200">
        <div className="flex h-full w-full items-start justify-start px-3 py-4 sm:px-4 lg:px-6">
          <div className="w-full">
            <div ref={heroHeaderRef} className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => router.push("/home")}
                  onMouseEnter={() => setOrbHovered(true)}
                  onMouseLeave={() => setOrbHovered(false)}
                  className="group relative h-11 w-11 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
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
                <div className="min-w-0">
                  <div className="flex flex-col leading-tight">
                    <div className="flex items-baseline gap-3">
                      <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                      <p className="text-[11px] text-accent font-mono">{NOVA_VERSION}</p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <div className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} aria-hidden="true" />
                        <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                          {presence.label}
                        </span>
                      </div>
                      <p className={cn("text-[13px] whitespace-nowrap", isLight ? "text-s-50" : "text-slate-400")}>Missions & Automations Hub</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="min-w-0 px-1">
                <div className="mx-auto grid w-full max-w-184 grid-cols-4 items-stretch gap-2">
                  {[
                    { label: "Total Missions", value: String(missionStats.total), dotClass: isLight ? "bg-s-40" : "bg-slate-400" },
                    { label: "Active Missions", value: String(missionStats.enabled), dotClass: isLight ? "bg-emerald-400" : "bg-emerald-400" },
                    { label: "Total Runs", value: String(missionStats.totalRuns), dotClass: isLight ? "bg-sky-400" : "bg-sky-400" },
                    { label: "Success Rate", value: `${missionStats.successRate}%`, dotClass: isLight ? "bg-accent" : "bg-accent" },
                  ].map((tile) => (
                    <div
                      key={tile.label}
                      className={cn(
                        "h-9 rounded-md border px-2 py-1.5 flex items-center justify-between home-spotlight-card home-border-glow",
                        subPanelClass,
                      )}
                    >
                      <div className="min-w-0">
                        <p className={cn("text-[9px] uppercase tracking-[0.12em] truncate", isLight ? "text-s-50" : "text-slate-400")}>{tile.label}</p>
                        <p className={cn("text-sm font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{tile.value}</p>
                      </div>
                      <span className={cn("h-2.5 w-2.5 rounded-sm", tile.dotClass)} />
                    </div>
                  ))}
                </div>
              </div>
              <div ref={headerActionsRef} className="flex items-center gap-2 home-spotlight-shell">
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={cn("h-8 w-8 rounded-lg transition-colors group/gear home-spotlight-card home-border-glow", subPanelClass)}
                  aria-label="Open settings"
                  title="Settings"
                >
                  <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                </button>
                <button
                  onClick={() => {
                    playClickSound()
                    handleCreateMissionInCanvas()
                  }}
                  className={cn(
                    "h-8 px-3 rounded-lg border transition-colors text-sm font-medium inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-dynamic",
                    isLight
                      ? "border-accent-30 bg-accent-10 text-accent"
                      : "border-accent-30 bg-accent-10 text-accent",
                  )}
                >
                  New Mission
                </button>
              </div>
            </div>

            {status && (
              <div className="pointer-events-none fixed left-1/2 top-5 z-70 -translate-x-1/2">
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-md",
                    status.type === "success"
                      ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                      : "border-rose-300/40 bg-rose-500/15 text-rose-200",
                  )}
                >
                  {status.message}
                </div>
              </div>
            )}
            {runProgress && (
              <RunProgressPanel
                isLight={isLight}
                runProgress={runProgress}
                onClose={() => setRunProgress(null)}
                onOpenChat={() => {
                  setRunProgress(null)
                  router.push("/chat")
                }}
              />
            )}

            <MissionsMainPanels
              isLight={isLight}
              panelStyle={panelStyle}
              panelClass={panelClass}
              moduleHeightClass={moduleHeightClass}
              subPanelClass={subPanelClass}
              createSectionRef={createSectionRef}
              listSectionRef={listSectionRef}
              templates={MISSION_TEMPLATES}
              integrationsSettings={integrationsSettings}
              novaMissionPrompt={novaMissionPrompt}
              novaGeneratingMission={novaGeneratingMission}
              searchQuery={searchQuery}
              statusFilter={statusFilter}
              missionBoardView={missionBoardView}
              loading={loading}
              filteredSchedules={filteredSchedules}
              busyById={busyById}
              runProgress={runProgress}
              missionRuntimeStatusById={missionRuntimeStatusById}
              onNovaMissionPromptChange={setNovaMissionPrompt}
              onSearchQueryChange={setSearchQuery}
              onStatusFilterChange={setStatusFilter}
              onMissionBoardViewChange={setMissionBoardView}
              onApplyTemplate={(id) => void handleApplyTemplate(id)}
              onGenerateMissionDraft={() => {
                void generateMissionDraftFromPrompt()
              }}
              onPlayClickSound={playClickSound}
              formatStatusTime={formatStatusTime}
              onMissionActionMenu={(mission, left, top) => setMissionActionMenu({ mission, left, top })}
              onToggleMissionEnabled={(mission) => {
                const nextEnabled = !mission.enabled
                updateLocalSchedule(mission.id, { enabled: nextEnabled })
                void saveMission({ ...mission, enabled: nextEnabled })
              }}
              onRequestDeleteMission={setPendingDeleteMission}
              onViewInCanvas={(id) => void handleViewInCanvas(id)}
            />
          </div>
        </div>
      </div>

      <MissionBuilderModal
        builderOpen={builderOpen}
        playClickSound={playClickSound}
        setBuilderOpen={setBuilderOpen}
        panelStyle={panelStyle}
        isLight={isLight}
        orbPalette={orbPalette}
        builderBodyRef={builderBodyRef}
        subPanelClass={subPanelClass}
        newLabel={newLabel}
        setNewLabel={setNewLabel}
        newDescription={newDescription}
        setNewDescription={setNewDescription}
        newPriority={newPriority}
        setNewPriority={setNewPriority}
        tagInput={tagInput}
        setTagInput={setTagInput}
        addTag={addTag}
        missionTags={missionTags}
        removeTag={removeTag}
        newTime={newTime}
        setNewTime={setNewTime}
        newScheduleDays={newScheduleDays}
        toggleScheduleDay={toggleScheduleDay}
        newScheduleMode={newScheduleMode}
        setNewScheduleMode={setNewScheduleMode}
        workflowSteps={workflowSteps}
        workflowAutofixPreview={workflowAutofixPreview}
        workflowAutofixSelectionById={workflowAutofixSelectionById}
        workflowAutofixLoading={workflowAutofixLoading}
        workflowAutofixApplying={workflowAutofixApplying}
        draggingStepId={draggingStepId}
        setDragOverStepId={setDragOverStepId}
        moveWorkflowStepByDrop={moveWorkflowStepByDrop}
        setDraggingStepId={setDraggingStepId}
        dragOverStepId={dragOverStepId}
        updateWorkflowStepTitle={updateWorkflowStepTitle}
        toggleWorkflowStepCollapsed={toggleWorkflowStepCollapsed}
        collapsedStepIds={collapsedStepIds}
        removeWorkflowStep={removeWorkflowStep}
        detectedTimezone={detectedTimezone}
        updateWorkflowStep={updateWorkflowStep}
        apiFetchIntegrationOptions={apiFetchIntegrationOptions}
        catalogApiById={catalogApiById}
        outputChannelOptions={outputChannelOptions}
        updateWorkflowStepAi={updateWorkflowStepAi}
        resolveDefaultAiIntegration={resolveDefaultAiIntegration}
        integrationsSettings={integrationsSettings}
        configuredAiIntegrationOptions={configuredAiIntegrationOptions}
        novaSuggestForAiStep={novaSuggestForAiStep}
        novaSuggestingByStepId={novaSuggestingByStepId}
        addWorkflowStep={addWorkflowStep}
        previewWorkflowFixes={previewWorkflowFixes}
        toggleWorkflowAutofixSelection={toggleWorkflowAutofixSelection}
        applyWorkflowFixes={applyWorkflowFixes}
        builderFooterRef={builderFooterRef}
        missionActive={missionActive}
        setMissionActive={setMissionActive}
        runImmediatelyOnCreate={runImmediatelyOnCreate}
        setRunImmediatelyOnCreate={setRunImmediatelyOnCreate}
        editingMissionId={editingMissionId}
        deployMissionFromBuilder={deployMissionFromBuilder}
        deployingMission={deployingMission}
      />

      {missionActionMenu && (
        <MissionActionMenu
          isLight={isLight}
          menu={missionActionMenu}
          menuRef={missionActionMenuRef}
          onEdit={() => {
            const target = missionActionMenu.mission
            setMissionActionMenu(null)
            editMissionFromActions(target)
          }}
          onDuplicate={() => {
            const target = missionActionMenu.mission
            setMissionActionMenu(null)
            void duplicateMission(target)
          }}
          onRunNow={() => {
            const target = missionActionMenu.mission
            setMissionActionMenu(null)
            void runMissionNow(target)
          }}
          onDelete={() => {
            const target = missionActionMenu.mission
            setMissionActionMenu(null)
            setPendingDeleteMission(target)
          }}
        />
      )}

      {pendingDeleteMission && (
        <DeleteMissionDialog
          isLight={isLight}
          mission={pendingDeleteMission}
          busy={Boolean(busyById[pendingDeleteMission.id])}
          panelStyle={panelStyle}
          onCancel={() => setPendingDeleteMission(null)}
          onConfirm={() => void confirmDeleteMission()}
        />
      )}

      <MissionCanvasModal
        mission={canvasMission}
        open={canvasModalOpen}
        onClose={() => setCanvasModalOpen(false)}
        onSave={handleCanvasSave}
        onRun={handleCanvasRun}
        isSaving={canvasSaving}
      />

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

