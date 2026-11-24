"use client"

import { useEffect, useState } from "react"
import { Copy, Minus, Square, X } from "lucide-react"
import { cn } from "@/lib/shared/utils"

const CONTROL =
  "flex h-full w-11 items-center justify-center text-muted transition-colors duration-150 ease-out " +
  "hover:bg-hover hover:text-fg focus-visible:outline-offset-[-2px] [&_svg]:size-3.5"

/**
 * Minimize / maximize / close for the frameless Electron window (hud/electron/main.js sets `frame: false`).
 * Renders nothing in a plain browser. Fills the height of its parent (the 44px top bar) and opts out of the
 * drag region so the buttons stay clickable.
 */
export function WindowControls({ className }: { className?: string }) {
  const [isElectron, setIsElectron] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isElectron) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- electronAPI only exists after hydration
    setIsElectron(true)
    void api.windowIsMaximized().then(setIsMaximized)
    // Snapping or double-clicking the drag region also maximizes; re-read on every resize.
    const onResize = () => void api.windowIsMaximized().then(setIsMaximized)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  if (!isElectron) return null

  return (
    <div data-window-controls className={cn("flex h-full items-stretch select-none [-webkit-app-region:no-drag]", className)}>
      <button type="button" className={CONTROL} aria-label="Minimize window" onClick={() => void window.electronAPI?.windowMinimize()}>
        <Minus />
      </button>
      <button
        type="button"
        className={CONTROL}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        onClick={() => void window.electronAPI?.windowMaximize()}
      >
        {isMaximized ? <Copy className="-scale-x-100" /> : <Square className="size-3!" />}
      </button>
      <button
        type="button"
        className={cn(CONTROL, "hover:bg-danger-solid hover:text-danger-fg")}
        aria-label="Close window"
        onClick={() => void window.electronAPI?.windowClose()}
      >
        <X />
      </button>
    </div>
  )
}
