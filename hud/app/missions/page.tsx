"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Image from "next/image"
import { Settings } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { SettingsModal } from "@/components/settings-modal"
import FloatingLines from "@/components/FloatingLines"
import { NovaOrbIndicator } from "@/components/nova-orb-indicator"
import { useNovaState } from "@/lib/useNovaState"
import { getNovaPresence } from "@/lib/nova-presence"
import { usePageActive } from "@/lib/use-page-active"
import { NOVA_VERSION } from "@/lib/version"
import "@/components/FloatingLines.css"

import {
  FLOATING_LINES_BOTTOM_WAVE_POSITION,
  FLOATING_LINES_ENABLED_WAVES,
  FLOATING_LINES_LINE_COUNT,
  FLOATING_LINES_LINE_DISTANCE,
  FLOATING_LINES_MIDDLE_WAVE_POSITION,
  FLOATING_LINES_TOP_WAVE_POSITION,
} from "./constants"
import { DeleteMissionDialog } from "./components/delete-mission-dialog"
import { MissionActionMenu } from "./components/mission-action-menu"
import { MissionBuilderModal } from "./components/mission-builder-modal"
import { MissionsMainPanels } from "./components/missions-main-panels"
import { RunProgressPanel } from "./components/run-progress-panel"
import { hexToRgba } from "./helpers"
import { useMissionsPageState } from "./hooks/use-missions-page-state"
export default function MissionsPage() {
  const router = useRouter()
  const [orbHovered, setOrbHovered] = useState(false)
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"

  const {
    mounted,
    background,
    backgroundVideoUrl,
    backgroundMediaIsImage,
    settingsOpen,
    setSettingsOpen,
    builderOpen,
    setBuilderOpen,
    status,
    runProgress,
    setRunProgress,
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
    applyTemplate,
    generateMissionDraftFromPrompt,
    playClickSound,
    formatStatusTime,
    resetMissionBuilder,
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
    floatingLinesGradient,
    panelStyle,
    panelClass,
    moduleHeightClass,
    subPanelClass,
    heroHeaderRef,
    headerActionsRef,
    missionStats,
  } = useMissionsPageState({ isLight })

  const presence = getNovaPresence({ agentConnected, novaState })
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {mounted && background === "floatingLines" && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 48% 42%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.16)} 30%, transparent 60%)`,
            }}
          />
        </div>
      )}
      {mounted && background === "customVideo" && !isLight && !!backgroundVideoUrl && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          {backgroundMediaIsImage ? (
            <Image
              fill
              unoptimized
              sizes="100vw"
              className="object-cover"
              src={backgroundVideoUrl}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <video
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              src={backgroundVideoUrl}
            />
          )}
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

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
                        "h-9 rounded-md border px-2 py-1.5 flex items-center justify-between",
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
                    resetMissionBuilder()
                    setBuilderOpen(true)
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
                  router.push(`/chat?open=novachat&t=${Date.now()}`)
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
              onApplyTemplate={applyTemplate}
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

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
