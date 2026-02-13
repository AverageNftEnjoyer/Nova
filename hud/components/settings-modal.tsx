"use client"

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react"
import NextImage from "next/image"
import {
  X,
  User,
  Palette,
  Volume2,
  Bell,
  Sparkles,
  Shield,
  Power,
  RotateCcw,
  Camera,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"
import { useTheme } from "@/lib/theme-context"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"
import {
  saveBootMusicBlob,
  removeBootMusicAsset,
  listBootMusicAssets,
  getActiveBootMusicAssetId,
  setActiveBootMusicAsset,
  type BootMusicAssetMeta,
} from "@/lib/bootMusicStorage"
import {
  saveBackgroundVideoBlob,
  removeBackgroundVideoAsset,
  listBackgroundVideoAssets,
  getActiveBackgroundVideoAssetId,
  setActiveBackgroundVideoAsset,
  type BackgroundVideoAssetMeta,
} from "@/lib/backgroundVideoStorage"
import {
  loadUserSettings,
  saveUserSettings,
  resetSettings,
  type UserSettings,
  type AccessTier,
  type AccentColor,
  type OrbColor,
  type DarkBackgroundType,
  ACCENT_COLORS,
  ORB_COLORS,
  TTS_VOICES,
  DARK_BACKGROUNDS,
} from "@/lib/userSettings"

const ACCESS_TIERS: AccessTier[] = ["Core Access", "Developer", "Admin", "Operator"]
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

// Play click sound for settings interactions (respects soundEnabled setting)
function playClickSound() {
  try {
    const settings = loadUserSettings()
    if (!settings.app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.5
    audio.play().catch(() => {})
  } catch {}
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type CropOffset = { x: number; y: number }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [activeSection, setActiveSection] = useState<string>("profile")
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [bootMusicError, setBootMusicError] = useState<string | null>(null)
  const [backgroundVideoError, setBackgroundVideoError] = useState<string | null>(null)
  const [bootMusicAssets, setBootMusicAssets] = useState<BootMusicAssetMeta[]>([])
  const [activeBootMusicAssetId, setActiveBootMusicAssetId] = useState<string | null>(null)
  const [backgroundVideoAssets, setBackgroundVideoAssets] = useState<BackgroundVideoAssetMeta[]>([])
  const [activeBackgroundVideoAssetId, setActiveBackgroundVideoAssetId] = useState<string | null>(null)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const { theme, setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const bootMusicInputRef = useRef<HTMLInputElement | null>(null)
  const backgroundVideoInputRef = useRef<HTMLInputElement | null>(null)
  const spotlightScopeRef = useRef<HTMLDivElement | null>(null)
  const isLight = theme === "light"

  const refreshMediaLibraries = useCallback(async () => {
    const [bootAssets, bootActiveId, videoAssets, videoActiveId] = await Promise.all([
      listBootMusicAssets(),
      getActiveBootMusicAssetId(),
      listBackgroundVideoAssets(),
      getActiveBackgroundVideoAssetId(),
    ])
    setBootMusicAssets(bootAssets)
    setActiveBootMusicAssetId(bootActiveId)
    setBackgroundVideoAssets(videoAssets)
    setActiveBackgroundVideoAssetId(videoActiveId)
  }, [])

  const palette = {
    bg: isLight ? "#f6f8fc" : "#0f1117",
    border: isLight ? "#d9e0ea" : "#252b36",
    hover: isLight ? "#eef3fb" : "#141923",
    cardBg: isLight ? "#ffffff" : "#121620",
    cardHover: isLight ? "#f7faff" : "#151a25",
    subBg: isLight ? "#f4f7fd" : "#0f1117",
    subBorder: isLight ? "#d5dce8" : "#2b3240",
    selectedBg: isLight ? "#edf3ff" : "#161b25",
  }

  const paletteVars = {
    "--settings-bg": palette.bg,
    "--settings-border": palette.border,
    "--settings-hover": palette.hover,
    "--settings-card-bg": palette.cardBg,
    "--settings-card-hover": palette.cardHover,
    "--settings-sub-bg": palette.subBg,
    "--settings-sub-border": palette.subBorder,
    "--settings-selected-bg": palette.selectedBg,
  } as CSSProperties

  useEffect(() => {
    let cancelled = false
    if (isOpen) {
      setSettings(loadUserSettings())
      void refreshMediaLibraries()
        .catch(() => {
          if (cancelled) return
          setBootMusicAssets([])
          setActiveBootMusicAssetId(null)
          setBackgroundVideoAssets([])
          setActiveBackgroundVideoAssetId(null)
        })
    }
    return () => {
      cancelled = true
    }
  }, [isOpen, refreshMediaLibraries])

  // Auto-save helper
  const autoSave = useCallback((newSettings: UserSettings) => {
    setSettings(newSettings)
    saveUserSettings(newSettings)
  }, [])

  const handleReset = useCallback(() => {
    const fresh = resetSettings()
    setSettings(fresh)
  }, [])

  const updateProfile = useCallback((key: string, value: string | null) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      profile: { ...settings.profile, [key]: value },
    }
    autoSave(newSettings)
  }, [settings, autoSave])

  const CROP_FRAME = 240
  const EXPORT_SIZE = 320
  const getBaseScale = useCallback(
    (size: { width: number; height: number } | null) => {
      if (!size) return 1
      return Math.max(CROP_FRAME / size.width, CROP_FRAME / size.height)
    },
    [],
  )

  const clampOffset = useCallback(
    (next: CropOffset, zoom: number, size: { width: number; height: number } | null): CropOffset => {
      if (!size) return { x: 0, y: 0 }
      const displayScale = getBaseScale(size) * zoom
      const displayedWidth = size.width * displayScale
      const displayedHeight = size.height * displayScale
      const maxX = Math.max(0, (displayedWidth - CROP_FRAME) / 2)
      const maxY = Math.max(0, (displayedHeight - CROP_FRAME) / 2)
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      }
    },
    [getBaseScale],
  )

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!settings) return
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setAvatarError("Only JPG, PNG, or WEBP images are allowed.")
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setAvatarError("Image is too large. Max size is 8MB.")
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ""))
      reader.onerror = () => reject(new Error("Could not read image file."))
      reader.readAsDataURL(file)
    })

    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error("Invalid image file."))
      img.src = dataUrl
    })

    setImageSize(size)
    setCropSource(dataUrl)
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
    setAvatarError(null)
  }, [settings])

  const saveCroppedAvatar = useCallback(async () => {
    if (!cropSource || !imageSize) return

    const output = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const baseScale = getBaseScale(imageSize)
        const displayScale = baseScale * cropZoom
        const displayedWidth = imageSize.width * displayScale
        const displayedHeight = imageSize.height * displayScale
        const imageLeft = CROP_FRAME / 2 - displayedWidth / 2 + cropOffset.x
        const imageTop = CROP_FRAME / 2 - displayedHeight / 2 + cropOffset.y

        let sx = ((0 - imageLeft) / displayedWidth) * imageSize.width
        let sy = ((0 - imageTop) / displayedHeight) * imageSize.height
        let sw = (CROP_FRAME / displayedWidth) * imageSize.width
        let sh = (CROP_FRAME / displayedHeight) * imageSize.height

        sx = Math.max(0, Math.min(imageSize.width - 1, sx))
        sy = Math.max(0, Math.min(imageSize.height - 1, sy))
        sw = Math.max(1, Math.min(imageSize.width - sx, sw))
        sh = Math.max(1, Math.min(imageSize.height - sy, sh))

        const canvas = document.createElement("canvas")
        canvas.width = EXPORT_SIZE
        canvas.height = EXPORT_SIZE
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Could not process image."))
          return
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, EXPORT_SIZE, EXPORT_SIZE)
        resolve(canvas.toDataURL("image/jpeg", 0.9))
      }
      img.onerror = () => reject(new Error("Could not process image."))
      img.src = cropSource
    })

    updateProfile("avatar", output)
    setCropSource(null)
    setImageSize(null)
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
  }, [cropOffset.x, cropOffset.y, cropSource, cropZoom, getBaseScale, imageSize, updateProfile])

  const updateApp = (key: string, value: boolean | string | null) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      app: { ...settings.app, [key]: value },
    }
    autoSave(newSettings)
  }

  const handleBootMusicUpload = useCallback(async (file: File) => {
    if (!settings) return

    const isMp3 = file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3")
    if (!isMp3) {
      setBootMusicError("Only MP3 files are supported.")
      return
    }

    // Soft upper bound to avoid excessive memory/disk usage.
    if (file.size > 20 * 1024 * 1024) {
      setBootMusicError("File is too large. Max size is 20MB.")
      return
    }
    const asset = await saveBootMusicBlob(file, file.name)
    await setActiveBootMusicAsset(asset.id)
    await refreshMediaLibraries()

    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        // Keep this null going forward; IndexedDB stores the actual file.
        // Legacy installations may still have a previous data URL fallback.
        bootMusicDataUrl: null,
        bootMusicFileName: asset.fileName,
        bootMusicAssetId: asset.id,
      },
    }
    autoSave(newSettings)
    setBootMusicError(null)
  }, [settings, autoSave, refreshMediaLibraries])

  const removeBootMusic = useCallback(async () => {
    if (!settings) return
    const targetId = activeBootMusicAssetId || settings.app.bootMusicAssetId
    if (!targetId) return
    const remaining = bootMusicAssets.filter((asset) => asset.id !== targetId)
    const nextActive = remaining[0] ?? null
    try {
      await removeBootMusicAsset(targetId)
      await setActiveBootMusicAsset(nextActive?.id ?? null)
      await refreshMediaLibraries()
    } catch {}
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        bootMusicDataUrl: null,
        bootMusicFileName: nextActive?.fileName ?? null,
        bootMusicAssetId: nextActive?.id ?? null,
      },
    }
    autoSave(newSettings)
    setBootMusicError(null)
  }, [settings, autoSave, activeBootMusicAssetId, bootMusicAssets, refreshMediaLibraries])

  const handleBackgroundVideoUpload = useCallback(async (file: File) => {
    if (!settings) return

    const isMp4 = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4")
    if (!isMp4) {
      setBackgroundVideoError("Only MP4 files are supported.")
      return
    }

    // Soft upper bound to reduce large local storage pressure.
    if (file.size > 300 * 1024 * 1024) {
      setBackgroundVideoError("File is too large. Max size is 300MB.")
      return
    }

    const asset = await saveBackgroundVideoBlob(file, file.name)
    await setActiveBackgroundVideoAsset(asset.id)
    await refreshMediaLibraries()
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        darkModeBackground: "customVideo" as DarkBackgroundType,
        customBackgroundVideoDataUrl: null,
        customBackgroundVideoFileName: asset.fileName,
        customBackgroundVideoAssetId: asset.id,
      },
    }
    autoSave(newSettings)
    setBackgroundVideoError(null)
  }, [settings, autoSave, refreshMediaLibraries])

  const removeBackgroundVideo = useCallback(async () => {
    if (!settings) return
    const targetId = activeBackgroundVideoAssetId || settings.app.customBackgroundVideoAssetId
    if (!targetId) return
    const remaining = backgroundVideoAssets.filter((asset) => asset.id !== targetId)
    const nextActive = remaining[0] ?? null
    try {
      await removeBackgroundVideoAsset(targetId)
      await setActiveBackgroundVideoAsset(nextActive?.id ?? null)
      await refreshMediaLibraries()
    } catch {}
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        customBackgroundVideoDataUrl: null,
        customBackgroundVideoFileName: nextActive?.fileName ?? null,
        customBackgroundVideoAssetId: nextActive?.id ?? null,
        darkModeBackground:
          settings.app.darkModeBackground === "customVideo" && !nextActive
            ? "floatingLines"
            : settings.app.darkModeBackground as DarkBackgroundType,
      },
    }
    autoSave(newSettings)
    setBackgroundVideoError(null)
  }, [settings, autoSave, activeBackgroundVideoAssetId, backgroundVideoAssets, refreshMediaLibraries])

  const updateNotifications = (key: string, value: boolean) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      notifications: { ...settings.notifications, [key]: value },
    }
    autoSave(newSettings)
  }

  const updatePersonalization = (key: string, value: string | string[]) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      personalization: { ...settings.personalization, [key]: value },
    }
    autoSave(newSettings)
  }

  const selectBootMusicAsset = useCallback((assetId: string | null) => {
    if (!settings) return
    const selected = assetId ? bootMusicAssets.find((asset) => asset.id === assetId) ?? null : null
    setActiveBootMusicAsset(assetId)
      .then(refreshMediaLibraries)
      .catch(() => {})
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        bootMusicDataUrl: null,
        bootMusicFileName: selected?.fileName ?? null,
        bootMusicAssetId: selected?.id ?? null,
      },
    }
    autoSave(newSettings)
  }, [settings, bootMusicAssets, autoSave, refreshMediaLibraries])

  const selectBackgroundVideoAsset = useCallback((assetId: string | null) => {
    if (!settings) return
    const selected = assetId ? backgroundVideoAssets.find((asset) => asset.id === assetId) ?? null : null
    setActiveBackgroundVideoAsset(assetId)
      .then(refreshMediaLibraries)
      .catch(() => {})
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        customBackgroundVideoDataUrl: null,
        customBackgroundVideoFileName: selected?.fileName ?? null,
        customBackgroundVideoAssetId: selected?.id ?? null,
        darkModeBackground: (
          selected ? "customVideo" : (settings.app.darkModeBackground === "customVideo" ? "floatingLines" : settings.app.darkModeBackground)
        ) as DarkBackgroundType,
      },
    }
    autoSave(newSettings)
  }, [settings, backgroundVideoAssets, autoSave, refreshMediaLibraries])

  useEffect(() => {
    if (!isOpen || !spotlightScopeRef.current || !(settings?.app.spotlightEnabled ?? true)) return
    const scope = spotlightScopeRef.current
    const spotlight = document.createElement("div")
    spotlight.className = "fx-spotlight-overlay"
    scope.appendChild(spotlight)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = scope.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      scope.style.setProperty("--fx-overlay-x", `${mouseX}px`)
      scope.style.setProperty("--fx-overlay-y", `${mouseY}px`)
      scope.style.setProperty("--fx-overlay-opacity", "1")

      const cards = scope.querySelectorAll<HTMLElement>(".fx-spotlight-card")
      const proximity = 70
      const fadeDistance = 140

      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const centerX = cardRect.left + cardRect.width / 2
        const centerY = cardRect.top + cardRect.height / 2
        const distance =
          Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
        const effectiveDistance = Math.max(0, distance)

        let glowIntensity = 0
        if (effectiveDistance <= proximity) {
          glowIntensity = 1
        } else if (effectiveDistance <= fadeDistance) {
          glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
        }

        const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
        const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
        card.style.setProperty("--glow-x", `${relativeX}%`)
        card.style.setProperty("--glow-y", `${relativeY}%`)
        card.style.setProperty("--glow-intensity", glowIntensity.toString())
        card.style.setProperty("--glow-radius", "120px")

      })
    }

    const handleMouseLeave = () => {
      scope.style.setProperty("--fx-overlay-opacity", "0")
      const cards = scope.querySelectorAll<HTMLElement>(".fx-spotlight-card")
      cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
    }

    scope.addEventListener("mousemove", handleMouseMove)
    scope.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      scope.removeEventListener("mousemove", handleMouseMove)
      scope.removeEventListener("mouseleave", handleMouseLeave)
      spotlight.remove()
    }
  }, [isOpen, settings?.app.spotlightEnabled])

  if (!isOpen) return null

  const sections = [
    { id: "profile", label: "Profile", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "audio", label: "Audio & Voice", icon: Volume2 },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "personalization", label: "Personalization", icon: Sparkles },
    { id: "bootup", label: "Bootup", icon: Power },
    { id: "access", label: "Account", icon: Shield },
  ]
  const NONE_OPTION = "__none__"
  const activeBootMusic = bootMusicAssets.find((asset) => asset.id === (activeBootMusicAssetId || settings?.app.bootMusicAssetId)) ?? null
  const activeBackgroundVideo =
    backgroundVideoAssets.find((asset) => asset.id === (activeBackgroundVideoAssetId || settings?.app.customBackgroundVideoAssetId)) ?? null
  const bootMusicOptions = [
    { value: NONE_OPTION, label: "None" },
    ...bootMusicAssets.map((asset) => ({ value: asset.id, label: asset.fileName })),
  ]
  const backgroundVideoOptions = [
    { value: NONE_OPTION, label: "None" },
    ...backgroundVideoAssets.map((asset) => ({ value: asset.id, label: asset.fileName })),
  ]

  return (
    <div style={paletteVars} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 backdrop-blur-[2px]",
          isLight ? "bg-[#0a122433]" : "bg-[#010409]/80",
        )}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={spotlightScopeRef}
        style={{ "--fx-overlay-x": "50%", "--fx-overlay-y": "50%", "--fx-overlay-opacity": "0" } as CSSProperties}
        className={cn(
          "fx-spotlight-shell relative z-10 w-full max-w-6xl h-[min(92vh,820px)] rounded-3xl border overflow-hidden",
          "flex flex-col md:flex-row bg-[var(--settings-bg)] border-[var(--settings-border)]",
          isLight
            ? "shadow-[0_28px_68px_-30px_rgba(45,78,132,0.4)]"
            : "shadow-[0_30px_85px_-34px_rgba(6,12,22,0.9)]",
        )}
      >
        {/* Nav */}
        <div className="md:w-60 bg-[var(--settings-bg)] border-b md:border-b-0 md:border-r border-[var(--settings-border)] flex flex-col shrink-0">
          <div className="px-4 py-4 border-b border-[var(--settings-border)]">
            <h2 className="text-base sm:text-lg font-semibold text-s-90 tracking-tight">Settings</h2>
            <p className="text-xs text-s-40 mt-1">Tune Nova to your workflow</p>
          </div>

          <div className="no-scrollbar flex-1 p-2.5 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden">
            <div className="flex md:flex-col gap-1.5 min-w-max md:min-w-0">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`fx-spotlight-card fx-border-glow whitespace-nowrap md:w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                    isActive
                      ? "bg-[var(--settings-selected-bg)] text-accent border border-accent-30 shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.18)]"
                      : "text-s-50 border border-transparent hover:bg-[var(--settings-hover)] hover:text-s-80 hover:border-[var(--settings-sub-border)]"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {section.label}
                </button>
              )
            })}
            </div>
          </div>

          <div className="p-3 border-t border-[var(--settings-border)] hidden md:block">
            <Button
              onClick={handleReset}
              variant="ghost"
              size="sm"
              className="fx-spotlight-card fx-border-glow w-full gap-2 text-s-40 hover:text-s-60 hover:bg-[var(--settings-hover)] h-9 transition-colors duration-150"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default
            </Button>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--settings-bg)]">
          {/* Header with close */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[var(--settings-border)] bg-[var(--settings-bg)]">
            <h3 className="text-sm font-medium text-s-50 uppercase tracking-wider">
              {sections.find((s) => s.id === activeSection)?.label}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleReset}
                variant="ghost"
                size="sm"
                className="md:hidden fx-spotlight-card fx-border-glow gap-2 text-s-40 hover:text-s-60 hover:bg-[var(--settings-hover)]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </Button>
              <button
                onClick={onClose}
                className="fx-spotlight-card fx-border-glow p-2 rounded-xl hover:bg-[var(--settings-hover)] text-s-40 hover:text-s-70 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 bg-[var(--settings-bg)]">
            {!settings ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Profile Section */}
                {activeSection === "profile" && (
                  <div className="space-y-5">
                    {/* Avatar */}
                    <div className="fx-spotlight-card fx-border-glow flex items-center gap-4 p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden"
                        style={{
                          background: `linear-gradient(to bottom right, var(--accent-primary), var(--accent-secondary))`,
                          boxShadow: `0 10px 15px -3px rgba(var(--accent-rgb), 0.2)`
                        }}
                      >
                        {settings.profile.avatar ? (
                          <NextImage
                            src={settings.profile.avatar}
                            alt="Avatar"
                            width={56}
                            height={56}
                            unoptimized
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-7 h-7 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-s-70">Profile Picture</p>
                        <p className="text-xs text-s-30">Upload a custom avatar</p>
                        {avatarError && (
                          <p className="text-xs text-red-400 mt-1">{avatarError}</p>
                        )}
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            await handleAvatarUpload(file)
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Failed to upload image."
                            setAvatarError(msg)
                          } finally {
                            inputEl.value = ""
                          }
                        }}
                      />
                      <Button
                        onClick={() => avatarInputRef.current?.click()}
                        variant="outline"
                        size="sm"
                        className="fx-spotlight-card fx-border-glow gap-2 text-s-50 border-[var(--settings-sub-border)] hover:border-accent-30 hover:text-accent hover:bg-accent-10 transition-colors duration-150"
                      >
                        <Camera className="w-4 h-4" />
                        Upload
                      </Button>
                    </div>

                    {/* Name */}
                    <SettingInput
                      label="Display Name"
                      description="Your name shown in the interface"
                      value={settings.profile.name}
                      onChange={(v) => updateProfile("name", v)}
                    />
                  </div>
                )}

                {/* Appearance Section */}
                {activeSection === "appearance" && (
                  <div className="space-y-5">
                    {/* Theme */}
                    <SettingSelect
                      label="Theme"
                      description="Choose your color scheme"
                      isLight={isLight}
                      value={settings.app.theme}
                      options={[
                        { value: "dark", label: "Dark" },
                        { value: "light", label: "Light" },
                        { value: "system", label: "System" },
                      ]}
                      onChange={(v) => {
                        setThemeSetting(v as "dark" | "light" | "system")
                        // Also update local state so UI stays in sync
                        setSettings(prev => prev ? { ...prev, app: { ...prev.app, theme: v as "dark" | "light" | "system" } } : prev)
                      }}
                    />

                    {/* Accent Color */}
                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">Accent Color</p>
                      <p className="text-xs text-s-30 mb-4">Choose your UI accent color</p>
                      <div className="flex gap-3 flex-wrap">
                        {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => {
                          const isSelected = settings.app.accentColor === color
                          return (
                            <button
                              key={color}
                              onClick={() => {
                                playClickSound()
                                setAccentColor(color)
                                // Also update local state so UI stays in sync
                                setSettings(prev => prev ? { ...prev, app: { ...prev.app, accentColor: color } } : prev)
                              }}
                              className={`fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                                isSelected
                                  ? "bg-[var(--settings-selected-bg)] border-accent-30"
                                  : "bg-[var(--settings-sub-bg)] border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)]"
                              }`}
                              style={{
                                backgroundColor: ACCENT_COLORS[color].primary,
                              }}
                              title={ACCENT_COLORS[color].name}
                            >
                              {isSelected && (
                                <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                                  <Check className="w-3.5 h-3.5 text-accent" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Orb Color */}
                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">Nova Orb Color</p>
                      <p className="text-xs text-s-30 mb-4">Choose the orb color on the home screen</p>
                      <div className="flex gap-3 flex-wrap">
                        {(Object.keys(ORB_COLORS) as OrbColor[]).map((color) => {
                          const palette = ORB_COLORS[color]
                          const isSelected = settings.app.orbColor === color
                          return (
                            <button
                              key={color}
                              onClick={() => {
                                playClickSound()
                                updateApp("orbColor", color)
                              }}
                              className={`fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                                isSelected
                                  ? "bg-[var(--settings-selected-bg)] border-accent-30"
                                  : "bg-[var(--settings-sub-bg)] border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)]"
                              }`}
                              style={{
                                background: `linear-gradient(135deg, ${palette.circle1}, ${palette.circle2})`,
                              }}
                              title={palette.name}
                            >
                              {isSelected && (
                                <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                                  <Check className="w-3.5 h-3.5 text-accent" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <SettingSelect
                      label="Background"
                      description="Choose the app background"
                      isLight={isLight}
                      value={settings.app.darkModeBackground}
                      options={(Object.entries(DARK_BACKGROUNDS) as [DarkBackgroundType, { name: string; description: string }][]).map(([value, info]) => ({
                        value,
                        label: info.name,
                      }))}
                      onChange={(v) => updateApp("darkModeBackground", v)}
                    />

                    <div className={cn(SETTINGS_CARD_BASE, "p-4")}>
                      <p className="text-sm text-s-70 mb-1">Custom Background</p>
                      <p className="text-xs text-s-30 mb-3">Upload your Background</p>
                      <input
                        ref={backgroundVideoInputRef}
                        type="file"
                        accept=".mp4,video/mp4"
                        className="hidden"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            await handleBackgroundVideoUpload(file)
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Failed to upload background video."
                            setBackgroundVideoError(msg)
                          } finally {
                            inputEl.value = ""
                          }
                        }}
                      />
                      <div className="flex items-center gap-2 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] p-1.5">
                        <div className="min-w-[220px] flex-[1.2]">
                          <FluidSelect
                            value={(activeBackgroundVideo?.id ?? NONE_OPTION)}
                            isLight={isLight}
                            options={backgroundVideoOptions}
                            onChange={(v) => {
                              playClickSound()
                              selectBackgroundVideoAsset(v === NONE_OPTION ? null : v)
                            }}
                          />
                        </div>
                        <div className="flex-1 px-3 py-2 rounded-md text-sm bg-[var(--settings-sub-bg)] text-s-50 border border-[var(--settings-sub-border)] whitespace-nowrap overflow-hidden text-ellipsis">
                          {activeBackgroundVideo?.fileName || "No background selected"}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              playClickSound()
                              backgroundVideoInputRef.current?.click()
                            }}
                            className={cn(
                              "fx-spotlight-card fx-border-glow group relative h-8 w-8 flex items-center justify-center text-2xl leading-none transition-all duration-150 hover:rotate-12",
                              isLight ? "text-s-50" : "text-s-40",
                            )}
                            aria-label={activeBackgroundVideo ? "Add background" : "Upload background"}
                            title={activeBackgroundVideo ? "Add background" : "Upload background"}
                          >
                            <span
                              className={cn(
                                "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                                isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                              )}
                            >
                              Upload your Background
                            </span>
                            +
                          </button>
                          {activeBackgroundVideo && (
                            <button
                              onClick={() => {
                                playClickSound()
                                removeBackgroundVideo()
                              }}
                              className={cn(
                                "fx-spotlight-card fx-border-glow h-8 px-3 rounded-md border text-xs font-medium transition-all duration-150 hover:-translate-y-[1px] active:translate-y-0",
                                isLight
                                  ? "border-red-300/70 bg-red-100 text-red-700 hover:bg-red-200 hover:border-red-400"
                                  : "border-red-400/50 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:border-red-300/70",
                              )}
                            >
                              Remove Selected
                            </button>
                          )}
                        </div>
                      </div>
                      {backgroundVideoError && (
                        <p className="text-xs text-red-400 mt-2">{backgroundVideoError}</p>
                      )}
                    </div>

                    <SettingToggle
                      label="Spotlight Effects"
                      description="Enable cursor spotlight and glow hover effects"
                      checked={settings.app.spotlightEnabled}
                      onChange={(v) => updateApp("spotlightEnabled", v)}
                    />

                    {/* Compact Mode */}
                    <SettingToggle
                      label="Compact Mode"
                      description="Reduce spacing for denser layout"
                      checked={settings.app.compactMode}
                      onChange={(v) => updateApp("compactMode", v)}
                    />

                    {/* Font Size */}
                    <SettingSelect
                      label="Font Size"
                      description="Adjust text size"
                      isLight={isLight}
                      value={settings.app.fontSize}
                      options={[
                        { value: "small", label: "Small" },
                        { value: "medium", label: "Medium" },
                        { value: "large", label: "Large" },
                      ]}
                      onChange={(v) => updateApp("fontSize", v)}
                    />

                  </div>
                )}

                {/* Audio & Voice Section */}
                {activeSection === "audio" && (
                  <div className="space-y-5">
                    <SettingToggle
                      label="Sound Effects"
                      description="Play sounds for actions and notifications"
                      checked={settings.app.soundEnabled}
                      onChange={(v) => updateApp("soundEnabled", v)}
                    />

                    <SettingToggle
                      label="Voice Responses"
                      description="Enable Nova's voice synthesis"
                      checked={settings.app.voiceEnabled}
                      onChange={(v) => {
                        updateApp("voiceEnabled", v)
                        // Send voiceEnabled preference to agent immediately
                        try {
                          const ws = new WebSocket("ws://localhost:8765")
                          ws.onopen = () => {
                            ws.send(JSON.stringify({ type: "set_voice", ttsVoice: settings.app.ttsVoice, voiceEnabled: v }))
                            ws.close()
                          }
                        } catch {}
                      }}
                    />

                    {/* TTS Voice Selection */}
                    <div className={cn(SETTINGS_CARD_BASE, "p-4")}>
                      <p className="text-sm text-s-70 mb-1">TTS Voice</p>
                      <p className="text-xs text-s-30 mb-3">Choose Nova&apos;s speaking voice</p>
                      <FluidSelect
                        value={settings.app.ttsVoice}
                        isLight={isLight}
                        options={TTS_VOICES.map((voice) => ({ value: voice.id, label: voice.name }))}
                        onChange={(voiceId) => {
                          playClickSound()
                          updateApp("ttsVoice", voiceId)
                          try {
                            const ws = new WebSocket("ws://localhost:8765")
                            ws.onopen = () => {
                              ws.send(JSON.stringify({ type: "set_voice", ttsVoice: voiceId }))
                              ws.close()
                            }
                          } catch {}
                        }}
                      />
                      <p className="text-xs text-s-30 mt-3">
                        {TTS_VOICES.find((voice) => voice.id === settings.app.ttsVoice)?.description}
                      </p>
                    </div>
                  </div>
                )}

                {/* Notifications Section */}
                {activeSection === "notifications" && (
                  <div className="space-y-5">
                    <SettingToggle
                      label="Enable Notifications"
                      description="Receive alerts from Nova"
                      checked={settings.notifications.enabled}
                      onChange={(v) => updateNotifications("enabled", v)}
                    />

                    <SettingToggle
                      label="Notification Sounds"
                      description="Play sound when notifications arrive"
                      checked={settings.notifications.sound}
                      onChange={(v) => updateNotifications("sound", v)}
                    />

                    <SettingToggle
                      label="Telegram Alerts"
                      description="Show alerts for Telegram messages"
                      checked={settings.notifications.telegramAlerts}
                      onChange={(v) => updateNotifications("telegramAlerts", v)}
                    />

                    <SettingToggle
                      label="System Updates"
                      description="Notify about system status changes"
                      checked={settings.notifications.systemUpdates}
                      onChange={(v) => updateNotifications("systemUpdates", v)}
                    />
                  </div>
                )}

                {/* Personalization Section */}
                {activeSection === "personalization" && (
                  <div className="space-y-5">
                    <div className="p-4 rounded-xl bg-accent-10 border border-accent-30 transition-colors duration-150 hover:bg-accent-15 mb-4">
                      <p className="text-sm text-accent-secondary">
                        Help Nova understand you better by filling in these details.
                        This information helps personalize your experience.
                      </p>
                    </div>

                    <SettingInput
                      label="Nickname"
                      description="What should Nova call you?"
                      value={settings.personalization.nickname}
                      onChange={(v) => updatePersonalization("nickname", v)}
                      placeholder="e.g., Boss, Chief, Captain..."
                    />

                    <SettingInput
                      label="Occupation"
                      description="Your profession or role"
                      value={settings.personalization.occupation}
                      onChange={(v) => updatePersonalization("occupation", v)}
                      placeholder="e.g., Software Developer, Designer..."
                    />

                    <SettingInput
                      label="Preferred Language"
                      description="Your preferred language for responses"
                      value={settings.personalization.preferredLanguage}
                      onChange={(v) => updatePersonalization("preferredLanguage", v)}
                    />

                    <SettingSelect
                      label="Communication Style"
                      description="How formal should Nova be?"
                      isLight={isLight}
                      value={settings.personalization.communicationStyle}
                      options={[
                        { value: "formal", label: "Formal" },
                        { value: "professional", label: "Professional" },
                        { value: "friendly", label: "Friendly" },
                        { value: "casual", label: "Casual" },
                      ]}
                      onChange={(v) => updatePersonalization("communicationStyle", v)}
                    />

                    <SettingSelect
                      label="Response Tone"
                      description="Nova's conversational tone"
                      isLight={isLight}
                      value={settings.personalization.tone}
                      options={[
                        { value: "neutral", label: "Neutral" },
                        { value: "enthusiastic", label: "Enthusiastic" },
                        { value: "calm", label: "Calm" },
                        { value: "direct", label: "Direct" },
                      ]}
                      onChange={(v) => updatePersonalization("tone", v)}
                    />

                    <SettingTextarea
                      label="Your Characteristics"
                      description="Describe yourself - personality traits, preferences, quirks"
                      value={settings.personalization.characteristics}
                      onChange={(v) => updatePersonalization("characteristics", v)}
                      placeholder="e.g., I'm detail-oriented, prefer concise answers, work late nights..."
                      rows={3}
                    />

                    <SettingTextarea
                      label="Custom Instructions"
                      description="Special instructions for Nova to follow"
                      value={settings.personalization.customInstructions}
                      onChange={(v) => updatePersonalization("customInstructions", v)}
                      placeholder="e.g., Always provide code examples in Python, remind me to take breaks..."
                      rows={4}
                    />
                  </div>
                )}

                {/* Bootup Section */}
                {activeSection === "bootup" && (
                  <div className="space-y-5">
                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)] mb-4">
                      <p className="text-sm text-s-70">
                        Configure Nova startup behavior. This section is dedicated to boot experience settings.
                      </p>
                    </div>

                    <SettingToggle
                      label="Boot Animation"
                      description="Show startup sequence on launch"
                      checked={settings.app.bootAnimationEnabled}
                      onChange={(v) => updateApp("bootAnimationEnabled", v)}
                    />

                    <SettingToggle
                      label="Bootup Music"
                      description="Enable custom boot music on launch"
                      checked={settings.app.bootMusicEnabled}
                      onChange={(v) => updateApp("bootMusicEnabled", v)}
                    />

                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">Bootup Music</p>
                      <p className="text-xs text-s-30 mb-3">Plays the first 30 seconds on launch. Upload once, switch anytime.</p>
                      <input
                        ref={bootMusicInputRef}
                        type="file"
                        accept=".mp3,audio/mpeg"
                        className="hidden"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            await handleBootMusicUpload(file)
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Failed to upload boot music."
                            setBootMusicError(msg)
                          } finally {
                            inputEl.value = ""
                          }
                        }}
                      />
                      <div className="mb-3">
                        <FluidSelect
                          value={(activeBootMusic?.id ?? NONE_OPTION)}
                          isLight={isLight}
                          options={bootMusicOptions}
                          onChange={(v) => {
                            playClickSound()
                            selectBootMusicAsset(v === NONE_OPTION ? null : v)
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] p-1.5 max-w-[560px] mx-auto">
                        <div className="flex-1 px-3 py-2 rounded-md text-sm bg-[var(--settings-sub-bg)] text-s-50 border border-[var(--settings-sub-border)]">
                          {activeBootMusic?.fileName || "No MP3 selected"}
                        </div>
                        <button
                          onClick={() => {
                            playClickSound()
                            bootMusicInputRef.current?.click()
                          }}
                            className={cn(
                            "fx-spotlight-card fx-border-glow group relative h-8 w-8 flex items-center justify-center text-2xl leading-none transition-all duration-150 hover:rotate-12",
                            isLight ? "text-s-50" : "text-s-40",
                          )}
                          aria-label={activeBootMusic ? "Add MP3" : "Upload MP3"}
                          title={activeBootMusic ? "Add MP3" : "Upload MP3"}
                        >
                          <span
                            className={cn(
                              "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                              isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                            )}
                          >
                            Upload MP3
                          </span>
                          +
                        </button>
                      </div>
                      {activeBootMusic && (
                        <div className="mt-2">
                          <Button
                            onClick={() => {
                              playClickSound()
                              removeBootMusic()
                            }}
                            variant="outline"
                            size="sm"
                            className="fx-spotlight-card fx-border-glow text-s-50 border-[var(--settings-sub-border)] hover:border-red-500/40 hover:text-red-300 hover:bg-red-500/10 transition-colors duration-150"
                          >
                            Remove Selected
                          </Button>
                        </div>
                      )}
                      {bootMusicError && (
                        <p className="text-xs text-red-400 mt-2">{bootMusicError}</p>
                      )}
                    </div>

                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">More Boot Settings</p>
                      <p className="text-xs text-s-30">
                        Additional bootup options will appear here as they are added.
                      </p>
                    </div>
                  </div>
                )}

                {/* Access Level Section */}
                {activeSection === "access" && (
                  <div className="space-y-5">
                    <div className="fx-spotlight-card fx-border-glow p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-accent-15 flex items-center justify-center">
                          <Shield className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm text-s-70">Current Tier</p>
                          <p className="text-lg text-accent font-mono">
                            {settings.profile.accessTier}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {ACCESS_TIERS.map((tier) => {
                          const isSelected = settings.profile.accessTier === tier
                          return (
                            <button
                              key={tier}
                              onClick={() => {
                                playClickSound()
                                updateProfile("accessTier", tier)
                              }}
                              className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow ${
                                isSelected
                                  ? "bg-[var(--settings-selected-bg)] border border-accent-30"
                                  : "bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)]"
                              }`}
                            >
                              <span
                                className={`text-sm transition-colors duration-200 ${
                                  isSelected
                                    ? "text-accent"
                                    : "text-s-50"
                                }`}
                              >
                                {tier}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {cropSource && imageSize && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="w-[360px] rounded-2xl border border-[var(--settings-border)] bg-[var(--settings-card-bg)] p-4">
            <h4 className="text-sm font-medium text-s-90">Adjust profile photo</h4>
            <p className="mt-1 text-xs text-s-40">Drag to reposition. Use zoom to crop.</p>

            <div className="mt-4 flex justify-center">
              <div
                className="relative h-[240px] w-[240px] overflow-hidden rounded-full border border-[var(--settings-sub-border)] bg-[var(--settings-sub-bg)] cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.preventDefault()
                  const target = e.currentTarget
                  target.setPointerCapture(e.pointerId)
                  setDragStart({ x: e.clientX, y: e.clientY, offsetX: cropOffset.x, offsetY: cropOffset.y })
                }}
                onPointerMove={(e) => {
                  if (!dragStart) return
                  const next = {
                    x: dragStart.offsetX + (e.clientX - dragStart.x),
                    y: dragStart.offsetY + (e.clientY - dragStart.y),
                  }
                  setCropOffset(clampOffset(next, cropZoom, imageSize))
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  setDragStart(null)
                }}
                onPointerCancel={() => setDragStart(null)}
              >
                <NextImage
                  src={cropSource}
                  alt="Crop preview"
                  width={imageSize.width}
                  height={imageSize.height}
                  unoptimized
                  draggable={false}
                  className="absolute left-1/2 top-1/2 select-none"
                  style={{
                    width: `${imageSize.width * getBaseScale(imageSize) * cropZoom}px`,
                    height: `${imageSize.height * getBaseScale(imageSize) * cropZoom}px`,
                    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px))`,
                    maxWidth: "none",
                  }}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-s-50">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={cropZoom}
                onChange={(e) => {
                  const nextZoom = Number(e.target.value)
                  setCropZoom(nextZoom)
                  setCropOffset((prev) => clampOffset(prev, nextZoom, imageSize))
                }}
                className="w-full accent-violet-500"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCropSource(null)
                  setImageSize(null)
                  setDragStart(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={saveCroppedAvatar}>Save Photo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_CARD_BASE =
  "fx-spotlight-card fx-border-glow rounded-xl border border-[var(--settings-border)] bg-[var(--settings-card-bg)] transition-all duration-150 hover:bg-[var(--settings-card-hover)]"
const SETTINGS_FIELD_BASE =
  "w-full px-3 py-2.5 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] text-s-90 text-sm placeholder:text-s-25 focus:outline-none focus:border-accent-50 focus:bg-[var(--settings-hover)] transition-colors duration-150"

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const handleChange = (newValue: boolean) => {
    playClickSound()
    onChange(newValue)
  }

  return (
    <div
      className={cn(
        SETTINGS_CARD_BASE,
        "group flex items-center justify-between gap-4 p-4 cursor-pointer select-none",
      )}
      onClick={() => handleChange(!checked)}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-s-70 group-hover:text-s-90 transition-colors">{label}</p>
        <p className="text-xs text-s-30 mt-0.5">{description}</p>
      </div>
      <NovaSwitch checked={checked} onChange={handleChange} />
    </div>
  )
}

function SettingInput({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className={cn(SETTINGS_CARD_BASE, "p-4")}>
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={SETTINGS_FIELD_BASE}
      />
    </div>
  )
}

function SettingTextarea({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div className={cn(SETTINGS_CARD_BASE, "p-4")}>
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(SETTINGS_FIELD_BASE, "resize-none")}
      />
    </div>
  )
}

function SettingSelect({
  label,
  description,
  value,
  isLight,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  isLight: boolean
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className={cn(SETTINGS_CARD_BASE, "p-4")}>
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <FluidSelect
        value={value}
        options={options}
        isLight={isLight}
        onChange={(v) => {
          playClickSound()
          onChange(v)
        }}
      />
    </div>
  )
}
