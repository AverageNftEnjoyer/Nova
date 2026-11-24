"use client"

import { StatusDot, Tooltip, type StatusTone } from "@/components/ui"
import { useRuntimeConnection, type RuntimeConnection } from "@/components/shell/use-runtime-connection"
import { cn } from "@/lib/shared/utils"

const COPY: Record<RuntimeConnection, { label: string; tone: StatusTone; explain: string }> = {
  connecting: {
    label: "Connecting",
    tone: "idle",
    explain: "Starting the link to the Nova runtime that runs chats and agent tasks.",
  },
  connected: {
    label: "Connected",
    tone: "success",
    explain: "The Nova runtime is running. Chat, voice and agent tasks are available.",
  },
  reconnecting: {
    label: "Reconnecting",
    tone: "warning",
    explain: "Lost the link to the Nova runtime. Retrying on its own; replies pause until it is back.",
  },
  offline: {
    label: "Runtime offline",
    tone: "danger",
    explain: "Can't reach the Nova runtime, so chat and agent tasks can't run. Restart Nova, then click here to retry.",
  },
}

/** Top bar indicator for the runtime WebSocket. Clicking it retries right away. */
export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const { status, retry } = useRuntimeConnection()
  const copy = COPY[status]
  return (
    <Tooltip content={copy.explain} side="bottom" align="end" delay={250}>
      <button
        type="button"
        onClick={retry}
        aria-label={`Runtime: ${copy.label}. ${copy.explain}`}
        className={cn(
          "flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted transition-colors duration-150 ease-out hover:bg-hover hover:text-fg",
          status === "offline" && "text-danger hover:text-danger",
        )}
      >
        <StatusDot tone={copy.tone} size="sm" />
        {compact ? null : <span className="whitespace-nowrap">{copy.label}</span>}
      </button>
    </Tooltip>
  )
}
