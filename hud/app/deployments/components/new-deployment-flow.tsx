"use client"

import { Loader2 } from "lucide-react"
import dynamic from "next/dynamic"
import { useCallback, useEffect } from "react"
import { createPortal } from "react-dom"

import { AdvancedTaskForm } from "@/components/agents/advanced-task-form"
import { useDeploymentActions } from "../hooks/use-deployment-actions"
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
    <div className="fixed inset-0 z-[130] grid place-items-center bg-zinc-950/90 backdrop-blur-sm">
      <Loader2 className="h-6 w-6 animate-spin text-slate-300" aria-label="Loading automation canvas" />
    </div>
  ),
})

export interface NewDeploymentFlowProps {
  isLight: boolean
  nova: DeploymentNovaConnection
  tab: NewDeploymentTab
  /** "holo" skins the task form's pickers for the Depot hologram. */
  variant?: "modal" | "holo"
  subPanelClass: string
  /** Status line from the creation hooks ("Task queued.", errors from the canvas). */
  onStatus: (message: string) => void
  /** A task or automation was launched (a run exists now). */
  onLaunched?: (message: string) => void
  /** The fullscreen automation canvas opened or closed (hosts must not treat Escape as their own then). */
  onCanvasOpenChange?: (open: boolean) => void
  onOpenGuidedBuilder: () => void
  onViewAutomations: () => void
  /** Extra classes on the canvas portal root (Home passes its pixel skin). */
  canvasClassName?: string
}

const LAUNCH_MESSAGES = new Set(["Task queued.", "Automation queued.", "Automation deployed."])

/**
 * The body of "New deployment": Describe (manager), One-off task (advanced form) or Automation, with the fullscreen
 * canvas. The single implementation of the behaviour, hosted by the popup (new-deployment-modal.tsx) and by the Depot's
 * hologram screen (home/components/rooms/room-new-deployment.tsx), which each draw their own tab chrome.
 */
export function NewDeploymentFlow({
  isLight,
  nova,
  tab,
  variant = "modal",
  subPanelClass,
  onStatus,
  onLaunched,
  onCanvasOpenChange,
  onOpenGuidedBuilder,
  onViewAutomations,
  canvasClassName,
}: NewDeploymentFlowProps) {
  const handleStatus = useCallback(
    (message: string) => {
      onStatus(message)
      if (onLaunched && LAUNCH_MESSAGES.has(message)) onLaunched(message)
    },
    [onStatus, onLaunched],
  )
  const manager = useDeploymentManager(nova, handleStatus)
  const actions = useDeploymentActions(handleStatus)
  const canvasOpen = Boolean(actions.mission)

  useEffect(() => {
    if (tab === "automation") void loadMissionCanvasModal()
  }, [tab])

  useEffect(() => {
    onCanvasOpenChange?.(canvasOpen)
  }, [canvasOpen, onCanvasOpenChange])

  const canvas = actions.mission ? (
    <MissionCanvasModal
      mission={actions.mission}
      open
      onClose={actions.closeCanvas}
      onSave={actions.saveMissionDraft}
      onRun={actions.runMission}
      isSaving={actions.missionBusy}
    />
  ) : null

  return (
    <>
      {tab === "describe" ? (
        <ManagerPanel isLight={isLight} subPanelClass={subPanelClass} manager={manager} />
      ) : tab === "task" ? (
        <AdvancedTaskForm isLight={isLight} onCreate={actions.createTask} tone={variant === "holo" ? "holo" : "default"} />
      ) : (
        <AutomationPanel
          isLight={isLight}
          subPanelClass={subPanelClass}
          onOpenBuilder={onOpenGuidedBuilder}
          onOpenCanvas={actions.openCanvas}
          onViewAutomations={onViewAutomations}
        />
      )}
      {/* The canvas is a fullscreen tool: portaled to the body so no host (clipped hologram, popup) can crop it. */}
      {canvas && typeof document !== "undefined" ? createPortal(<div className={canvasClassName}>{canvas}</div>, document.body) : null}
    </>
  )
}
