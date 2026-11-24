import type { ReactNode } from "react"
import { CircleAlert, X } from "lucide-react"

import { Badge, IconButton } from "@/components/ui"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { IntegrationIcon } from "../constants/catalog"

export type IntegrationStatus = "connected" | "disconnected" | "error"

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  if (status === "connected") return <Badge tone="success" dot>Connected</Badge>
  if (status === "error") return <Badge tone="danger" dot>Error</Badge>
  return <Badge>Not connected</Badge>
}

export interface SetupPanelHeaderProps {
  setup: IntegrationSetupKey
  title: string
  purpose: string
  status: IntegrationStatus
  /** Extra marker after the status (the "Active" badge of the selected model provider). */
  meta?: ReactNode
  /** Right-aligned actions; the primary action goes last. */
  actions?: ReactNode
  /** The last failed save / test for this integration, with what to do next. */
  error?: string | null
  onDismissError?: () => void
}

/** Compact header of the selected integration: mark, name, purpose, status and its actions. */
export function SetupPanelHeader({ setup, title, purpose, status, meta, actions, error, onDismissError }: SetupPanelHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg">
            <IntegrationIcon setup={setup} className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-md font-semibold text-fg">{title}</h2>
              <IntegrationStatusBadge status={status} />
              {meta}
            </div>
            <p className="text-sm text-muted">{purpose}</p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-muted px-3 py-2 text-sm text-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <p className="min-w-0 flex-1 leading-5">{error}</p>
          {onDismissError ? (
            <IconButton size="sm" aria-label="Dismiss error" onClick={onDismissError} className="-my-1 -mr-1.5">
              <X />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
