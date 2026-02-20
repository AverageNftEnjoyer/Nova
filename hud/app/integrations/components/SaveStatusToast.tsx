"use client"

import { cn } from "@/lib/shared/utils"

export interface SaveStatus {
  type: "success" | "error"
  message: string
}

export interface SaveStatusToastProps {
  status: SaveStatus | null
  isLight: boolean
}

export function SaveStatusToast({ status, isLight }: SaveStatusToastProps) {
  if (!status) return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-xs backdrop-blur-md shadow-lg",
          status.type === "success"
            ? isLight
              ? "border-emerald-300/40 bg-emerald-500/12 text-emerald-700"
              : "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
            : isLight
              ? "border-rose-300/40 bg-rose-500/12 text-rose-700"
              : "border-rose-300/40 bg-rose-500/15 text-rose-300"
        )}
      >
        {status.message}
      </div>
    </div>
  )
}
