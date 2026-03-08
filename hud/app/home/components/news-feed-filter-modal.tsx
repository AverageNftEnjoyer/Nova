"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Check } from "lucide-react"

import { useSpotlightEffect } from "@/app/integrations/hooks"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import type { HomeNewsTopic } from "../hooks/use-home-news-feed"

interface NewsFeedFilterModalProps {
  isOpen: boolean
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle?: CSSProperties
  topics: HomeNewsTopic[]
  draftTopics: string[]
  onToggleTopic: (topicId: string) => void
  onClose: () => void
  onSave: () => void
}

export function NewsFeedFilterModal({
  isOpen,
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  topics,
  draftTopics,
  onToggleTopic,
  onClose,
  onSave,
}: NewsFeedFilterModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [spotlightEnabled, setSpotlightEnabled] = useState(() => loadUserSettings().app.spotlightEnabled ?? true)

  useEffect(() => {
    const sync = () => setSpotlightEnabled(loadUserSettings().app.spotlightEnabled ?? true)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useSpotlightEffect(
    isOpen && spotlightEnabled,
    [{ ref: modalRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true }],
    [isOpen, isLight, spotlightEnabled],
  )

  const selectedCount = draftTopics.includes("all") ? "All" : `${draftTopics.length}`

  if (!isOpen) return null

  return (
    <div style={panelStyle} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close news filters" />
      <div
        ref={modalRef}
        className={cn(
          "relative z-10 w-full max-w-md home-spotlight-shell rounded-xl border shadow-2xl",
          panelClass,
          isLight ? "bg-white/95" : "bg-black/90",
        )}
      >
        <div className={cn("border-b px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-400")}>
                News filters
              </p>
              <h3 className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                Save the Categories To Be Displayed
              </h3>
            </div>
            <span
              className={cn(
                "rounded-sm border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]",
                isLight ? "border-[#9ac5ff] bg-[#e8f2ff] text-[#1b5eb6]" : "border-accent/35 bg-accent/15 text-slate-100",
              )}
            >
              {selectedCount}
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            {topics.map((topic) => {
              const isSelected = draftTopics.includes(topic.id)
              return (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggleTopic(topic.id)}
                  className={cn(
                    "min-h-10 rounded-md border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all home-spotlight-card home-border-glow text-left",
                    isSelected
                      ? isLight
                        ? "border-[#69a9ff] bg-[#dcecff] text-[#0c4fa7] shadow-[0_0_0_1px_rgba(105,169,255,0.28)]"
                        : "border-accent/50 bg-accent/18 text-slate-100 shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.18)]"
                      : subPanelClass,
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{topic.label}</span>
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-all",
                        isSelected
                          ? isLight
                            ? "border-[#69a9ff] bg-[#69a9ff] text-white"
                            : "border-accent bg-accent text-black"
                          : isLight
                            ? "border-[#cfd9e9] bg-white text-transparent"
                            : "border-white/18 bg-transparent text-transparent",
                      )}
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className={cn("flex items-center justify-end gap-2 border-t px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "h-8 rounded-md border px-3 text-[10px] font-semibold uppercase tracking-[0.1em] home-spotlight-card home-border-glow",
              subPanelClass,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className={cn(
              "h-8 rounded-md border px-3 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
              isLight
                ? "border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                : "border-emerald-300/40 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35",
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
