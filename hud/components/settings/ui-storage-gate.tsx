"use client"

import { useEffect, useState, type ReactNode } from "react"

import { hydrateUiStorage } from "@/lib/settings/ui-storage/client"

/** Under this, startup shows a blank canvas; only a slower start shows the wordmark (no flash on a normal start). */
const WORDMARK_DELAY_MS = 400

// Holds the app back until the saved settings in nova.db have been pulled into browser storage, so no
// component (theme, accent, profile, ...) first renders defaults and then flips. Bounded by a timeout in
// hydrateUiStorage, so an unreachable server can only delay startup briefly, never block it.
export function UiStorageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) setSlow(true)
    }, WORDMARK_DELAY_MS)
    void hydrateUiStorage().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (ready) return <>{children}</>
  if (!slow) return null
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-canvas" role="status" aria-live="polite">
      <span className="text-xl font-semibold tracking-[-0.015em] text-fg">Nova</span>
      <span className="text-xs text-muted">Loading your settings</span>
    </div>
  )
}
