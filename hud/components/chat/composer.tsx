"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import { ArrowUp, FileText, Mic, MicOff, Paperclip, Square, X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { IconButton, Kbd, Textarea, Tooltip } from "@/components/ui"
import { loadUserSettings } from "@/lib/settings/userSettings"

interface ComposerProps {
  onSend: (content: string, options?: { imageData?: string }) => void | Promise<void>
  /** A reply is streaming: the send button becomes Stop. */
  isStreaming: boolean
  onStop?: () => void
  disabled?: boolean
  /** Placeholder while disabled. */
  disabledReason?: string
  isMuted: boolean
  onToggleMute: () => void
  muteHydrated?: boolean
  /** Active provider model ID shown in the toolbar (mono); empty = not set. */
  modelId?: string
  autoFocus?: boolean
}

const IMAGE_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const MAX_IMAGE_INPUT_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_DATA_URL_LENGTH = 180_000
const IMAGE_MAX_DIMENSION = 1280

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Could not read selected image."))
    reader.readAsDataURL(file)
  })
}

async function drawScaledJpegDataUrl(sourceDataUrl: string, maxDimension: number, quality: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const sourceWidth = Math.max(1, Number(img.naturalWidth || img.width || 1))
      const sourceHeight = Math.max(1, Number(img.naturalHeight || img.height || 1))
      const maxSide = Math.max(sourceWidth, sourceHeight)
      const scale = maxSide > maxDimension ? maxDimension / maxSide : 1
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("Could not process selected image."))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", quality))
    }
    img.onerror = () => reject(new Error("Invalid image file."))
    img.src = sourceDataUrl
  })
}

async function prepareImageDataForHud(file: File): Promise<string> {
  if (!IMAGE_ALLOWED_MIME_TYPES.has(file.type)) return ""
  if (file.size <= 0 || file.size > MAX_IMAGE_INPUT_BYTES) return ""
  const originalDataUrl = await readFileAsDataUrl(file)
  if (originalDataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) return originalDataUrl

  let maxDimension = IMAGE_MAX_DIMENSION
  for (let pass = 0; pass < 4; pass += 1) {
    for (const quality of [0.86, 0.78, 0.7, 0.62]) {
      const candidate = await drawScaledJpegDataUrl(originalDataUrl, maxDimension, quality)
      if (candidate.length <= MAX_IMAGE_DATA_URL_LENGTH) return candidate
    }
    maxDimension = Math.max(480, Math.floor(maxDimension * 0.82))
  }
  return ""
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Composer({
  onSend,
  isStreaming,
  onStop,
  disabled = false,
  disabledReason = "Waiting for the runtime",
  isMuted,
  onToggleMute,
  muteHydrated = true,
  modelId = "",
  autoFocus = false,
}: ComposerProps) {
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus()
  }, [autoFocus, disabled])

  const playClickSound = useCallback(() => {
    if (!loadUserSettings().app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.5
    audio.play().catch(() => {})
  }, [])

  const canSend = (value.trim().length > 0 || attachedFiles.length > 0) && !isStreaming && !disabled

  const handleSend = useCallback(async () => {
    if ((!value.trim() && attachedFiles.length === 0) || isStreaming || disabled) return
    playClickSound()
    const imageFiles = attachedFiles.filter((file) => file.type.startsWith("image/"))
    const nonImageFiles = attachedFiles.filter((file) => !file.type.startsWith("image/"))
    let imageData = ""
    if (imageFiles.length > 0) {
      try {
        imageData = await prepareImageDataForHud(imageFiles[0])
      } catch {
        imageData = ""
      }
    }
    const listedFiles = imageData ? nonImageFiles : [...nonImageFiles, ...imageFiles]
    const filesSuffix =
      listedFiles.length > 0 ? `\n\nAttached files:\n${listedFiles.map((f) => `- ${f.name}`).join("\n")}` : ""
    const normalizedText = value.trim()
    const finalText =
      normalizedText.length > 0
        ? `${normalizedText}${filesSuffix}`
        : imageData
          ? "Please analyze this image."
          : `Please analyze these files:${filesSuffix}`
    await onSend(finalText, imageData ? { imageData } : undefined)
    setValue("")
    setAttachedFiles([])
  }, [value, attachedFiles, isStreaming, disabled, onSend, playClickSound])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setAttachedFiles((prev) => [...prev, ...Array.from(files)])
    e.target.value = ""
  }, [])

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        void handleSend()
      } else if (e.key === "Escape" && isStreaming && onStop) {
        e.preventDefault()
        onStop()
      }
    },
    [handleSend, isStreaming, onStop],
  )

  const voiceLabel = !muteHydrated ? "Syncing voice" : isMuted ? "Turn on voice" : "Turn off voice"

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface transition-[border-color,box-shadow] duration-150 ease-out",
        "focus-within:border-accent-border focus-within:ring-3 focus-within:ring-accent-muted",
        disabled && "bg-surface-2",
      )}
    >
      {attachedFiles.length > 0 ? (
        <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
          {attachedFiles.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface-2 pl-2 pr-0.5 text-xs text-fg"
            >
              <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">{formatFileSize(file.size)}</span>
              <IconButton size="sm" className="size-6" aria-label={`Remove ${file.name}`} onClick={() => removeAttachedFile(index)}>
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      <Textarea
        ref={textareaRef}
        autoGrow
        minRows={1}
        maxRows={10}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? disabledReason : "Message Nova"}
        disabled={disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-lt-active="false"
        aria-label="Message"
        className="border-0 bg-transparent px-3 pt-2.5 pb-1 text-sm leading-6 hover:border-0 focus-visible:ring-0 disabled:opacity-70"
      />

      <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
        <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileChange} tabIndex={-1} />
        <Tooltip content="Attach files">
          <IconButton size="sm" aria-label="Attach files" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
            <Paperclip />
          </IconButton>
        </Tooltip>
        <Tooltip content={voiceLabel}>
          <IconButton
            size="sm"
            aria-label={voiceLabel}
            aria-pressed={muteHydrated ? !isMuted : undefined}
            disabled={!muteHydrated}
            onClick={onToggleMute}
            className={cn(!isMuted && muteHydrated && "bg-accent-muted text-accent-text hover:bg-accent-muted hover:text-accent-text")}
          >
            {isMuted ? <MicOff /> : <Mic />}
          </IconButton>
        </Tooltip>
        <Tooltip content={modelId ? "Active model. Change it in Integrations." : "No model selected. Set one up in Integrations."}>
          <Link
            href="/integrations"
            className="ml-1 inline-flex h-7 min-w-0 items-center rounded-md px-1.5 font-mono text-2xs text-faint transition-colors hover:bg-hover hover:text-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="truncate">{modelId || "No model set"}</span>
          </Link>
        </Tooltip>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 text-2xs text-faint lg:flex" aria-hidden>
            {isStreaming && onStop ? (
              <>
                <Kbd>Esc</Kbd> to stop
              </>
            ) : (
              <>
                <Kbd>Enter</Kbd> to send, <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd> for a new line
              </>
            )}
          </span>
          {isStreaming && onStop ? (
            <Tooltip content="Stop" shortcut="Esc">
              <IconButton size="sm" variant="secondary" aria-label="Stop response" onClick={onStop}>
                <Square className="size-3 fill-current" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip content="Send" shortcut="Enter">
              <IconButton
                size="sm"
                variant="primary"
                aria-label="Send message"
                disabled={!canSend}
                onClick={() => void handleSend()}
              >
                <ArrowUp />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
