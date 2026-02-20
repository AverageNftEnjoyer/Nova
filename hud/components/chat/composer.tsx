"use client"

import type React from "react"

import { useState, useRef, useCallback, type KeyboardEvent, useEffect } from "react"
import { ArrowRight, Mic, MicOff, X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { ACCENT_COLORS, loadUserSettings, type AccentColor, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { useTheme } from "@/lib/context/theme-context"

interface ComposerProps {
  onSend: (content: string) => void
  isStreaming: boolean
  disabled?: boolean
  isMuted: boolean
  onToggleMute: () => void
  muteHydrated?: boolean
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function Composer({ onSend, isStreaming, disabled, isMuted, onToggleMute, muteHydrated = true }: ComposerProps) {
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [value, setValue] = useState("")
  // Keep SSR and initial client render deterministic to avoid hydration mismatch.
  const [accentColor, setAccentColor] = useState<AccentColor>("violet")
  const [compactMode, setCompactMode] = useState(() => loadUserSettings().app.compactMode)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const syncAccent = () => setAccentColor(loadUserSettings().app.accentColor)
    syncAccent()
    const syncCompactMode = () => setCompactMode(loadUserSettings().app.compactMode)
    syncCompactMode()
    const onSettingsUpdated = () => syncAccent()
    const onCompactUpdated = () => syncCompactMode()
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nova_user_settings") {
        syncAccent()
        syncCompactMode()
      }
    }

    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, onCompactUpdated as EventListener)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener)
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, onCompactUpdated as EventListener)
      window.removeEventListener("storage", onStorage)
    }
  }, [])


  const playClickSound = useCallback(() => {
    if (!loadUserSettings().app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.5
    audio.play().catch(() => {})
  }, [])

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [])

  const handleSend = useCallback(() => {
    if ((!value.trim() && attachedFiles.length === 0) || isStreaming || disabled) return
    playClickSound()
    const filesSuffix =
      attachedFiles.length > 0
        ? `\n\nAttached files:\n${attachedFiles.map((f) => `- ${f.name}`).join("\n")}`
        : ""
    const finalText = value.trim().length > 0 ? `${value.trim()}${filesSuffix}` : `Please analyze these files:${filesSuffix}`
    onSend(finalText)
    setValue("")
    setAttachedFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, attachedFiles, isStreaming, disabled, onSend, playClickSound])

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setAttachedFiles((prev) => [...prev, ...Array.from(files)])
    e.target.value = ""
  }, [])

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const accent = ACCENT_COLORS[accentColor]

  return (
    <div className="absolute bottom-3 left-0 right-0 px-2 sm:px-4 pointer-events-none z-10">
      <div className={cn("mx-auto w-full pointer-events-auto", compactMode ? "max-w-[52rem]" : "max-w-none")}>
        <div className="relative w-full">
          {attachedFiles.length > 0 && (
            <div className="absolute left-0 right-0 bottom-full mb-2 z-40 flex flex-wrap gap-2 px-1 pointer-events-auto">
              {attachedFiles.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="group inline-flex items-center gap-1.5 rounded-md border border-accent-30 bg-accent-10 px-2 py-1 max-w-55 transition-all duration-150 hover:bg-accent-20 hover:-translate-y-0.5">
                  <span className="truncate text-xs text-accent">{file.name}</span>
                  <span className="text-[10px] text-accent/70 whitespace-nowrap">{formatFileSize(file.size)}</span>
                  <button
                    onClick={() => removeAttachedFile(index)}
                    className="h-4 w-4 rounded-sm text-accent hover:bg-accent-20 transition-colors"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className="absolute -inset-1 rounded-lg opacity-60 pointer-events-none"
            style={{
              background: `radial-gradient(120% 90% at 20% 0%, ${hexToRgba(accent.primary, isLight ? 0.12 : 0.16)} 0%, ${hexToRgba(accent.secondary, isLight ? 0.07 : 0.11)} 38%, transparent 72%)`,
            }}
          />
          <div
            className={cn(
              "home-spotlight-card home-border-glow relative rounded-lg transition-colors border overflow-hidden",
              isLight
                ? "border border-[#d5dce8] bg-[#f4f7fd]/98 focus-within:border-[#cfd7e5]"
                : "border border-white/10 bg-black/25 backdrop-blur-md focus-within:border-white/20",
            )}
          >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(135deg, ${hexToRgba(accent.primary, isLight ? 0.06 : 0.09)} 0%, transparent 38%, ${hexToRgba(accent.secondary, isLight ? 0.04 : 0.07)} 100%)`,
            }}
          />

          <button
            onClick={handleAttachClick}
            className={cn(
              "group absolute left-4 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-2xl leading-none transition-all duration-150 z-20",
              isLight ? "text-s-50 hover:bg-accent-10" : "text-slate-400 hover:bg-accent-10",
            )}
            aria-label="Attach files"
          >
            +
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleFileChange}
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              handleInput()
            }}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Waiting for agent..." : "Enter your command..."}
            disabled={disabled}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            data-lt-active="false"
            rows={1}
            className={cn(
              "relative z-10 w-full bg-transparent text-sm pl-12 pt-4 pb-2.5 pr-34 resize-none outline-none disabled:opacity-40",
              isLight ? "text-s-90 placeholder:text-[#b3bcc8]" : "text-slate-100 placeholder:text-[#a4afc1]",
            )}
            style={{ maxHeight: 120 }}
            aria-label="Message input"
          />

          <div className="absolute right-3 bottom-3 flex items-center gap-2 z-20">
            <button
              onClick={handleSend}
              disabled={(!value.trim() && attachedFiles.length === 0) || disabled || isStreaming}
              className={cn(
                "p-1.5 transition-colors disabled:opacity-20",
                isLight ? "text-s-60 hover:text-accent" : "text-slate-400 hover:text-accent",
              )}
              aria-label="Send message"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={onToggleMute}
              disabled={!muteHydrated}
              className={cn(
                "relative h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
                !muteHydrated
                  ? "opacity-0 pointer-events-none"
                  : isMuted
                  ? "text-red-400 hover:text-red-300"
                  : isLight
                  ? "text-s-60 hover:text-s-80"
                  : "text-white/70 hover:text-white",
              )}
              aria-label={!muteHydrated ? "Syncing mute state" : isMuted ? "Unmute Nova" : "Mute Nova"}
            >
              {!muteHydrated ? null : isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
