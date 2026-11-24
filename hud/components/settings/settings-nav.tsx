"use client"

import { User, Palette, Volume2, Bell, Sparkles, FileCode2, Gauge, Route, HardDrive } from "lucide-react"
import { NOVA_VERSION } from "@/lib/meta/version"
import { cn } from "@/lib/shared/utils"

export const SETTINGS_GROUPS = ["Account", "App", "Agents", "Data"] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

/** Every Settings section, in nav order. The shell, command palette and `openSettings(id)` use these ids. */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", group: "Account", icon: User, description: "Your name, photo and the memory Nova reads every turn." },
  { id: "personalization", label: "Personalization", group: "Account", icon: Sparkles, description: "What the assistant is called, what it knows about you and how it answers." },
  { id: "appearance", label: "Appearance", group: "App", icon: Palette, description: "Theme, accent colour, text size and startup." },
  { id: "audio", label: "Audio & voice", group: "App", icon: Volume2, description: "Interface sounds and spoken replies." },
  { id: "notifications", label: "Notifications", group: "App", icon: Bell, description: "Hints Nova shows while you chat." },
  { id: "agent-budgets", label: "Agent budgets", group: "Agents", icon: Gauge, description: "Default spending limits per agent task and the cheaper models tasks switch to." },
  { id: "model-routing", label: "Model routing", group: "Agents", icon: Route, description: "Send some of Nova's own model calls to a cheaper model from the same provider." },
  { id: "skills", label: "Skills", group: "Agents", icon: FileCode2, description: "SKILL.md instructions agents load when a request matches." },
  { id: "local-data", label: "Local data", group: "Data", icon: HardDrive, description: "Where Nova keeps your data on this PC, and how to reset or delete it." },
] as const satisfies ReadonlyArray<{ id: string; label: string; group: SettingsGroup; icon: unknown; description: string }>

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

interface Props {
  activeSection: SettingsSectionId
  onSectionChange: (id: SettingsSectionId) => void
}

export function SettingsNav({ activeSection, onSectionChange }: Props) {
  return (
    <nav aria-label="Settings sections" className="flex w-52 shrink-0 flex-col border-r border-border bg-surface-2">
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-md font-semibold tracking-[-0.01em] text-fg">Settings</h2>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group} className="mb-3 last:mb-0">
            <p className="px-2 pb-1 text-xs text-faint">{group}</p>
            <ul className="flex flex-col gap-px">
              {SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => {
                const Icon = section.icon
                const active = activeSection === section.id
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => onSectionChange(section.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors duration-150 ease-out",
                        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      {active ? <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" /> : null}
                      <Icon className={cn("size-4 shrink-0", active ? "text-fg" : "text-faint")} aria-hidden />
                      <span className="truncate">{section.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-4 py-2.5 font-mono text-2xs text-faint">{NOVA_VERSION}</p>
    </nav>
  )
}
