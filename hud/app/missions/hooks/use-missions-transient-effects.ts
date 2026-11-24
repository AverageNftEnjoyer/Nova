"use client"

import { useEffect } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { MissionRunProgress } from "../types"

/** Hides a finished run trace after `timeoutMs` unless a newer run replaced it. */
export function useAutoDismissRunProgress(
  runProgress: MissionRunProgress | null,
  setRunProgress: Dispatch<SetStateAction<MissionRunProgress | null>>,
  timeoutMs = 30000,
) {
  useEffect(() => {
    if (!runProgress || runProgress.running) return
    const timer = window.setTimeout(() => {
      setRunProgress((prev) => {
        if (!prev) return null
        if (prev.running) return prev
        if (prev.missionId !== runProgress.missionId) return prev
        return null
      })
    }, timeoutMs)
    return () => window.clearTimeout(timer)
  }, [runProgress, setRunProgress, timeoutMs])
}
