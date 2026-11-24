"use client"

import { Button, Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui"
import type { MissionListItem } from "../types"

interface DeleteMissionDialogProps {
  mission: MissionListItem | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteMissionDialog({ mission, busy, onCancel, onConfirm }: DeleteMissionDialogProps) {
  return (
    <Dialog open={Boolean(mission)} onOpenChange={(open) => { if (!open) onCancel() }} size="sm">
      <DialogHeader>
        <DialogTitle>Delete mission</DialogTitle>
        <DialogDescription>
          This permanently deletes <span className="font-medium text-fg">{mission?.label || "Untitled mission"}</span>.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted">Scheduled runs for this mission stop immediately.</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={busy} data-autofocus>
          Delete mission
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
