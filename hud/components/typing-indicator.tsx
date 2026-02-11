"use client"

import { NovaOrbIndicator, type OrbPalette } from "./nova-orb-indicator"

interface TypingIndicatorProps {
  orbPalette: OrbPalette
}

export function TypingIndicator({ orbPalette }: TypingIndicatorProps) {
  return (
    <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="w-full max-w-[48rem] py-1" role="status" aria-label="Assistant is typing">
        <div className="inline-flex items-center">
          <NovaOrbIndicator palette={orbPalette} size={20} animated />
        </div>
      </div>
    </div>
  )
}
