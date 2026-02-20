"use client"

import { User, Palette, Volume2, Bell, Sparkles, FileCode2, Shield, Power, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "audio", label: "Audio & Voice", icon: Volume2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "personalization", label: "Personalization", icon: Sparkles },
  { id: "skills", label: "Skills", icon: FileCode2 },
  { id: "bootup", label: "Bootup", icon: Power },
  { id: "access", label: "Account", icon: Shield },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

interface Props {
  isLight: boolean
  activeSection: SettingsSectionId
  onSectionChange: (id: SettingsSectionId) => void
  onReset: () => void
}

export function SettingsNav({ isLight, activeSection, onSectionChange, onReset }: Props) {
  return (
    <div className={cn(
      "md:w-60 border-b md:border-b-0 md:border-r flex flex-col shrink-0",
      isLight ? "bg-[#f6f8fc] border-[#e2e8f2]" : "bg-black/30 border-white/10"
    )}>
      <div className={cn("px-4 py-4 border-b", isLight ? "border-[#e2e8f2]" : "border-white/10")}>
        <h2 className={cn("text-base sm:text-lg font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>Settings</h2>
        <p className={cn("text-xs mt-1", isLight ? "text-s-40" : "text-slate-400")}>Tune Nova to your workflow</p>
      </div>

      <div className="no-scrollbar flex-1 p-2.5 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden">
        <div className="flex md:flex-col gap-1.5 min-w-max md:min-w-0">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={cn(
                  "fx-spotlight-card fx-border-glow whitespace-nowrap md:w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm transition-all duration-150",
                  isActive
                    ? isLight
                      ? "bg-[#edf3ff] text-accent border border-accent-30"
                      : "bg-white/8 text-accent border border-accent-30"
                    : isLight
                      ? "text-s-50 border border-transparent hover:bg-[#eef3fb] hover:text-s-80"
                      : "text-slate-400 border border-transparent hover:bg-white/6 hover:text-slate-200"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {section.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className={cn("p-3 border-t hidden md:block", isLight ? "border-[#e2e8f2]" : "border-white/10")}>
        <Button
          onClick={onReset}
          variant="ghost"
          size="sm"
          className={cn(
            "fx-spotlight-card fx-border-glow w-full gap-2 h-9 transition-colors duration-150",
            isLight ? "text-s-40 hover:text-s-60 hover:bg-[#eef3fb]" : "text-slate-500 hover:text-slate-300 hover:bg-white/6"
          )}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Default
        </Button>
      </div>
    </div>
  )
}
