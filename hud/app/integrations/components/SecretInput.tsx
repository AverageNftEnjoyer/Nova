"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Badge, Button, Field, IconButton, Input, Textarea, Tooltip } from "@/components/ui"

export interface SecretInputProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  /** Masked hint the server returned for the stored secret (never the secret itself). */
  maskedValue?: string
  isConfigured?: boolean
  hint?: ReactNode
  error?: ReactNode
  name?: string
  /** Multi-line secret (a PEM private key). */
  multiline?: boolean
}

const NO_AUTOFILL = {
  autoComplete: "off",
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "none",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-form-type": "other",
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
} as const

/**
 * A secret field. Once a secret is stored it shows only the server's masked hint with a "Configured" badge; "Replace"
 * opens an empty input for a new value (the stored one is kept until the new one is saved).
 */
export function SecretInput({
  value,
  onChange,
  label,
  placeholder,
  maskedValue,
  isConfigured = false,
  hint,
  error,
  name,
  multiline = false,
}: SecretInputProps) {
  const [replacing, setReplacing] = useState(false)
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const editing = !isConfigured || replacing || value.length > 0

  useEffect(() => {
    if (!replacing) return
    ;(multiline ? areaRef.current : inputRef.current)?.focus()
  }, [replacing, multiline])

  // A save returns a new masked hint: drop back to the configured view.
  const [savedHint, setSavedHint] = useState(maskedValue)
  if (savedHint !== maskedValue) {
    setSavedHint(maskedValue)
    setReplacing(false)
    setVisible(false)
  }

  const cancelReplace = () => {
    onChange("")
    setReplacing(false)
    setVisible(false)
  }

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      aside={isConfigured ? <Badge tone="success" dot>Configured</Badge> : <Badge>Not set</Badge>}
    >
      {editing ? (
        <div className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              ref={areaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={isConfigured ? "Paste the new value to replace the stored one" : placeholder}
              name={name}
              mono
              rows={visible ? 6 : 3}
              className={visible ? undefined : "[-webkit-text-security:disc]"}
              {...NO_AUTOFILL}
            />
          ) : (
            <Input
              ref={inputRef}
              type={visible ? "text" : "password"}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={isConfigured ? "Paste the new value to replace the stored one" : placeholder}
              name={name}
              mono
              className="no-edge-reveal"
              {...NO_AUTOFILL}
            />
          )}
          <Tooltip content={visible ? "Hide value" : "Show value"}>
            <IconButton
              variant="outline"
              aria-label={visible ? `Hide ${label}` : `Show ${label}`}
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </IconButton>
          </Tooltip>
          {isConfigured ? (
            <Button variant="ghost" onClick={cancelReplace}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex h-8 items-center justify-between gap-3 rounded-md border border-border bg-surface px-2.5">
          <span className="truncate font-mono text-xs text-muted">{maskedValue || "Stored securely"}</span>
          <Button variant="link" size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
        </div>
      )}
    </Field>
  )
}
