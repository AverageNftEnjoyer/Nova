"use client"

import { useEffect, useState, type ReactNode } from "react"

import { hydrateUiStorage } from "@/lib/settings/ui-storage/client"

// Holds the app back until the saved settings in nova.db have been pulled into browser storage, so no
// component (theme, accent, profile, ...) first renders defaults and then flips. Bounded by a timeout in
// hydrateUiStorage, so an unreachable server can only delay startup briefly, never block it.
export function UiStorageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void hydrateUiStorage().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
