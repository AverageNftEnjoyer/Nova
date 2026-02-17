"use client"

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react"
import NextImage from "next/image"
import { useRouter } from "next/navigation"
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
  ChevronRight,
  Mail,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"
import { setActiveUserId } from "@/lib/active-user"
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
} from "@/lib/media/bootMusicStorage"
import {
  saveBackgroundVideoBlob,
  removeBackgroundVideoAsset,
  listBackgroundVideoAssets,
  getActiveBackgroundVideoAssetId,
  setActiveBackgroundVideoAsset,
  isBackgroundAssetImage,
  type BackgroundVideoAssetMeta,
} from "@/lib/media/backgroundVideoStorage"
import {
  loadUserSettings,
  saveUserSettings,
  resetSettings,
  type UserSettings,
  type AccentColor,
  type OrbColor,
  type DarkBackgroundType,
  ACCENT_COLORS,
  ORB_COLORS,
  TTS_VOICES,
  DARK_BACKGROUNDS,
} from "@/lib/userSettings"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"

const AVATAR_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const BACKGROUND_IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp|svg)$/i
const BACKGROUND_VIDEO_FILE_PATTERN = /\.(mp4)$/i

// Play click sound for settings interactions (respects soundEnabled setting)
function playClickSound() {
  try {
    const settings = loadUserSettings()
    if (!settings.app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.9
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {}
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type CropOffset = { x: number; y: number }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const router = useRouter()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [activeSection, setActiveSection] = useState<string>("profile")
  const [authConfigured, setAuthConfigured] = useState(false)
  const [authAuthenticated, setAuthAuthenticated] = useState(false)
  const [authEmail, setAuthEmail] = useState("")
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState("")
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [pendingEmail, setPendingEmail] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountMessage, setAccountMessage] = useState("")
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [bootMusicError, setBootMusicError] = useState<string | null>(null)
  const [backgroundVideoError, setBackgroundVideoError] = useState<string | null>(null)
  const [bootMusicAssets, setBootMusicAssets] = useState<BootMusicAssetMeta[]>([])
  const [activeBootMusicAssetId, setActiveBootMusicAssetId] = useState<string | null>(null)
  const [backgroundVideoAssets, setBackgroundVideoAssets] = useState<BackgroundVideoAssetMeta[]>([])
  const [activeBackgroundVideoAssetId, setActiveBackgroundVideoAssetId] = useState<string | null>(null)
  const [memoryMarkdown, setMemoryMarkdown] = useState("")
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySaving, setMemorySaving] = useState(false)
  const [memoryDirty, setMemoryDirty] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memorySavedAt, setMemorySavedAt] = useState<number | null>(null)
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
  const workspaceSyncTimeoutRef = useRef<number | null>(null)
  const lastWorkspaceSyncPayloadRef = useRef<string>("")
  const pendingWorkspaceSyncPayloadRef = useRef<string>("")
  const pendingWorkspaceSyncDataRef = useRef<Record<string, unknown> | null>(null)
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

  const loadMemoryMarkdown = useCallback(async () => {
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      const res = await fetch("/api/workspace/memory-md", { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; content?: string; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load MEMORY.md")
      }
      setMemoryMarkdown(String(data.content || ""))
      setMemoryDirty(false)
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Failed to load MEMORY.md")
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  const saveMemoryMarkdown = useCallback(async () => {
    setMemorySaving(true)
    setMemoryError(null)
    try {
      const res = await fetch("/api/workspace/memory-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memoryMarkdown }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save MEMORY.md")
      }
      setMemoryDirty(false)
      setMemorySavedAt(Date.now())
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Failed to save MEMORY.md")
    } finally {
      setMemorySaving(false)
    }
  }, [memoryMarkdown])

  const pushWorkspaceContextSync = useCallback(async (payload: Record<string, unknown>, serialized: string) => {
    try {
      const res = await fetch("/api/workspace/context-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      })
      if (!res.ok) {
        if (lastWorkspaceSyncPayloadRef.current === serialized) {
          lastWorkspaceSyncPayloadRef.current = ""
        }
        return
      }
      lastWorkspaceSyncPayloadRef.current = serialized
      if (pendingWorkspaceSyncPayloadRef.current === serialized) {
        pendingWorkspaceSyncPayloadRef.current = ""
        pendingWorkspaceSyncDataRef.current = null
      }
    } catch {
      if (lastWorkspaceSyncPayloadRef.current === serialized) {
        lastWorkspaceSyncPayloadRef.current = ""
      }
    }
  }, [])

  const queueWorkspaceContextSync = useCallback((nextSettings: UserSettings, options?: { immediate?: boolean }) => {
    if (typeof window === "undefined") return
    const payload: Record<string, unknown> = {
      assistantName: nextSettings.personalization.assistantName,
      userName: nextSettings.profile.name,
      nickname: nextSettings.personalization.nickname,
      occupation: nextSettings.personalization.occupation,
      preferredLanguage: nextSettings.personalization.preferredLanguage,
      communicationStyle: nextSettings.personalization.communicationStyle,
      tone: nextSettings.personalization.tone,
      characteristics: nextSettings.personalization.characteristics,
      customInstructions: nextSettings.personalization.customInstructions,
      interests: nextSettings.personalization.interests,
    }
    const serialized = JSON.stringify(payload)
    if (serialized === lastWorkspaceSyncPayloadRef.current) return
    if (serialized === pendingWorkspaceSyncPayloadRef.current) return
    pendingWorkspaceSyncPayloadRef.current = serialized
    pendingWorkspaceSyncDataRef.current = payload
    if (workspaceSyncTimeoutRef.current !== null) {
      window.clearTimeout(workspaceSyncTimeoutRef.current)
    }
    if (options?.immediate) {
      void pushWorkspaceContextSync(payload, serialized)
      return
    }
    workspaceSyncTimeoutRef.current = window.setTimeout(async () => {
      workspaceSyncTimeoutRef.current = null
      const nextPayload = pendingWorkspaceSyncDataRef.current
      const nextSerialized = pendingWorkspaceSyncPayloadRef.current
      if (!nextPayload || !nextSerialized) return
      void pushWorkspaceContextSync(nextPayload, nextSerialized)
    }, 650)
  }, [pushWorkspaceContextSync])

  const palette = {
    bg: isLight ? "#f6f8fc" : "rgba(255,255,255,0.04)",
    border: isLight ? "#d9e0ea" : "rgba(255,255,255,0.12)",
    hover: isLight ? "#eef3fb" : "rgba(255,255,255,0.08)",
    cardBg: isLight ? "#ffffff" : "rgba(0,0,0,0.2)",
    cardHover: isLight ? "#f7faff" : "rgba(255,255,255,0.06)",
    subBg: isLight ? "#f4f7fd" : "rgba(0,0,0,0.25)",
    subBorder: isLight ? "#d5dce8" : "rgba(255,255,255,0.1)",
    selectedBg: isLight ? "#edf3ff" : "rgba(255,255,255,0.08)",
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
      setAuthConfigured(true)
      setAccountMessage("")
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        setAuthAuthenticated(false)
        setAuthEmail("")
      } else {
      void supabaseBrowser.auth.getSession()
        .then(({ data }) => {
          if (cancelled) return
          setAuthAuthenticated(Boolean(data.session?.user))
          const nextEmail = String(data.session?.user?.email || "").trim()
          setAuthEmail(nextEmail)
          setPendingEmail(nextEmail)
        })
        .catch(() => {
          if (cancelled) return
          setAuthAuthenticated(false)
          setAuthEmail("")
          setPendingEmail("")
        })
      }
      void refreshMediaLibraries()
        .catch(() => {
          if (cancelled) return
          setBootMusicAssets([])
          setActiveBootMusicAssetId(null)
          setBackgroundVideoAssets([])
          setActiveBackgroundVideoAssetId(null)
        })
      void loadMemoryMarkdown()
    }
    return () => {
      cancelled = true
    }
  }, [isOpen, loadMemoryMarkdown, refreshMediaLibraries])

  const navigateToLogin = useCallback(() => {
    const nextPath = typeof window !== "undefined" ? window.location.pathname : "/home"
    router.push(`/login?next=${encodeURIComponent(nextPath || "/home")}`)
    onClose()
  }, [onClose, router])

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true)
    setAuthError("")
    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase client is not configured.")
      }
      const { error } = await supabaseBrowser.auth.signOut()
      if (error) throw error
      setActiveUserId(null)
      setAuthAuthenticated(false)
      setAuthEmail("")
      navigateToLogin()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign out.")
    } finally {
      setAuthBusy(false)
    }
  }, [navigateToLogin])

  const handleSendPasswordReset = useCallback(async () => {
    setAuthBusy(true)
    setAuthError("")
    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase client is not configured.")
      }
      const targetEmail = authEmail.trim()
      if (!targetEmail) {
        throw new Error("No account email found for this session.")
      }
      const redirectTo = `${window.location.origin}/login?mode=reset`
      const { error } = await supabaseBrowser.auth.resetPasswordForEmail(targetEmail, { redirectTo })
      if (error) throw error
      setAuthError("Reset link sent. Check your email.")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to send reset email.")
    } finally {
      setAuthBusy(false)
    }
  }, [authEmail])

  const handleRequestEmailChange = useCallback(async () => {
    setAccountBusy(true)
    setAccountMessage("")
    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase client is not configured.")
      }
      const nextEmail = pendingEmail.trim().toLowerCase()
      if (!nextEmail) {
        throw new Error("Enter a valid email.")
      }
      const { error } = await supabaseBrowser.auth.updateUser({ email: nextEmail })
      if (error) throw error
      setAccountMessage("Email update requested. Check both inboxes to confirm change.")
      setEmailModalOpen(false)
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to request email change.")
    } finally {
      setAccountBusy(false)
    }
  }, [pendingEmail])

  const handleDeleteAccount = useCallback(async () => {
    setAccountBusy(true)
    setAccountMessage("")
    try {
      const password = deletePassword.trim()
      if (!password) {
        throw new Error("Password is required.")
      }
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to permanently delete account.")
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase client is not configured.")
      }
      await supabaseBrowser.auth.signOut()
      setActiveUserId(null)
      navigateToLogin()
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to permanently delete account.")
    } finally {
      setAccountBusy(false)
    }
  }, [deletePassword, navigateToLogin])

  useEffect(() => {
    return () => {
      if (workspaceSyncTimeoutRef.current !== null) {
        window.clearTimeout(workspaceSyncTimeoutRef.current)
      }
      workspaceSyncTimeoutRef.current = null
      const pendingPayload = pendingWorkspaceSyncDataRef.current
      const pendingSerialized = pendingWorkspaceSyncPayloadRef.current
      if (pendingPayload && pendingSerialized) {
        void pushWorkspaceContextSync(pendingPayload, pendingSerialized)
      }
    }
  }, [pushWorkspaceContextSync])

  useEffect(() => {
    if (isOpen) return
    if (workspaceSyncTimeoutRef.current !== null) {
      window.clearTimeout(workspaceSyncTimeoutRef.current)
      workspaceSyncTimeoutRef.current = null
    }
    const pendingPayload = pendingWorkspaceSyncDataRef.current
    const pendingSerialized = pendingWorkspaceSyncPayloadRef.current
    if (pendingPayload && pendingSerialized) {
      void pushWorkspaceContextSync(pendingPayload, pendingSerialized)
    }
  }, [isOpen, pushWorkspaceContextSync])

  // Auto-save helper
  const autoSave = useCallback((newSettings: UserSettings, options?: { syncWorkspace?: boolean }) => {
    setSettings(newSettings)
    saveUserSettings(newSettings)
    if (options?.syncWorkspace) {
      queueWorkspaceContextSync(newSettings)
    }
  }, [queueWorkspaceContextSync])

  const handleReset = useCallback(() => {
    const fresh = resetSettings()
    setSettings(fresh)
    queueWorkspaceContextSync(fresh, { immediate: true })
  }, [queueWorkspaceContextSync])

  const updateProfile = useCallback((key: string, value: string | null) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      profile: { ...settings.profile, [key]: value },
    }
    autoSave(newSettings, { syncWorkspace: key === "name" })
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
    if (!AVATAR_ALLOWED_MIME_TYPES.has(file.type)) {
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

    const normalizedName = file.name.toLowerCase()
    const isVideo = file.type === "video/mp4" || BACKGROUND_VIDEO_FILE_PATTERN.test(normalizedName)
    const isImage = file.type.startsWith("image/") || BACKGROUND_IMAGE_FILE_PATTERN.test(normalizedName)
    if (!isVideo && !isImage) {
      setBackgroundVideoError("Only MP4, JPG, PNG, WEBP, or SVG files are supported.")
      return
    }

    // Soft upper bound to reduce large local storage pressure.
    if (isVideo && file.size > 300 * 1024 * 1024) {
      setBackgroundVideoError("File is too large. Max size is 300MB.")
      return
    }
    if (isImage && file.size > 25 * 1024 * 1024) {
      setBackgroundVideoError("Image is too large. Max size is 25MB.")
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
        customBackgroundVideoMimeType: asset.mimeType,
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
        customBackgroundVideoMimeType: nextActive?.mimeType ?? null,
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
    autoSave(newSettings, { syncWorkspace: true })
    if (key === "communicationStyle" || key === "tone") {
      queueWorkspaceContextSync(newSettings, { immediate: true })
    }
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
        customBackgroundVideoMimeType: selected?.mimeType ?? null,
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
      <button
        className={cn(
          "absolute inset-0 backdrop-blur-sm",
          isLight ? "bg-[#0a122433]" : "bg-black/45",
        )}
        onClick={onClose}
        aria-label="Close settings"
      />

      {/* Modal */}
      <div
        ref={spotlightScopeRef}
        style={{ "--fx-overlay-x": "50%", "--fx-overlay-y": "50%", "--fx-overlay-opacity": "0" } as CSSProperties}
        className={cn(
          "fx-spotlight-shell relative z-10 w-full max-w-6xl h-[min(92vh,820px)] rounded-2xl border overflow-hidden",
          "flex flex-col md:flex-row",
          isLight
            ? "border-[#d9e0ea] bg-white shadow-[0_28px_68px_-30px_rgba(45,78,132,0.4)]"
            : "border-white/20 bg-white/[0.06] backdrop-blur-2xl shadow-[0_20px_42px_-24px_rgba(120,170,255,0.45)]",
        )}
      >
        {/* Nav */}
        <div className={cn(
          "md:w-60 border-b md:border-b-0 md:border-r flex flex-col shrink-0",
          isLight
            ? "bg-[#f6f8fc] border-[#e2e8f2]"
            : "bg-black/30 border-white/10"
        )}>
          <div className={cn(
            "px-4 py-4 border-b",
            isLight ? "border-[#e2e8f2]" : "border-white/10"
          )}>
            <h2 className={cn("text-base sm:text-lg font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>Settings</h2>
            <p className={cn("text-xs mt-1", isLight ? "text-s-40" : "text-slate-400")}>Tune Nova to your workflow</p>
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
                  className={cn(
                    "fx-spotlight-card fx-border-glow whitespace-nowrap md:w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm transition-all duration-150",
                    isActive
                      ? isLight
                        ? "bg-[#edf3ff] text-accent border border-accent-30"
                        : "bg-white/8 text-accent border border-accent-30"
                      : isLight
                        ? "text-s-50 border border-transparent hover:bg-[#eef3fb] hover:text-s-80"
                        : "text-slate-400 border border-transparent hover:bg-white/[0.06] hover:text-slate-200"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {section.label}
                </button>
              )
            })}
            </div>
          </div>

          <div className={cn("p-3 border-t hidden md:block", isLight ? "border-[#e2e8f2]" : "border-white/10")}>
            <Button
              onClick={handleReset}
              variant="ghost"
              size="sm"
              className={cn(
                "fx-spotlight-card fx-border-glow w-full gap-2 h-9 transition-colors duration-150",
                isLight ? "text-s-40 hover:text-s-60 hover:bg-[#eef3fb]" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.06]"
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default
            </Button>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with close */}
          <div className={cn(
            "flex items-center justify-between px-4 sm:px-6 py-4 border-b",
            isLight ? "border-[#e2e8f2] bg-[#f9fbff]" : "border-white/10 bg-black/20"
          )}>
            <h3 className={cn("text-sm font-medium uppercase tracking-wider", isLight ? "text-s-50" : "text-slate-400")}>
              {sections.find((s) => s.id === activeSection)?.label}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleReset}
                variant="ghost"
                size="sm"
                className={cn(
                  "md:hidden fx-spotlight-card fx-border-glow gap-2",
                  isLight ? "text-s-40 hover:text-s-60 hover:bg-[#eef3fb]" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.06]"
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </Button>
              <button
                onClick={onClose}
                className={cn(
                  "fx-spotlight-card fx-border-glow h-8 w-8 rounded-md border inline-flex items-center justify-center transition-colors",
                  isLight ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]" : "border-white/12 bg-black/20 text-slate-300 hover:bg-white/8"
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
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
                    <div className={cn(
                      "fx-spotlight-card fx-border-glow flex items-center gap-4 p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
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
                        <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>Profile Picture</p>
                        <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>Upload a custom avatar</p>
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
                        className={cn(
                          "fx-spotlight-card fx-border-glow gap-2 transition-colors duration-150",
                          isLight
                            ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                            : "text-slate-400 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                        )}
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
                      isLight={isLight}
                    />

                    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>Memory</p>
                          <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>
                            Edit your full <code>MEMORY.md</code> directly. Nova reads this every turn.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => void loadMemoryMarkdown()}
                            variant="outline"
                            size="sm"
                            disabled={memoryLoading || memorySaving}
                            className={cn(
                              "fx-spotlight-card fx-border-glow",
                              isLight
                                ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                                : "text-slate-300 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                            )}
                          >
                            {memoryLoading ? "Loading..." : "Reload"}
                          </Button>
                          <Button
                            onClick={() => void saveMemoryMarkdown()}
                            size="sm"
                            disabled={memorySaving || memoryLoading || !memoryDirty}
                            className={cn(
                              "fx-spotlight-card fx-border-glow border text-white disabled:opacity-60",
                              isLight
                                ? "bg-emerald-600 border-emerald-700 hover:bg-emerald-700"
                                : "bg-emerald-500/80 border-emerald-300/60 hover:bg-emerald-500",
                            )}
                          >
                            {memorySaving ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                      <textarea
                        value={memoryMarkdown}
                        onChange={(e) => {
                          setMemoryMarkdown(e.target.value)
                          setMemoryDirty(true)
                          setMemorySavedAt(null)
                        }}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        data-gramm="false"
                        data-gramm_editor="false"
                        data-enable-grammarly="false"
                        rows={12}
                        className={cn(getSettingsFieldClass(isLight), "mt-3 min-h-[260px] font-mono text-xs leading-5")}
                        placeholder="# Persistent Memory"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>
                          {memoryMarkdown.length} chars
                        </p>
                        {memoryError ? (
                          <p className="text-xs text-red-400">{memoryError}</p>
                        ) : memoryDirty ? (
                          <p className={cn("text-xs", isLight ? "text-amber-600" : "text-amber-300")}>Unsaved changes</p>
                        ) : memorySavedAt ? (
                          <p className={cn("text-xs", isLight ? "text-emerald-600" : "text-emerald-300")}>Saved</p>
                        ) : null}
                      </div>
                    </div>
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
                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Accent Color</p>
                      <p className={cn("text-xs mb-4", isLight ? "text-s-30" : "text-slate-500")}>Choose your UI accent color</p>
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
                              className={cn(
                                "fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                                isSelected
                                  ? "border-accent-30"
                                  : isLight
                                    ? "border-[#d5dce8] hover:border-white/30"
                                    : "border-white/10 hover:border-white/20"
                              )}
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
                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Nova Orb Color</p>
                      <p className={cn("text-xs mb-4", isLight ? "text-s-30" : "text-slate-500")}>Choose the orb color on the home screen</p>
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
                              className={cn(
                                "fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                                isSelected
                                  ? "border-accent-30"
                                  : isLight
                                    ? "border-[#d5dce8] hover:border-white/30"
                                    : "border-white/10 hover:border-white/20"
                              )}
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

                    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Custom Background</p>
                      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>Upload an MP4 or image (JPG, PNG, WEBP, SVG)</p>
                      <input
                        ref={backgroundVideoInputRef}
                        type="file"
                        accept=".mp4,video/mp4,.jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            await handleBackgroundVideoUpload(file)
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Failed to upload background media."
                            setBackgroundVideoError(msg)
                          } finally {
                            inputEl.value = ""
                          }
                        }}
                      />
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg border p-1.5",
                        isLight ? "bg-white border-[#d5dce8]" : "bg-black/25 border-white/10"
                      )}>
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
                        <div className={cn(
                          "flex-1 px-3 py-2 rounded-md text-sm border whitespace-nowrap overflow-hidden text-ellipsis",
                          isLight ? "bg-white text-s-50 border-[#d5dce8]" : "bg-black/20 text-slate-400 border-white/10"
                        )}>
                          {activeBackgroundVideo
                            ? `${activeBackgroundVideo.fileName}${isBackgroundAssetImage(activeBackgroundVideo.mimeType, activeBackgroundVideo.fileName) ? " (Image)" : " (Video)"}`
                            : "No background selected"}
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
                              Upload Background
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
                      isLight={isLight}
                    />

                    {/* Compact Mode */}
                    <SettingToggle
                      label="Compact Mode"
                      description="Reduce spacing for denser layout"
                      checked={settings.app.compactMode}
                      onChange={(v) => updateApp("compactMode", v)}
                      isLight={isLight}
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
                      isLight={isLight}
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
                      isLight={isLight}
                    />

                    {/* TTS Voice Selection */}
                    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>TTS Voice</p>
                      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>Choose Nova&apos;s speaking voice</p>
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
                      <p className={cn("text-xs mt-3", isLight ? "text-s-30" : "text-slate-500")}>
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
                      isLight={isLight}
                    />

                    <SettingToggle
                      label="Notification Sounds"
                      description="Play sound when notifications arrive"
                      checked={settings.notifications.sound}
                      onChange={(v) => updateNotifications("sound", v)}
                      isLight={isLight}
                    />

                    <SettingToggle
                      label="Telegram Alerts"
                      description="Show alerts for Telegram messages"
                      checked={settings.notifications.telegramAlerts}
                      onChange={(v) => updateNotifications("telegramAlerts", v)}
                      isLight={isLight}
                    />

                    <SettingToggle
                      label="System Updates"
                      description="Notify about system status changes"
                      checked={settings.notifications.systemUpdates}
                      onChange={(v) => updateNotifications("systemUpdates", v)}
                      isLight={isLight}
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
                      label="Assistant Name"
                      description="What do you want to call your assistant?"
                      value={settings.personalization.assistantName}
                      onChange={(v) => updatePersonalization("assistantName", v)}
                      placeholder="e.g., Nova, Atlas..."
                      isLight={isLight}
                    />

                    <SettingInput
                      label="Nickname"
                      description="What should Nova call you?"
                      value={settings.personalization.nickname}
                      onChange={(v) => updatePersonalization("nickname", v)}
                      placeholder="e.g., Boss, Chief, Captain..."
                      isLight={isLight}
                    />

                    <SettingInput
                      label="Occupation"
                      description="Your profession or role"
                      value={settings.personalization.occupation}
                      onChange={(v) => updatePersonalization("occupation", v)}
                      placeholder="e.g., Software Developer, Designer..."
                      isLight={isLight}
                    />

                    <SettingInput
                      label="Preferred Language"
                      description="Your preferred language for responses"
                      value={settings.personalization.preferredLanguage}
                      onChange={(v) => updatePersonalization("preferredLanguage", v)}
                      isLight={isLight}
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
                      isLight={isLight}
                    />

                    <SettingTextarea
                      label="Custom Instructions"
                      description="Special instructions for Nova to follow"
                      value={settings.personalization.customInstructions}
                      onChange={(v) => updatePersonalization("customInstructions", v)}
                      placeholder="e.g., Always provide code examples in Python, remind me to take breaks..."
                      rows={4}
                      isLight={isLight}
                    />
                  </div>
                )}

                {/* Bootup Section */}
                {activeSection === "bootup" && (
                  <div className="space-y-5">
                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150 mb-4",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>
                        Configure Nova startup behavior. This section is dedicated to boot experience settings.
                      </p>
                    </div>

                    <SettingToggle
                      label="Boot Animation"
                      description="Show startup sequence on launch"
                      checked={settings.app.bootAnimationEnabled}
                      onChange={(v) => updateApp("bootAnimationEnabled", v)}
                      isLight={isLight}
                    />

                    <SettingToggle
                      label="Bootup Music"
                      description="Enable custom boot music on launch"
                      checked={settings.app.bootMusicEnabled}
                      onChange={(v) => updateApp("bootMusicEnabled", v)}
                      isLight={isLight}
                    />

                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Bootup Music</p>
                      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>Plays the first 30 seconds on launch. Upload once, switch anytime.</p>
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
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg border p-1.5 max-w-[560px] mx-auto",
                        isLight ? "bg-white border-[#d5dce8]" : "bg-black/25 border-white/10"
                      )}>
                        <div className={cn(
                          "flex-1 px-3 py-2 rounded-md text-sm border",
                          isLight ? "bg-white text-s-50 border-[#d5dce8]" : "bg-black/20 text-slate-400 border-white/10"
                        )}>
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
                            className={cn(
                              "fx-spotlight-card fx-border-glow transition-colors duration-150",
                              isLight
                                ? "text-s-50 border-[#d5dce8] hover:border-red-400 hover:text-red-600 hover:bg-red-50"
                                : "text-slate-400 border-white/15 hover:border-red-500/40 hover:text-red-300 hover:bg-red-500/10"
                            )}
                          >
                            Remove Selected
                          </Button>
                        </div>
                      )}
                      {bootMusicError && (
                        <p className="text-xs text-red-400 mt-2">{bootMusicError}</p>
                      )}
                    </div>

                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>More Boot Settings</p>
                      <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>
                        Additional bootup options will appear here as they are added.
                      </p>
                    </div>
                  </div>
                )}

                {/* Access Level Section */}
                {activeSection === "access" && (
                  <div className="space-y-5">
                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <p className={cn("text-sm mb-2", isLight ? "text-s-70" : "text-slate-200")}>Session</p>
                      <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                        {authConfigured
                          ? (authAuthenticated ? "Signed in" : "Signed out")
                          : "Auth not configured yet"}
                      </p>
                      <div className="mt-3 flex gap-2">
                        {!authAuthenticated ? (
                          <Button
                            onClick={() => {
                              playClickSound()
                              navigateToLogin()
                            }}
                            disabled={authBusy}
                            size="sm"
                            className="fx-spotlight-card fx-border-glow"
                          >
                            Sign In
                          </Button>
                        ) : (
                          <Button
                            onClick={() => {
                              playClickSound()
                              void handleSignOut()
                            }}
                            disabled={authBusy}
                            variant="outline"
                            size="sm"
                            className="fx-spotlight-card fx-border-glow text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
                          >
                            {authBusy ? "Signing out..." : "Sign Out"}
                          </Button>
                        )}
                      </div>
                      {authError ? (
                        <p className={cn("mt-2 text-xs", authError.startsWith("Reset link sent") ? "text-emerald-300" : "text-rose-300")}>
                          {authError}
                        </p>
                      ) : null}
                    </div>

                    <div className={cn(
                      "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
                      isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center",
                          isLight ? "bg-accent-15 border border-accent-20" : "bg-accent-20 border border-accent-30"
                        )}>
                          <Shield className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                          <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>Account</p>
                          <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                            {authEmail || "No account email found"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2 mb-3">
                        <div className={cn(
                          "flex items-center justify-between rounded-xl border px-3 py-2.5",
                          isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25"
                        )}>
                          <div className="min-w-0">
                            <p className={cn("text-[11px] uppercase tracking-wide", isLight ? "text-s-40" : "text-slate-500")}>Name</p>
                            <p className={cn("truncate text-sm", isLight ? "text-s-70" : "text-slate-200")}>{settings.profile.name || "User"}</p>
                          </div>
                          <User className={cn("w-4 h-4 shrink-0", isLight ? "text-s-40" : "text-slate-500")} />
                        </div>
                        <button
                          onClick={() => {
                            playClickSound()
                            setPendingEmail(authEmail)
                            setEmailModalOpen(true)
                          }}
                          disabled={!authAuthenticated}
                          className={cn(
                            "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors duration-150 disabled:opacity-60",
                            isLight ? "border-[#d5dce8] bg-white hover:bg-[#eef3fb]" : "border-white/10 bg-black/25 hover:bg-white/[0.06]"
                          )}
                        >
                          <div className="min-w-0 text-left">
                            <p className={cn("text-[11px] uppercase tracking-wide", isLight ? "text-s-40" : "text-slate-500")}>Email</p>
                            <p className={cn("truncate text-sm", isLight ? "text-s-70" : "text-slate-200")}>{authEmail || "No account email found"}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Mail className={cn("w-4 h-4", isLight ? "text-s-40" : "text-slate-400")} />
                            <ChevronRight className={cn("w-4 h-4", isLight ? "text-s-40" : "text-slate-400")} />
                          </div>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-2">
                        <button
                          onClick={() => {
                            playClickSound()
                            void handleSendPasswordReset()
                          }}
                          disabled={authBusy || !authAuthenticated}
                          className={cn(
                            "w-full flex items-center justify-center px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
                            isLight
                              ? "bg-white border-[#d5dce8] hover:bg-[#eef3fb] text-s-60"
                              : "bg-black/25 border-white/10 hover:bg-white/[0.06] text-slate-200"
                          )}
                        >
                          Send Password Reset Link
                        </button>
                        <button
                          onClick={() => {
                            playClickSound()
                            setDeletePassword("")
                            setDeleteModalOpen(true)
                          }}
                          disabled={accountBusy || !authAuthenticated}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
                            isLight
                              ? "bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700"
                              : "bg-rose-500/10 border-rose-400/30 hover:bg-rose-500/15 text-rose-300"
                          )}
                        >
                          <Trash2 className="w-4 h-4" />
                          Permanently Delete Account
                        </button>
                        {!authAuthenticated && (
                          <button
                            onClick={() => {
                              playClickSound()
                              navigateToLogin()
                            }}
                            disabled={authBusy}
                            className={cn(
                              "w-full flex items-center justify-center px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
                              isLight
                                ? "bg-white border-[#d5dce8] hover:bg-[#eef3fb] text-s-60"
                                : "bg-black/25 border-white/10 hover:bg-white/[0.06] text-slate-200"
                            )}
                          >
                            Open Sign In
                          </button>
                        )}
                      </div>
                      {accountMessage ? (
                        <p className={cn("mt-2 text-xs", accountMessage.includes("failed") || accountMessage.includes("required") ? "text-rose-300" : "text-emerald-300")}>
                          {accountMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {emailModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className={cn(
            "w-[400px] rounded-2xl border p-4",
            isLight
              ? "border-[#d9e0ea] bg-white/95"
              : "border-white/20 bg-white/[0.06] backdrop-blur-xl"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-white")}>Change account email</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-40" : "text-slate-400")}>
              A confirmation flow will be sent before the new email becomes active.
            </p>
            <label className="mt-4 block">
              <span className={cn("mb-1.5 block text-xs", isLight ? "text-s-40" : "text-slate-400")}>New email</span>
              <input
                type="email"
                value={pendingEmail}
                onChange={(e) => setPendingEmail(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-lg border px-3 text-sm outline-none",
                  isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/12 bg-black/25 text-slate-100"
                )}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEmailModalOpen(false)}
                className={cn(isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/[0.06]")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRequestEmailChange()}
                disabled={accountBusy || !pendingEmail.trim()}
                className="fx-spotlight-card fx-border-glow"
              >
                {accountBusy ? "Submitting..." : "Request Email Change"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={cn(
            "w-[420px] rounded-2xl border p-4",
            isLight
              ? "border-rose-200 bg-white/95"
              : "border-rose-400/35 bg-[#1a0f14]/90 backdrop-blur-xl"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-rose-700" : "text-rose-200")}>Permanent account deletion</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-rose-500" : "text-rose-300")}>
              This deletes your account and user data permanently. Enter your password to continue.
            </p>
            <label className="mt-4 block">
              <span className={cn("mb-1.5 block text-xs", isLight ? "text-rose-500" : "text-rose-300")}>Password confirmation (2FA)</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-lg border px-3 text-sm outline-none",
                  isLight ? "border-rose-200 bg-white text-rose-700" : "border-rose-400/35 bg-black/25 text-rose-100"
                )}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteModalOpen(false)}
                className={cn(isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/[0.06]")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleDeleteAccount()}
                disabled={accountBusy || !deletePassword.trim()}
                className={cn(
                  "border",
                  isLight ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-700" : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border-rose-400/40"
                )}
              >
                {accountBusy ? "Deleting..." : "Delete Account Permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {cropSource && imageSize && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className={cn(
            "w-[360px] rounded-2xl border p-4 backdrop-blur-xl",
            isLight
              ? "border-[#d9e0ea] bg-white/95"
              : "border-white/20 bg-white/[0.06]"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-white")}>Adjust profile photo</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-40" : "text-slate-400")}>Drag to reposition. Use zoom to crop.</p>

            <div className="mt-4 flex justify-center">
              <div
                className={cn(
                  "relative h-[240px] w-[240px] overflow-hidden rounded-full border cursor-grab active:cursor-grabbing",
                  isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25"
                )}
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

// Helper to get card classes based on theme
function getSettingsCardClass(isLight: boolean) {
  return cn(
    "fx-spotlight-card fx-border-glow rounded-xl border transition-all duration-150",
    isLight
      ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
      : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
  )
}

function getSettingsFieldClass(isLight: boolean) {
  return cn(
    "w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:border-accent-50 transition-colors duration-150",
    isLight
      ? "bg-white border-[#d5dce8] text-s-90 placeholder:text-s-25 focus:bg-[#eef3fb]"
      : "bg-black/25 border-white/10 text-slate-100 placeholder:text-slate-500 focus:bg-white/[0.06]"
  )
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  isLight = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  isLight?: boolean
}) {
  const handleChange = (newValue: boolean) => {
    playClickSound()
    onChange(newValue)
  }

  return (
    <div
      className={cn(
        getSettingsCardClass(isLight),
        "group flex items-center justify-between gap-4 p-4 cursor-pointer select-none",
      )}
      onClick={() => handleChange(!checked)}
    >
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm transition-colors", isLight ? "text-s-70 group-hover:text-s-90" : "text-slate-200 group-hover:text-white")}>{label}</p>
        <p className={cn("text-xs mt-0.5", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
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
  isLight = false,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  isLight?: boolean
}) {
  return (
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={getSettingsFieldClass(isLight)}
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
  isLight = false,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  isLight?: boolean
}) {
  return (
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(getSettingsFieldClass(isLight), "resize-none")}
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
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
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
