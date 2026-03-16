"use client"

import { Blocks } from "lucide-react"
import type { CSSProperties } from "react"

import { cn } from "@/lib/shared/utils"

interface PlaceholderOneHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
}

export function PlaceholderOneHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
}: PlaceholderOneHomeModuleProps) {
  return (
    <section style={panelStyle} className={cn(panelClass, "home-spotlight-shell px-3 py-2.5 flex flex-col min-h-0", className)}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
        <div className="flex items-center gap-2 text-s-80">
          <Blocks className="w-4 h-4 text-accent" />
        </div>
        <h2 className={cn("min-w-0 text-center text-sm uppercase tracking-[0.16em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
          Placeholder 1
        </h2>
        <div />
      </div>

      <div className={cn("mt-2 flex-1 rounded-[18px] border px-4 py-4", subPanelClass)}>
        <p className={cn("text-[13px] leading-6", isLight ? "text-s-70" : "text-slate-300")}>
          Placeholder module.
        </p>
        <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-s-50" : "text-slate-500")}>
          Placeholder only.
        </p>
      </div>
    </section>
  )
}
