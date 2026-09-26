"use client"

import { ArrowUpRight, Loader2, X } from "lucide-react"
import dynamic from "next/dynamic"
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"

import { AdvancedTaskForm } from "@/components/agents/advanced-task-form"
import { selectedSurfaceClass } from "@/lib/shared/surfaces"
import { cn } from "@/lib/shared/utils"
import { useHomeVisuals } from "@/app/home/hooks/use-home-visuals"
import { useDeploymentActions } from "../hooks/use-deployment-actions"
import { useDeploymentManager, type DeploymentNovaConnection } from "../hooks/use-deployment-manager"
import { AutomationPanel } from "./automation-panel"
import { ManagerPanel } from "./manager-panel"
import { NEW_DEPLOYMENT_TABS, type NewDeploymentTab } from "./new-deployment-tabs"

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

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface NewDeploymentModalProps {
  isLight: boolean
  nova: DeploymentNovaConnection
  initialTab?: NewDeploymentTab
  onClose: () => void
  onTabChange?: (tab: NewDeploymentTab) => void
  /** Shown in the nav on pages other than /deployments. */
  onOpenDeployments?: () => void
  onOpenGuidedBuilder: () => void
  onViewAutomations: () => void
}

/**
 * The "New deployment" popup. Opens in place over Home or /deployments, styled like the Settings modal, with
 * Simple (Describe it) and Advanced (task form, automation builder/canvas) inside it.
 */
export function NewDeploymentModal({
  isLight,
  nova,
  initialTab = "describe",
  onClose,
  onTabChange,
  onOpenDeployments,
  onOpenGuidedBuilder,
  onViewAutomations,
}: NewDeploymentModalProps) {
  const [tab, setTab] = useState<NewDeploymentTab>(initialTab)
  const [status, setStatus] = useState("")
  const manager = useDeploymentManager(nova, setStatus)
  const actions = useDeploymentActions(setStatus)
  // Home's surfaces only; popups get no cursor spotlight or glow (the page behind keeps its own).
  const { panelStyle, subPanelClass } = useHomeVisuals({ isLight })
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const canvasOpen = Boolean(actions.mission)

  const selectTab = (next: NewDeploymentTab) => {
    setTab(next)
    onTabChange?.(next)
  }

  useEffect(() => {
    if (tab === "automation") void loadMissionCanvasModal()
  }, [tab])

  // Focus moves into the dialog on open and back to whatever opened it on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const shell = dialogRef.current
    const selected = shell?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    selected?.focus()
    return () => restoreFocusRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (canvasOpen) return
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== "Tab") return
      const shell = dialogRef.current
      if (!shell) return
      const focusable = Array.from(shell.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [canvasOpen, onClose],
  )

  const activeTab = NEW_DEPLOYMENT_TABS.find((entry) => entry.id === tab) ?? NEW_DEPLOYMENT_TABS[0]
  const mutedText = isLight ? "text-s-50" : "text-slate-400"
  const dividerClass = isLight ? "border-[#e2e8f2]" : "border-white/10"

  return createPortal(
    <div style={panelStyle} className="fixed inset-0 z-[125] flex items-center justify-center p-3 sm:p-6" onKeyDown={handleKeyDown}>
      <button
        type="button"
        tabIndex={-1}
        className={cn("absolute inset-0 cursor-default backdrop-blur-sm", isLight ? "bg-[#0a122433]" : "bg-black/45")}
        onClick={onClose}
        aria-label="Close new deployment"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex h-[min(90vh,800px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border md:flex-row",
          isLight
            ? "border-[#d9e0ea] bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.3)]"
            : "border-white/20 bg-white/6 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.7)] backdrop-blur-2xl",
        )}
      >
        <nav
          aria-label="How to deploy"
          className={cn(
            "flex shrink-0 flex-col border-b md:w-60 md:border-b-0 md:border-r",
            isLight ? "border-[#e2e8f2] bg-[#f6f8fc]" : "border-white/10 bg-black/30",
          )}
        >
          <div className={cn("border-b px-4 py-4", dividerClass)}>
            <h2 id={titleId} className={cn("text-lg font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>
              New deployment
            </h2>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-40" : "text-slate-400")}>Hand Nova an outcome to deliver</p>
          </div>

          <div role="tablist" aria-orientation="vertical" className="no-scrollbar flex gap-1.5 overflow-x-auto p-2.5 md:flex-1 md:flex-col md:overflow-y-auto">
            {NEW_DEPLOYMENT_TABS.map(({ id, label, icon: Icon, hint }) => {
              const selected = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(id)}
                  className={cn(
                    "flex shrink-0 items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors md:w-full home-spotlight-card home-border-glow",
                    selected
                      ? selectedSurfaceClass(isLight)
                      : isLight
                        ? "border-transparent text-s-50 hover:text-s-80"
                        : "border-transparent text-slate-400 hover:text-slate-200",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", selected && "text-accent")} />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-sm">{label}</span>
                    <span className={cn("hidden text-[11px] leading-4 md:block", selected ? mutedText : "opacity-80")}>{hint}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {onOpenDeployments ? (
            <div className={cn("hidden border-t p-3 md:block", dividerClass)}>
              <button
                type="button"
                onClick={onOpenDeployments}
                className={cn(
                  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors hover:text-accent",
                  mutedText,
                )}
              >
                All deployments and runs
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-6", dividerClass, isLight ? "bg-[#f9fbff]" : "bg-black/20")}>
            <h3 className={cn("text-sm font-medium uppercase tracking-wider", mutedText)}>{activeTab.label}</h3>
            <div className="flex min-w-0 items-center gap-3">
              {status ? (
                <p role="status" className={cn("min-w-0 truncate text-xs font-medium", isLight ? "text-emerald-700" : "text-emerald-300")}>
                  {status}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors home-spotlight-card home-border-glow",
                  isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/12 bg-black/20 text-slate-300",
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div role="tabpanel" aria-label={activeTab.label} className="min-h-0 flex-1 p-4 sm:p-6">
            {tab === "describe" ? (
              <ManagerPanel isLight={isLight} subPanelClass={subPanelClass} manager={manager} />
            ) : tab === "task" ? (
              <AdvancedTaskForm isLight={isLight} onCreate={actions.createTask} />
            ) : (
              <AutomationPanel
                isLight={isLight}
                subPanelClass={subPanelClass}
                onOpenBuilder={onOpenGuidedBuilder}
                onOpenCanvas={actions.openCanvas}
                onViewAutomations={onViewAutomations}
              />
            )}
          </div>
        </div>
      </div>

      {actions.mission ? (
        <MissionCanvasModal
          mission={actions.mission}
          open
          onClose={actions.closeCanvas}
          onSave={actions.saveMissionDraft}
          onRun={actions.runMission}
          isSaving={actions.missionBusy}
        />
      ) : null}
    </div>,
    document.body,
  )
}
