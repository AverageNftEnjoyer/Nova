"use client"

import { Blocks } from "lucide-react"
import type { CSSProperties } from "react"

import { cn } from "@/lib/shared/utils"

interface PlaceholderTwoHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
}

export function PlaceholderTwoHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
}: PlaceholderTwoHomeModuleProps) {
  return (
    <section style={panelStyle} className={cn(panelClass, "home-spotlight-shell px-3 py-2.5 flex flex-col", className)}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2">
        <div className="flex items-center gap-2 text-s-80">
          <Blocks className="w-4 h-4 text-accent" />
        </div>
        <h2 className={cn("min-w-0 text-sm uppercase tracking-[0.16em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
          Placeholder 2
        </h2>
        <div />
      </div>

      <div className={cn("mt-2 flex-1 rounded-md border p-3", subPanelClass)}>
        <p className={cn("text-[12px] leading-5", isLight ? "text-s-70" : "text-slate-300")}>
          Placeholder module.
        </p>
        <p className={cn("mt-1 text-[10px] leading-4", isLight ? "text-s-50" : "text-slate-500")}>
          Placeholder only.
        </p>
      </div>
    </section>
  )
}
