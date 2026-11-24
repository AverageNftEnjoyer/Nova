"use client"

import { Copy, MoreHorizontal, Network, Pause, Pencil, Play, Trash2 } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@/components/ui"
import type { MissionListItem } from "../types"

interface MissionActionMenuProps {
  mission: MissionListItem
  busy: boolean
  onRunNow: () => void
  onEdit: () => void
  onOpenCanvas: () => void
  onDuplicate: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}

/** Row actions for one mission (run, edit, canvas, duplicate, pause/activate, delete). */
export function MissionActionMenu({
  mission,
  busy,
  onRunNow,
  onEdit,
  onOpenCanvas,
  onDuplicate,
  onToggleEnabled,
  onDelete,
}: MissionActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={`Actions for ${mission.label || "mission"}`} size="sm">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onRunNow} disabled={busy}>
          <Play />
          Run now
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit in builder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenCanvas}>
          <Network />
          Open canvas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleEnabled} disabled={busy}>
          {mission.enabled ? <Pause /> : <Play />}
          {mission.enabled ? "Pause" : "Activate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={busy}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
