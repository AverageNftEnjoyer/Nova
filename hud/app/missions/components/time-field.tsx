"use client"

import { useCallback, useEffect, useState } from "react"

import { FluidSelect } from "@/components/ui/fluid-select"
import { cn } from "@/lib/shared/utils"
import { MERIDIEM_OPTIONS } from "../constants"
import {
  clampToValid12Hour,
  isCompleteTypedTime,
  isLiveCommitTypedTime,
  normalizeTypedTime,
  to12HourParts,
  to24Hour,
} from "../time"

export interface TimeFieldProps {
  value24: string
  onChange24: (next: string) => void
  isLight: boolean
  className?: string
}

export function TimeField({ value24, onChange24, isLight, className }: TimeFieldProps) {
  const parsed = to12HourParts(value24)
  const [text, setText] = useState(parsed.text)
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(parsed.meridiem)

  useEffect(() => {
    const next = to12HourParts(value24)
    setText(next.text) // eslint-disable-line react-hooks/set-state-in-effect
    setMeridiem(next.meridiem)
  }, [value24])

  const commit = useCallback(
    (nextText: string, nextMeridiem: "AM" | "PM") => {
      const full = clampToValid12Hour(nextText)
      const converted = to24Hour(full, nextMeridiem)
      if (converted) {
        setText(full)
        onChange24(converted)
      }
    },
    [onChange24],
  )

  return (
    <div className={cn("grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-2", className)}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          const normalized = normalizeTypedTime(e.target.value)
          setText(normalized)
          if (isLiveCommitTypedTime(normalized)) {
            commit(normalized, meridiem)
          }
        }}
        onBlur={() => {
          if (isCompleteTypedTime(text)) {
            commit(text, meridiem)
          } else {
            const fallback = to12HourParts(value24)
            setText(fallback.text)
            setMeridiem(fallback.meridiem)
          }
        }}
        placeholder="12:45"
        inputMode="numeric"
        maxLength={5}
        className={cn(
          "h-9 min-w-0 w-full rounded-md border px-3 text-sm outline-none transition-colors",
          isLight
            ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 placeholder:text-s-40 hover:bg-[#eef3fb]"
            : "border-white/12 bg-white/6 text-slate-100 placeholder:text-slate-500 backdrop-blur-md hover:bg-white/10",
        )}
      />
      <FluidSelect
        value={meridiem}
        onChange={(next) => {
          const nextMeridiem = (next === "PM" ? "PM" : "AM") as "AM" | "PM"
          setMeridiem(nextMeridiem)
          if (isCompleteTypedTime(text)) {
            commit(text, nextMeridiem)
          }
        }}
        options={MERIDIEM_OPTIONS}
        isLight={isLight}
      />
    </div>
  )
}
