"use client"

import { useEffect } from "react"
import { RouteErrorState } from "@/components/shell/route-states"

/** Error boundary for every page: the shell (sidebar, top bar) stays usable while the page shows what failed. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Nova] Page error", error)
  }, [error])

  return <RouteErrorState error={error} onRetry={reset} />
}
