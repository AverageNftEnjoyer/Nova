"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { History, RefreshCw } from "lucide-react"

import { Button, EmptyState, Field, Input, Portal, Sheet, SkeletonRows, useModalBehavior } from "@/components/ui"
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

// Escape does not close the canvas: unsaved graph edits would be lost. The header's back button closes it.
const ignoreEscape = () => {}

/** Full-screen mission canvas (used by /missions and Advanced deployments), with version history in a side sheet. */
export function MissionCanvasModal({ mission, open, onClose, onSave, onRun, isSaving }: MissionCanvasModalProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [draftMission, setDraftMission] = useState<Mission | null>(mission)
  const [isRunning, setIsRunning] = useState(false)
  const [traceStatuses, setTraceStatuses] = useState<Record<string, "running" | "completed" | "failed">>({})
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<MissionVersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState("")
  const [restoreReason, setRestoreReason] = useState("")
  const [restoringVersionId, setRestoringVersionId] = useState("")
  const [versionStatus, setVersionStatus] = useState("")
  // Bumped on restore so the canvas remounts with the restored graph (it reads nodes once per mount).
  const [restoreCount, setRestoreCount] = useState(0)

  useModalBehavior(open && Boolean(draftMission), rootRef, ignoreEscape)

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

  const handleRun = useCallback(async (next: Mission) => {
    if (!onRun) return
    setIsRunning(true)
    setTraceStatuses({})
    try {
      await onRun(next)
    } finally {
      setIsRunning(false)
    }
  }, [onRun])

  const handleSave = useCallback(async (next: Mission) => {
    setDraftMission(next)
    return onSave(next)
  }, [onSave])

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!draftMission?.id || !versionId) return
    setRestoringVersionId(versionId)
    setVersionStatus("")
    setVersionsError("")
    try {
      const response = await restoreMissionVersion({ missionId: draftMission.id, versionId, reason: restoreReason.trim() || undefined })
      const data = response.data
      if (!response.ok || !data?.ok || !data?.mission || typeof data.mission !== "object") {
        throw new Error(data?.error || "Failed to restore mission version.")
      }
      setDraftMission(data.mission as Mission)
      setRestoreCount((count) => count + 1)
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
    <Portal>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Mission canvas: ${draftMission.label || "Untitled mission"}`}
        tabIndex={-1}
        className="fixed inset-0 z-140 flex bg-canvas animate-overlay-in focus-visible:outline-none"
      >
        <MissionCanvas
          key={`${draftMission.id}-${restoreCount}`}
          mission={draftMission}
          onSave={handleSave}
          onRun={onRun ? handleRun : undefined}
          onExit={onClose}
          traceStatuses={traceStatuses}
          isSaving={isSaving}
          isRunning={isRunning}
          headerActions={(
            <Button variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>
              <History />
              Versions
              {versions.length > 0 ? <span className="font-mono text-2xs text-faint tabular-nums">{versions.length}</span> : null}
            </Button>
          )}
        />
      </div>

      <Sheet
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        title="Version history"
        description="Restoring a version replaces the canvas with that saved graph."
        size="sm"
        actions={(
          <Button variant="ghost" size="sm" onClick={() => void loadVersions()} loading={versionsLoading}>
            <RefreshCw />
            Refresh
          </Button>
        )}
      >
        <div className="flex flex-col gap-4">
          <Field label="Restore note" hint="Optional. Saved with the restored version.">
            <Input value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="Why you are restoring" />
          </Field>
          {versionStatus ? <p className="rounded-md bg-success-muted px-3 py-2 text-xs text-success">{versionStatus}</p> : null}
          {versionsError ? <p className="rounded-md bg-danger-muted px-3 py-2 text-xs text-danger">{versionsError}</p> : null}
          {versionsLoading && versions.length === 0 ? (
            <SkeletonRows rows={4} />
          ) : versions.length === 0 ? (
            <EmptyState size="compact" title="No versions yet" description="A version is recorded each time this mission is saved." />
          ) : (
            <ul className="divide-y divide-border-subtle rounded-md border border-border">
              {versions.map((entry) => (
                <li key={entry.versionId} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-fg tabular-nums">{new Date(entry.ts).toLocaleString()}</p>
                    <p className="truncate text-2xs text-muted">
                      {entry.eventType}, from v{entry.sourceMissionVersion}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRestoreVersion(entry.versionId)}
                    loading={restoringVersionId === entry.versionId}
                    disabled={Boolean(restoringVersionId) && restoringVersionId !== entry.versionId}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </Portal>
  )
}
