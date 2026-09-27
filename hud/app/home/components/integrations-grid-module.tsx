"use client"

import type { ReactNode } from "react"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { cn } from "@/lib/shared/utils"

export interface IntegrationNode {
  icon: ReactNode
  connected: boolean
  label: string
  setup: IntegrationSetupKey
}

interface IntegrationsGridModuleProps {
  isLight: boolean
  subPanelClass: string
  nodes: readonly IntegrationNode[]
  onOpen: (setup: IntegrationSetupKey) => void
}

/** Every integration with its connection state; each tile opens that integration's setup. */
export function IntegrationsGridModule({ isLight, subPanelClass, nodes, onOpen }: IntegrationsGridModuleProps) {
  const connectedCount = nodes.filter((node) => node.connected).length
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p className={cn("shrink-0 text-[13px]", isLight ? "text-s-60" : "text-slate-400")}>
        {connectedCount} of {nodes.length} connected
      </p>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-3 gap-2 overflow-y-auto">
        {nodes.map(({ icon, connected, label, setup }) => (
          <button
            key={label}
            type="button"
            onClick={() => onOpen(setup)}
            className={cn(
              "flex min-h-12 items-center gap-2 border px-2.5 transition-colors home-spotlight-card--hover",
              subPanelClass,
              connected ? "" : "opacity-60 hover:opacity-100",
            )}
            aria-label={`${label}: ${connected ? "connected" : "not connected"}`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>
            <span className="min-w-0 flex-1 truncate text-left text-[13px]">{label}</span>
            <span className={cn("h-2 w-2 shrink-0", connected ? "bg-emerald-400" : isLight ? "bg-slate-400" : "bg-slate-600")} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
