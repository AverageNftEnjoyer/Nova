"use client"

import { cn } from "@/lib/utils"

export interface TextInputProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  hint?: string
  isLight: boolean
  subPanelClass: string
}

export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  hint,
  isLight,
  subPanelClass,
}: TextInputProps) {
  return (
    <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
      <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
        {label}
      </p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        className={cn(
          "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
          isLight
            ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
            : "border-white/10 text-slate-100 placeholder:text-slate-500"
        )}
      />
      {hint && (
        <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
          {hint}
        </p>
      )}
    </div>
  )
}
