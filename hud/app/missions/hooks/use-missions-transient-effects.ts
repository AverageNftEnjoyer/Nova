"use client"

import { useEffect } from "react"
import type { Dispatch, RefObject, SetStateAction } from "react"

import type { MissionActionMenuState, MissionRunProgress, MissionStatusMessage } from "../types"

interface UseMissionActionMenuDismissInput {
  missionActionMenu: MissionActionMenuState | null
  missionActionMenuRef: RefObject<HTMLDivElement | null>
  setMissionActionMenu: Dispatch<SetStateAction<MissionActionMenuState | null>>
}

export function useAutoClearStatus(
  status: MissionStatusMessage,
  setStatus: Dispatch<SetStateAction<MissionStatusMessage>>,
  timeoutMs = 3000,
) {
  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => {
      setStatus(null)
    }, timeoutMs)
    return () => window.clearTimeout(timer)
  }, [setStatus, status, timeoutMs])
}

export function useMissionActionMenuDismiss({
  missionActionMenu,
  missionActionMenuRef,
  setMissionActionMenu,
}: UseMissionActionMenuDismissInput) {
  useEffect(() => {
    if (!missionActionMenu) return

    const closeMenu = () => setMissionActionMenu(null)
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (missionActionMenuRef.current?.contains(target)) return
      closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onEscape)
    window.addEventListener("resize", closeMenu)
    window.addEventListener("scroll", closeMenu, true)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onEscape)
      window.removeEventListener("resize", closeMenu)
      window.removeEventListener("scroll", closeMenu, true)
    }
  }, [missionActionMenu, missionActionMenuRef, setMissionActionMenu])
}

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
