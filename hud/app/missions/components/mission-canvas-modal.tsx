"use client"

import { useCallback, useEffect, useState } from "react"
import type { Mission } from "@/lib/missions/types"
import { MissionCanvas } from "../canvas/mission-canvas"
import { fetchMissionVersions, restoreMissionVersion, type MissionVersionRecord } from "../api"

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
  const [draftMission, setDraftMission] = useState<Mission | null>(mission)
  const [isRunning, setIsRunning] = useState(false)
  const [traceStatuses, setTraceStatuses] = useState<Record<string, "running" | "completed" | "failed">>({})
  const [versions, setVersions] = useState<MissionVersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState("")
  const [restoreReason, setRestoreReason] = useState("")
  const [restoringVersionId, setRestoringVersionId] = useState("")
  const [versionStatus, setVersionStatus] = useState("")

  useEffect(() => {
    setDraftMission(mission)
  }, [mission])

  const loadVersions = useCallback(async () => {
    if (!open || !draftMission?.id) return
    setVersionsLoading(true)
    setVersionsError("")
    try {
      const response = await fetchMissionVersions({ missionId: draftMission.id, limit: 20 })
      const data = response.data
      if (!response.ok || !data?.ok || !Array.isArray(data.versions)) {
        throw new Error(data?.error || "Failed to load mission versions.")
      }
      setVersions(data.versions)
    } catch (error) {
      setVersionsError(error instanceof Error ? error.message : "Failed to load mission versions.")
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }, [draftMission?.id, open])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

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

  const handleSave = useCallback(async (nextMission: Mission) => {
    setDraftMission(nextMission)
    return onSave(nextMission)
  }, [onSave])

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!draftMission?.id || !versionId) return
    setRestoringVersionId(versionId)
    setVersionStatus("")
    setVersionsError("")
    try {
      const response = await restoreMissionVersion({
        missionId: draftMission.id,
        versionId,
        reason: restoreReason.trim() || undefined,
      })
      const data = response.data
      if (!response.ok || !data?.ok || !data?.mission || typeof data.mission !== "object") {
        throw new Error(data?.error || "Failed to restore mission version.")
      }
      setDraftMission(data.mission as Mission)
      setTraceStatuses({})
      setVersionStatus(`Restored version ${versionId}.`)
      await loadVersions()
    } catch (error) {
      setVersionsError(error instanceof Error ? error.message : "Failed to restore mission version.")
    } finally {
      setRestoringVersionId("")
    }
  }, [draftMission?.id, loadVersions, restoreReason])

  if (!open || !draftMission) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-zinc-950/90 backdrop-blur-sm">
      <div className="h-full w-full">
        <div className="pointer-events-auto absolute right-4 top-4 z-60 w-80 rounded-xl border border-white/15 bg-black/70 p-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Mission Versions</h3>
            <button
              type="button"
              onClick={() => {
                void loadVersions()
              }}
              disabled={versionsLoading}
              className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/85 hover:bg-white/10 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
          <label className="mb-1 block text-[11px] font-medium text-white/70">Restore reason</label>
          <input
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            placeholder="Optional change note"
            className="mb-2 w-full rounded border border-white/20 bg-black/35 px-2 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-white/35 focus:outline-none"
          />
          {versionStatus ? <div className="mb-2 rounded border border-emerald-400/30 bg-emerald-500/12 px-2 py-1 text-[11px] text-emerald-200">{versionStatus}</div> : null}
          {versionsError ? <div className="mb-2 rounded border border-rose-400/35 bg-rose-500/12 px-2 py-1 text-[11px] text-rose-200">{versionsError}</div> : null}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {versionsLoading ? <div className="text-[11px] text-white/60">Loading versions...</div> : null}
            {!versionsLoading && versions.length === 0 ? <div className="text-[11px] text-white/60">No versions found.</div> : null}
            {versions.map((entry) => (
              <div key={entry.versionId} className="rounded border border-white/12 bg-black/25 px-2 py-1.5">
                <div className="text-[11px] font-medium text-white/90">{new Date(entry.ts).toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-white/55">
                  {entry.eventType} | source v{entry.sourceMissionVersion}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleRestoreVersion(entry.versionId)
                  }}
                  disabled={Boolean(restoringVersionId)}
                  className="mt-1 rounded border border-cyan-300/35 bg-cyan-500/14 px-2 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/22 disabled:opacity-60"
                >
                  {restoringVersionId === entry.versionId ? "Restoring..." : "Restore"}
                </button>
              </div>
            ))}
          </div>
        </div>
        <MissionCanvas
          mission={draftMission}
          onSave={handleSave}
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
