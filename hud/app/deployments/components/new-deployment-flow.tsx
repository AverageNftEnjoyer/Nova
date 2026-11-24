"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect } from "react"
import { createPortal } from "react-dom"

import { Spinner } from "@/components/ui"
import { AdvancedTaskForm } from "@/components/agents/advanced-task-form"
import { useDeploymentActions, type DeploymentLaunch } from "../hooks/use-deployment-actions"
import { useDeploymentManager, type DeploymentNovaConnection } from "../hooks/use-deployment-manager"
import { AutomationPanel } from "./automation-panel"
import { ManagerPanel } from "./manager-panel"
import type { NewDeploymentTab } from "./new-deployment-tabs"

// The canvas pulls in ReactFlow, the node catalog and graph validation: its own chunk, preloaded when the
// Automation tab is shown so opening it stays instant.
const loadMissionCanvasModal = () =>
  import("@/app/missions/components/mission-canvas-modal").then((module) => module.MissionCanvasModal)
const MissionCanvasModal = dynamic(loadMissionCanvasModal, {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-130 grid place-items-center bg-scrim">
      <Spinner aria-label="Loading automation canvas" />
    </div>
  ),
})

export interface NewDeploymentFlowProps {
  nova: DeploymentNovaConnection
  tab: NewDeploymentTab
  /** Prefills the Describe box (never submitted on its own). */
  initialPrompt?: string
  /** Status line from the creation hooks (draft saved, canvas errors). */
  onStatus: (message: string) => void
  /** A task or automation was launched: a run exists now. */
  onLaunched?: (message: string, launch: DeploymentLaunch) => void
  /** The fullscreen automation canvas opened or closed (hosts must not treat Escape as their own then). */
  onCanvasOpenChange?: (open: boolean) => void
  /** Where the guided Mission builder opens. */
  builderHref: string
}

/** The body of "New deployment": Describe (Simple), One-off task or Automation (Advanced), with the fullscreen canvas. */
export function NewDeploymentFlow({ nova, tab, initialPrompt = "", onStatus, onLaunched, onCanvasOpenChange, builderHref }: NewDeploymentFlowProps) {
  const handleLaunched = useCallback(
    (message: string, launch: DeploymentLaunch) => {
      onStatus("")
      onLaunched?.(message, launch)
    },
    [onLaunched, onStatus],
  )
  const manager = useDeploymentManager(nova, { onLaunched: handleLaunched }, initialPrompt)
  const actions = useDeploymentActions({ onStatus, onLaunched: handleLaunched })
  const canvasOpen = Boolean(actions.mission)

  useEffect(() => {
    if (tab === "automation") void loadMissionCanvasModal()
  }, [tab])

  useEffect(() => {
    onCanvasOpenChange?.(canvasOpen)
  }, [canvasOpen, onCanvasOpenChange])

  return (
    <>
      {tab === "describe" ? (
        <ManagerPanel manager={manager} />
      ) : tab === "task" ? (
        <AdvancedTaskForm onCreate={actions.createTask} />
      ) : (
        <AutomationPanel builderHref={builderHref} onOpenCanvas={actions.openCanvas} />
      )}
      {/* The canvas is a fullscreen tool: portaled to the body so no host can crop it. */}
      {actions.mission && typeof document !== "undefined"
        ? createPortal(
            <MissionCanvasModal
              mission={actions.mission}
              open
              onClose={actions.closeCanvas}
              onSave={actions.saveMissionDraft}
              onRun={actions.runMission}
              isSaving={actions.missionBusy}
            />,
            document.body,
          )
        : null}
    </>
  )
}
