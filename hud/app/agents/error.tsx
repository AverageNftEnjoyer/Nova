"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AgentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error("Agents page render failed", error)
  }, [error])

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#0a0a0f] text-slate-100">
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6">
        <div className="w-full rounded-2xl border border-white/15 bg-black/30 p-6 backdrop-blur-xl">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Agent Chart</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Agent surface failed to render</h1>
          <p className="mt-2 text-sm text-slate-300">
            We hit a runtime error before the chart could load. Retry this screen or go back home.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={reset}
              className="h-9 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-semibold tracking-[0.12em] text-slate-100 transition-colors hover:bg-white/15"
            >
              Retry
            </button>
            <button
              onClick={() => router.push("/home")}
              className="h-9 rounded-lg border border-white/20 bg-black/25 px-3 text-xs font-semibold tracking-[0.12em] text-slate-300 transition-colors hover:bg-white/10"
            >
              Back Home
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
