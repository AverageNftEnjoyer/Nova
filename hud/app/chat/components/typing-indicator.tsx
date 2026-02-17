"use client"

import { NovaOrbIndicator, type OrbPalette } from "@/components/nova-orb-indicator"

interface TypingIndicatorProps {
  orbPalette: OrbPalette
}

export function TypingIndicator({ orbPalette }: TypingIndicatorProps) {
  return (
    <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-full max-w-3xl py-1.5" role="status" aria-label="Assistant is typing">
        <div className="inline-flex items-center">
          <NovaOrbIndicator palette={orbPalette} size={28} animated />
        </div>
      </div>
    </div>
  )
}
