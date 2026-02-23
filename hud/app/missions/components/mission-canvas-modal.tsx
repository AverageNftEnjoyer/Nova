"use client"

import { useCallback, useState } from "react"
import { X } from "lucide-react"
import type { Mission } from "@/lib/missions/types"
import { fetchMissionVersions, restoreMissionVersion, type MissionVersionRecord } from "../api"
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
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<MissionVersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoreLoadingById, setRestoreLoadingById] = useState<Record<string, boolean>>({})
  const [restoreReason, setRestoreReason] = useState("")
  const [versionsStatus, setVersionsStatus] = useState<string | null>(null)

  const loadVersions = useCallback(async () => {
    if (!mission) return
    setVersionsLoading(true)
    try {
      const response = await fetchMissionVersions({ missionId: mission.id, limit: 80 })
      const data = response.data
      if (!response.ok) throw new Error(data?.error || "Failed to load versions.")
      setVersions(Array.isArray(data?.versions) ? data.versions : [])
      setVersionsStatus(null)
    } catch (error) {
      setVersionsStatus(error instanceof Error ? error.message : "Failed to load versions.")
    } finally {
      setVersionsLoading(false)
    }
  }, [mission])

  const handleRun = useCallback(async () => {
    if (!mission || !onRun) return
    setIsRunning(true)
    setTraceStatuses({})
    try {
      await onRun(mission)
    } finally {
      setIsRunning(false)
    }
  }, [mission, onRun])

  const handleRestore = useCallback(async (versionId: string) => {
    if (!mission) return
    const key = String(versionId || "").trim()
    if (!key) return
    setRestoreLoadingById((prev) => ({ ...prev, [key]: true }))
    try {
      const response = await restoreMissionVersion({
        missionId: mission.id,
        versionId: key,
        reason: restoreReason.trim() || undefined,
      })
      const data = response.data
      if (!response.ok || !data?.mission) throw new Error(data?.error || "Restore failed.")
      await onSave(data.mission as Mission)
      await loadVersions()
      setVersionsStatus("Restore completed and saved.")
    } catch (error) {
      setVersionsStatus(error instanceof Error ? error.message : "Restore failed.")
    } finally {
      setRestoreLoadingById((prev) => ({ ...prev, [key]: false }))
    }
  }, [loadVersions, mission, onSave, restoreReason])

  if (!open || !mission) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-zinc-950/90 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-lg border border-white/10 bg-zinc-900/80 p-2 text-white/50 shadow-lg transition-colors hover:bg-zinc-800 hover:text-white/80"
        aria-label="Close canvas"
      >
        <X className="h-4 w-4" />
      </button>
      <button
        onClick={() => {
          const next = !versionsOpen
          setVersionsOpen(next)
          if (next) {
            void loadVersions()
          }
        }}
        className="absolute right-16 top-4 z-10 rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-white/60 shadow-lg transition-colors hover:bg-zinc-800 hover:text-white/90"
      >
        Versions
      </button>

      {/* Full-screen canvas */}
      <div className="h-full w-full">
        <MissionCanvas
          mission={mission}
          onSave={onSave}
          onRun={handleRun}
          traceStatuses={traceStatuses}
          isSaving={isSaving}
          isRunning={isRunning}
        />
      </div>
      {versionsOpen && (
        <aside className="absolute right-4 top-16 z-20 w-[360px] max-h-[80vh] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
          <div className="border-b border-white/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">Mission Versions</p>
            <p className="mt-1 text-[11px] text-white/50">Immutable snapshots with restore + mandatory backup.</p>
          </div>
          <div className="border-b border-white/10 px-3 py-2">
            <label className="block text-[11px] text-white/60">Restore reason (optional)</label>
            <input
              value={restoreReason}
              onChange={(event) => setRestoreReason(event.target.value)}
              placeholder="Reason for restore"
              className="mt-1 h-8 w-full rounded-md border border-white/15 bg-black/25 px-2 text-xs text-white/85 outline-none"
            />
            {versionsStatus && <p className="mt-1 text-[11px] text-white/55">{versionsStatus}</p>}
          </div>
          <div className="max-h-[56vh] overflow-y-auto p-2 space-y-1.5">
            {versionsLoading && <div className="rounded-md border border-white/10 bg-black/20 px-2 py-2 text-xs text-white/60">Loading versions...</div>}
            {!versionsLoading && versions.length === 0 && <div className="rounded-md border border-white/10 bg-black/20 px-2 py-2 text-xs text-white/60">No versions recorded yet.</div>}
            {versions.map((version) => (
              <div key={version.versionId} className="rounded-md border border-white/10 bg-black/25 px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-white/85">{version.eventType}</p>
                  <p className="text-[10px] text-white/50">v{version.sourceMissionVersion}</p>
                </div>
                <p className="mt-1 text-[10px] text-white/55">{new Date(version.ts).toLocaleString()}</p>
                {version.reason && <p className="mt-1 text-[10px] text-white/50">{version.reason}</p>}
                <div className="mt-2">
                  <button
                    onClick={() => {
                      void handleRestore(version.versionId)
                    }}
                    disabled={Boolean(restoreLoadingById[version.versionId])}
                    className="h-7 rounded-md border border-cyan-400/35 bg-cyan-500/10 px-2.5 text-xs font-medium text-cyan-300 disabled:opacity-50"
                  >
                    {restoreLoadingById[version.versionId] ? "Restoring..." : "Restore"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
