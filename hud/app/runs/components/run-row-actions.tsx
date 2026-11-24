"use client"

import { Pause, Play, Square } from "lucide-react"

import { Button, IconButton, Tooltip } from "@/components/ui"
import { RUN_ACTION_LABEL, availableActions, canRaiseBudget, type RunActionKind } from "../hooks/use-run-actions"
import type { RunRow } from "../lib/run-rows"

interface RunRowActionsProps {
  row: RunRow
  busy: boolean
  onAction: (row: RunRow, action: RunActionKind) => void
  /** Opens the run with its raise-budget form. */
  onRaiseBudget: (row: RunRow) => void
}

const ICON_ACTIONS: Partial<Record<RunActionKind, typeof Pause>> = { pause: Pause, resume: Play, cancel: Square }

/**
 * Inline actions for a table row: decisions as text buttons (they need a clear label), run controls as icon buttons.
 * Finished runs show nothing here; their actions live in the run sheet.
 */
export function RunRowActions({ row, busy, onAction, onRaiseBudget }: RunRowActionsProps) {
  const actions = availableActions(row).filter((action) => action !== "rerun" && action !== "retry" && action !== "delete")
  const decisions = actions.filter((action) => !ICON_ACTIONS[action])
  const controls = actions.filter((action) => ICON_ACTIONS[action])
  const showRaise = row.phase === "budget" && canRaiseBudget(row)
  if (actions.length === 0 && !showRaise) return null

  return (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      {decisions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "approve" || action === "approve-tool" ? "primary" : "ghost"}
          disabled={busy}
          loading={busy && (action === "approve" || action === "approve-tool")}
          onClick={() => onAction(row, action)}
        >
          {RUN_ACTION_LABEL[action]}
        </Button>
      ))}
      {showRaise ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRaiseBudget(row)}>
          Raise budget
        </Button>
      ) : null}
      {controls.map((action) => {
        const Icon = ICON_ACTIONS[action] as typeof Pause
        const label = action === "cancel" ? "Cancel run" : action === "pause" ? "Pause run" : "Resume run"
        return (
          <Tooltip key={action} content={label}>
            <IconButton aria-label={label} size="sm" disabled={busy} onClick={() => onAction(row, action)}>
              <Icon />
            </IconButton>
          </Tooltip>
        )
      })}
    </div>
  )
}
