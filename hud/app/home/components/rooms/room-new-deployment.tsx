"use client"

import { useState } from "react"

import { NEW_DEPLOYMENT_TABS, type NewDeploymentTab } from "@/app/deployments/components/new-deployment-tabs"
import { LazyNewDeploymentFlow } from "@/app/deployments/components/new-deployment-flow-lazy"
import type { DeploymentNovaConnection } from "@/app/deployments/hooks/use-deployment-manager"

interface RoomNewDeploymentProps {
  isLight: boolean
  nova: DeploymentNovaConnection
  /** A run now exists (the room switches to Runs and shows the message). */
  onLaunched: (message: string) => void
  onOpenGuidedBuilder: () => void
  onViewAutomations: () => void
}

/**
 * The Depot's creation view, drawn on the hologram screen (or the window panel): the same flow as the New deployment
 * popup (deployments/components/new-deployment-flow.tsx), under hologram tabs. Skin: ".holo-new*" / ".holo-flow" in pixel-ui.css.
 */
export function RoomNewDeployment({ isLight, nova, onLaunched, onOpenGuidedBuilder, onViewAutomations }: RoomNewDeploymentProps) {
  const [tab, setTab] = useState<NewDeploymentTab>("describe")
  const [status, setStatus] = useState("")
  const [canvasOpen, setCanvasOpen] = useState(false)

  return (
    <div className="holo-new" data-escape-owner={canvasOpen ? "canvas" : undefined}>
      <div className="holo-new-bar">
        <div role="tablist" aria-label="How to deploy" className="holo-subtabs">
          {NEW_DEPLOYMENT_TABS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="holo-tab" data-active={tab === id ? "true" : undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {status ? (
        <p role="status" className="holo-new-status">
          {status}
        </p>
      ) : null}
      <div className="holo-flow" role="tabpanel" aria-label={NEW_DEPLOYMENT_TABS.find((entry) => entry.id === tab)?.label}>
        <LazyNewDeploymentFlow
          isLight={isLight}
          nova={nova}
          tab={tab}
          variant="holo"
          subPanelClass="holo-subpanel"
          onStatus={setStatus}
          onLaunched={onLaunched}
          onCanvasOpenChange={setCanvasOpen}
          onOpenGuidedBuilder={onOpenGuidedBuilder}
          onViewAutomations={onViewAutomations}
          canvasClassName="pixel-ui"
        />
      </div>
    </div>
  )
}
