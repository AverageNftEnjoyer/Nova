"use client"

import { useCallback, useState } from "react"
import type { Mission } from "@/lib/missions/types"
import { MissionCanvas } from "../canvas/mission-canvas"

interface MissionCanvasModalProps {
  mission: Mission | null
  open: boolean
  onClose: () => void
  onSave: (mission: Mission) => void | boolean | Promise<void | boolean>
  onRun?: (mission: Mission) => void | Promise<void>
  isSaving?: boolean
}

export function MissionCanvasModal({
  mission,
  open,
  onClose,
  onSave,
  onRun,
  isSaving,
}: MissionCanvasModalProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [traceStatuses, setTraceStatuses] = useState<Record<string, "running" | "completed" | "failed">>({})

  const handleRun = useCallback(async (draftMission: Mission) => {
    if (!onRun) return
    setIsRunning(true)
    setTraceStatuses({})
    try {
      await onRun(draftMission)
    } finally {
      setIsRunning(false)
    }
  }, [onRun])

  if (!open || !mission) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-zinc-950/90 backdrop-blur-sm">
      <div className="h-full w-full">
        <MissionCanvas
          mission={mission}
          onSave={onSave}
          onRun={handleRun}
          onExit={onClose}
          traceStatuses={traceStatuses}
          isSaving={isSaving}
          isRunning={isRunning}
        />
      </div>
    </div>
  )
}
