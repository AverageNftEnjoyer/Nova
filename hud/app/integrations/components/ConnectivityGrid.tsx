import type { ReactNode } from "react"
import { cn } from "@/lib/shared/utils"

export type IntegrationSetupKey =
  | "telegram"
  | "discord"
  | "brave"
  | "coinbase"
  | "openai"
  | "claude"
  | "grok"
  | "gemini"
  | "gmail"

interface ConnectivityGridProps {
  isLight: boolean
  activeSetup: IntegrationSetupKey
  integrationBadgeClass: (connected: boolean) => string
  onSelect: (setup: IntegrationSetupKey) => void
  items: Array<{
    key: IntegrationSetupKey
    connected: boolean
    icon: ReactNode
    ariaLabel: string
  }>
}

export function ConnectivityGrid({
  isLight,
  activeSetup,
  integrationBadgeClass,
  onSelect,
  items,
}: ConnectivityGridProps) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={cn(
            "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
            integrationBadgeClass(item.connected),
            activeSetup === item.key && "ring-1 ring-white/55",
          )}
          aria-label={item.ariaLabel}
        >
          {item.icon}
        </button>
      ))}
      {Array.from({ length: 22 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "h-9 rounded-sm border home-spotlight-card home-border-glow",
            isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20",
          )}
        />
      ))}
    </div>
  )
}
