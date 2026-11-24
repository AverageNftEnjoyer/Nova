"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { CalendarDays, ChevronDown, ListChecks, Network, Plus } from "lucide-react"

import { PageContainer } from "@/components/shell"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PageHeader,
  toast,
} from "@/components/ui"
import { defaultMissionSettings, type Mission } from "@/lib/missions/types"
import { MISSION_TEMPLATES } from "@/lib/missions/templates"
import { resolveTimezone } from "@/lib/shared/timezone"
import { DeleteMissionDialog } from "./components/delete-mission-dialog"
import { MissionBuilderModal } from "./components/mission-builder-modal"
import { MissionCanvasModal } from "./components/mission-canvas-modal"
import { MissionsMainPanels, type MissionRowActions } from "./components/missions-main-panels"
import { RunProgressPanel } from "./components/run-progress-panel"
import { useMissionsPageState } from "./hooks/use-missions-page-state"
import { missionToWorkflowSummaryForAutofix } from "./canvas/workflow-autofix-bridge"
import type { MissionListItem } from "./types"

function MissionsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get("returnTo")
  const [canvasModalOpen, setCanvasModalOpen] = useState(false)
  const [canvasMission, setCanvasMission] = useState<Mission | null>(null)
  const [canvasSaving, setCanvasSaving] = useState(false)
  const openedFromDeploymentRef = useRef(false)

  const state = useMissionsPageState({ returnTo })
  const {
    builderOpen,
    setBuilderOpen,
    status,
    setStatus,
    runProgress,
    setRunProgress,
    schedules,
    setSchedules,
    setBaselineById,
    detectedTimezone,
    loading,
    busyById,
    editMissionFromActions,
    duplicateMission,
    runMissionNow,
    updateLocalSchedule,
    saveMission,
    pendingDeleteMission,
    setPendingDeleteMission,
    confirmDeleteMission,
    resetMissionBuilder,
  } = state

  // Status messages from the page state surface as toasts.
  useEffect(() => {
    if (!status) return
    if (status.type === "success") toast.success(status.message)
    else toast.error(status.message)
    setStatus(null)
  }, [setStatus, status])

  const editId = searchParams.get("editId")
  const createMode = searchParams.get("create")
  useEffect(() => {
    if (createMode !== "builder" || openedFromDeploymentRef.current) return
    openedFromDeploymentRef.current = true
    setBuilderOpen(true)
  }, [createMode, setBuilderOpen])

  useEffect(() => {
    if (!editId || loading || builderOpen) return
    const target = schedules.find((s) => s.id === editId)
    if (target) void editMissionFromActions(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, loading])

  const buildPipelineScheduleFromMission = (mission: Mission): MissionListItem => {
    const trigger = mission.nodes.find((node) => node.type === "schedule-trigger")
    const summary = missionToWorkflowSummaryForAutofix(mission)
    const description = String(mission.description || mission.label || "Mission run").trim()
    const time = trigger?.type === "schedule-trigger" ? trigger.triggerTime || "09:00" : "09:00"
    const timezone = trigger?.type === "schedule-trigger"
      ? resolveTimezone(trigger.triggerTimezone, mission.settings?.timezone, detectedTimezone)
      : resolveTimezone(mission.settings?.timezone, detectedTimezone)
    const mode = trigger?.type === "schedule-trigger" ? trigger.triggerMode || "daily" : "daily"
    return {
      id: mission.id,
      integration: mission.integration || "telegram",
      label: mission.label || "Untitled mission",
      message: description,
      description,
      priority: "medium",
      workflowSteps: summary.workflowSteps || [],
      mode,
      time,
      timezone,
      enabled: mission.status === "active" || mission.status === "draft",
      chatIds: Array.isArray(mission.chatIds) ? mission.chatIds : [],
      updatedAt: mission.updatedAt || new Date().toISOString(),
      runCount: Number.isFinite(mission.runCount) ? mission.runCount : 0,
      successCount: Number.isFinite(mission.successCount) ? mission.successCount : 0,
      failureCount: Number.isFinite(mission.failureCount) ? mission.failureCount : 0,
      lastRunAt: mission.lastRunAt,
    }
  }

  const upsertMissionInPipeline = (schedule: MissionListItem) => {
    setSchedules((prev) => {
      const idx = prev.findIndex((row) => row.id === schedule.id)
      if (idx < 0) return [schedule, ...prev]
      const next = [...prev]
      next[idx] = { ...next[idx], ...schedule }
      return next
    })
    setBaselineById((prev) => ({ ...prev, [schedule.id]: schedule }))
  }

  const handleApplyTemplate = async (templateId: string) => {
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      })
      const data = await res.json() as { ok: boolean; mission?: Mission; error?: string }
      if (!data.ok || !data.mission) throw new Error(data.error || "Could not create a mission from this template.")
      upsertMissionInPipeline(buildPipelineScheduleFromMission(data.mission))
      setCanvasMission(data.mission)
      setCanvasModalOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a mission from this template.")
    }
  }

  const handleViewInCanvas = async (missionId: string) => {
    try {
      const res = await fetch(`/api/missions?id=${encodeURIComponent(missionId)}`)
      const data = await res.json() as { ok: boolean; mission?: Mission; error?: string }
      if (!data.ok || !data.mission) throw new Error(data.error || "Could not load this mission.")
      setCanvasMission(data.mission)
      setCanvasModalOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load this mission.")
    }
  }

  const saveCanvasMission = async (mission: Mission, failureMessage: string): Promise<Mission> => {
    const response = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission }),
    })
    const data = await response.json() as { ok?: boolean; mission?: Mission; error?: string }
    if (!response.ok || !data?.ok) throw new Error(data?.error || failureMessage)
    const savedMission = data?.mission || mission
    upsertMissionInPipeline(buildPipelineScheduleFromMission(savedMission))
    setCanvasMission(savedMission)
    return savedMission
  }

  const handleCanvasSave = async (mission: Mission): Promise<boolean> => {
    setCanvasSaving(true)
    try {
      const savedMission = await saveCanvasMission(mission, "Failed to save mission.")
      setCanvasModalOpen(false)
      toast.success(`Saved "${savedMission.label || "Untitled mission"}".`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save mission.")
      return false
    } finally {
      setCanvasSaving(false)
    }
  }

  const handleCanvasRun = async (mission: Mission) => {
    setCanvasSaving(true)
    try {
      const savedMission = await saveCanvasMission(mission, "Failed to save mission before run.")
      setCanvasModalOpen(false)
      await runMissionNow(buildPipelineScheduleFromMission(savedMission), {
        workflowSteps: missionToWorkflowSummaryForAutofix(savedMission).workflowSteps,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run mission.")
    } finally {
      setCanvasSaving(false)
    }
  }

  const handleCreateMissionInCanvas = () => {
    const now = new Date().toISOString()
    setCanvasMission({
      id: crypto.randomUUID(),
      userId: "",
      label: "New mission",
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
    })
    setCanvasModalOpen(true)
  }

  const openNewBuilder = useCallback(() => {
    resetMissionBuilder()
    setBuilderOpen(true)
  }, [resetMissionBuilder, setBuilderOpen])

  const rowActions: MissionRowActions = {
    onRunNow: (mission) => void runMissionNow(mission),
    onEdit: (mission) => void editMissionFromActions(mission),
    onOpenCanvas: (missionId) => void handleViewInCanvas(missionId),
    onDuplicate: (mission) => void duplicateMission(mission),
    onToggleEnabled: (mission) => {
      const nextEnabled = !mission.enabled
      updateLocalSchedule(mission.id, { enabled: nextEnabled })
      void saveMission({ ...mission, enabled: nextEnabled })
    },
    onDelete: (mission) => setPendingDeleteMission(mission),
  }

  const newMissionMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus />
          New mission
          <ChevronDown className="-mr-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={openNewBuilder} className="h-auto items-start py-2">
          <ListChecks className="mt-0.5" />
          <span className="flex flex-col">
            <span>Step builder</span>
            <span className="text-xs text-muted">A schedule and a list of steps</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleCreateMissionInCanvas} className="h-auto items-start py-2">
          <Network className="mt-0.5" />
          <span className="flex flex-col">
            <span>Blank canvas</span>
            <span className="text-xs text-muted">A graph with branches and agent nodes</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Missions"
        description="Automation definitions behind Advanced deployments: schedules, steps and graphs."
        actions={(
          <>
            <Button variant="secondary" asChild>
              <Link href="/missions/calendar">
                <CalendarDays />
                Calendar
              </Link>
            </Button>
            {newMissionMenu}
          </>
        )}
      />

      <MissionsMainPanels
        templates={MISSION_TEMPLATES}
        integrationsSettings={state.integrationsSettings}
        novaMissionPrompt={state.novaMissionPrompt}
        novaGeneratingMission={state.novaGeneratingMission}
        searchQuery={state.searchQuery}
        statusFilter={state.statusFilter}
        loading={loading}
        totalCount={schedules.length}
        stats={state.missionStats}
        filteredSchedules={state.filteredSchedules}
        busyById={busyById}
        runProgress={runProgress}
        missionRuntimeStatusById={state.missionRuntimeStatusById}
        missionQueueMetrics={state.missionQueueMetrics}
        formatStatusTime={state.formatStatusTime}
        actions={rowActions}
        onNovaMissionPromptChange={state.setNovaMissionPrompt}
        onSearchQueryChange={state.setSearchQuery}
        onStatusFilterChange={state.setStatusFilter}
        onApplyTemplate={(id) => void handleApplyTemplate(id)}
        onGenerateMissionDraft={() => void state.generateMissionDraftFromPrompt()}
        onCreateMission={openNewBuilder}
      />

      {runProgress ? (
        <RunProgressPanel
          runProgress={runProgress}
          onClose={() => setRunProgress(null)}
          onOpenChat={() => {
            setRunProgress(null)
            router.push("/chat")
          }}
        />
      ) : null}

      <MissionBuilderModal
        builderOpen={builderOpen}
        playClickSound={state.playClickSound}
        setBuilderOpen={setBuilderOpen}
        newLabel={state.newLabel}
        setNewLabel={state.setNewLabel}
        newDescription={state.newDescription}
        setNewDescription={state.setNewDescription}
        newPriority={state.newPriority}
        setNewPriority={state.setNewPriority}
        tagInput={state.tagInput}
        setTagInput={state.setTagInput}
        addTag={state.addTag}
        missionTags={state.missionTags}
        removeTag={state.removeTag}
        newTime={state.newTime}
        setNewTime={state.setNewTime}
        newScheduleDays={state.newScheduleDays}
        toggleScheduleDay={state.toggleScheduleDay}
        newScheduleMode={state.newScheduleMode}
        setNewScheduleMode={state.setNewScheduleMode}
        workflowSteps={state.workflowSteps}
        workflowAutofixPreview={state.workflowAutofixPreview}
        workflowAutofixSelectionById={state.workflowAutofixSelectionById}
        workflowAutofixLoading={state.workflowAutofixLoading}
        workflowAutofixApplying={state.workflowAutofixApplying}
        draggingStepId={state.draggingStepId}
        setDragOverStepId={state.setDragOverStepId}
        moveWorkflowStepByDrop={state.moveWorkflowStepByDrop}
        setDraggingStepId={state.setDraggingStepId}
        dragOverStepId={state.dragOverStepId}
        updateWorkflowStepTitle={state.updateWorkflowStepTitle}
        toggleWorkflowStepCollapsed={state.toggleWorkflowStepCollapsed}
        collapsedStepIds={state.collapsedStepIds}
        removeWorkflowStep={state.removeWorkflowStep}
        detectedTimezone={detectedTimezone}
        updateWorkflowStep={state.updateWorkflowStep}
        apiFetchIntegrationOptions={state.apiFetchIntegrationOptions}
        catalogApiById={state.catalogApiById}
        outputChannelOptions={state.outputChannelOptions}
        updateWorkflowStepAi={state.updateWorkflowStepAi}
        resolveDefaultAiIntegration={state.resolveDefaultAiIntegration}
        integrationsSettings={state.integrationsSettings}
        configuredAiIntegrationOptions={state.configuredAiIntegrationOptions}
        novaSuggestForAiStep={state.novaSuggestForAiStep}
        novaSuggestingByStepId={state.novaSuggestingByStepId}
        addWorkflowStep={state.addWorkflowStep}
        previewWorkflowFixes={state.previewWorkflowFixes}
        toggleWorkflowAutofixSelection={state.toggleWorkflowAutofixSelection}
        applyWorkflowFixes={state.applyWorkflowFixes}
        missionActive={state.missionActive}
        setMissionActive={state.setMissionActive}
        runImmediatelyOnCreate={state.runImmediatelyOnCreate}
        setRunImmediatelyOnCreate={state.setRunImmediatelyOnCreate}
        editingMissionId={state.editingMissionId}
        deployMissionFromBuilder={state.deployMissionFromBuilder}
        deployingMission={state.deployingMission}
      />

      <DeleteMissionDialog
        mission={pendingDeleteMission}
        busy={Boolean(pendingDeleteMission && busyById[pendingDeleteMission.id])}
        onCancel={() => setPendingDeleteMission(null)}
        onConfirm={() => void confirmDeleteMission()}
      />

      <MissionCanvasModal
        mission={canvasMission}
        open={canvasModalOpen}
        onClose={() => setCanvasModalOpen(false)}
        onSave={handleCanvasSave}
        onRun={handleCanvasRun}
        isSaving={canvasSaving}
      />
    </PageContainer>
  )
}

export default function MissionsPage() {
  return (
    <Suspense fallback={null}>
      <MissionsPageContent />
    </Suspense>
  )
}
