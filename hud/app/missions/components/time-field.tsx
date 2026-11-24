"use client"

import { useCallback, useEffect, useState } from "react"

import { Input, Select } from "@/components/ui"
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
  id?: string
  className?: string
}

/** 12-hour time entry (text + AM/PM) that commits a 24-hour HH:mm value. */
export function TimeField({ value24, onChange24, id, className }: TimeFieldProps) {
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
    <div className={cn("grid w-full grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-1.5", className)}>
      <Input
        id={id}
        mono
        value={text}
        onChange={(e) => {
          const normalized = normalizeTypedTime(e.target.value)
          setText(normalized)
          if (isLiveCommitTypedTime(normalized)) commit(normalized, meridiem)
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
        placeholder="09:00"
        inputMode="numeric"
        maxLength={5}
        aria-label="Time"
        className="tabular-nums"
      />
      <Select
        value={meridiem}
        options={MERIDIEM_OPTIONS}
        aria-label="AM or PM"
        onValueChange={(next) => {
          const nextMeridiem = next === "PM" ? "PM" : "AM"
          setMeridiem(nextMeridiem)
          if (isCompleteTypedTime(text)) commit(text, nextMeridiem)
        }}
      />
    </div>
  )
}
