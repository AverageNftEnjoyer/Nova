"use client"

import { useState, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/shared/utils"

export interface SecretInputProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  placeholderWhenConfigured?: string
  maskedValue?: string
  isConfigured?: boolean
  serverLabel?: string
  hint?: ReactNode
  name?: string
  isLight: boolean
  subPanelClass: string
}

export function SecretInput({
  value,
  onChange,
  label,
  placeholder,
  placeholderWhenConfigured,
  maskedValue,
  isConfigured = false,
  serverLabel = "Key on server",
  hint,
  name,
  isLight,
  subPanelClass,
}: SecretInputProps) {
  const [showValue, setShowValue] = useState(false)

  return (
    <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
          {label}
        </p>
        {isConfigured && maskedValue && (
          <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
            {serverLabel}: <span className="font-mono">{maskedValue}</span>
          </p>
        )}
      </div>
      <div className="relative">
        <input
          type={showValue ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isConfigured && placeholderWhenConfigured ? placeholderWhenConfigured : placeholder}
          name={name}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          className={cn(
            "no-edge-reveal w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
            isLight
              ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
              : "border-white/10 text-slate-100 placeholder:text-slate-500"
          )}
        />
        <button
          type="button"
          onClick={() => setShowValue((v) => !v)}
          className={cn(
            "absolute right-2 top-1/2 z-10 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
            isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10"
          )}
          aria-label={showValue ? "Hide value" : "Show value"}
          title={showValue ? "Hide value" : "Show value"}
        >
          {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint ? (
        <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
