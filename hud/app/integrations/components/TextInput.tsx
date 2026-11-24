"use client"

import type { ReactNode } from "react"

import { Field, Input } from "@/components/ui"

export interface TextInputProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  hint?: ReactNode
  error?: ReactNode
  /** Monospace value (IDs, URLs). Default true: most setup values are identifiers. */
  mono?: boolean
}

export function TextInput({ value, onChange, label, placeholder, hint, error, mono = true }: TextInputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        mono={mono}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
      />
    </Field>
  )
}
