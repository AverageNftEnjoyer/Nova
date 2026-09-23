"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { setActiveUserId } from "@/lib/auth/active-user"
import {
  isBlockedAssistantName,
  loadUserSettings,
  MAX_ASSISTANT_NAME_LENGTH,
  saveUserSettings,
  resetSettings,
  type UserSettings,
} from "@/lib/settings/userSettings"
import {
  listBackgroundVideoAssets,
  removeBackgroundVideoAsset,
  saveBackgroundVideoBlob,
  setActiveBackgroundVideoAsset,
  type BackgroundVideoAssetMeta,
} from "@/lib/media/backgroundVideoStorage"
import type { DarkBackgroundType } from "@/lib/settings/userSettings"

const AVATAR_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const BACKGROUND_IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp|gif)$/i
const BACKGROUND_VIDEO_FILE_PATTERN = /\.(mp4)$/i

export type CropOffset = { x: number; y: number }

async function readJsonResponseOrThrow(response: Response, invalidMessage: string): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(invalidMessage)
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(invalidMessage)
  }
}

function responseErrorMessage(data: Record<string, unknown>, fallback: string): string {
  const raw = data.error
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed) return trimmed
  }
  if (raw && typeof raw === "object") {
    const message = String((raw as { message?: unknown }).message || "").trim()
    if (message) return message
  }
  return fallback
}

export function useSettingsState(isOpen: boolean, onClose: () => void) {
  const router = useRouter()

  // Core settings
  const [settings, setSettings] = useState<UserSettings | null>(null)

  // Auth
  const [authConfigured, setAuthConfigured] = useState(false)
  const [authAuthenticated, setAuthAuthenticated] = useState(false)
  const [authEmail, setAuthEmail] = useState("")
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState("")

  // Account modals
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [pendingEmail, setPendingEmail] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountMessage, setAccountMessage] = useState("")

  // Media errors
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [backgroundVideoError, setBackgroundVideoError] = useState<string | null>(null)

  // Media libraries
  const [backgroundVideoAssets, setBackgroundVideoAssets] = useState<BackgroundVideoAssetMeta[]>([])
  const [activeBackgroundVideoAssetId, setActiveBackgroundVideoAssetId] = useState<string | null>(null)

  // Memory editor
  const [memoryMarkdown, setMemoryMarkdown] = useState("")
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySaving, setMemorySaving] = useState(false)
  const [memoryDirty, setMemoryDirty] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memorySavedAt, setMemorySavedAt] = useState<number | null>(null)

  // Avatar crop
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)

  // Workspace sync refs
  const workspaceSyncTimeoutRef = useRef<number | null>(null)
  const lastWorkspaceSyncPayloadRef = useRef<string>("")
  const pendingWorkspaceSyncPayloadRef = useRef<string>("")
  const pendingWorkspaceSyncDataRef = useRef<Record<string, unknown> | null>(null)

  // ─── Workspace sync ───────────────────────────────────────────────────────

  const pushWorkspaceContextSync = useCallback(async (payload: Record<string, unknown>, serialized: string) => {
    // Local-only mode, skip workspace sync
    void payload
    lastWorkspaceSyncPayloadRef.current = serialized
    if (pendingWorkspaceSyncPayloadRef.current === serialized) {
      pendingWorkspaceSyncPayloadRef.current = ""
      pendingWorkspaceSyncDataRef.current = null
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
      interests: nextSettings.personalization.interests,
    }
    const serialized = JSON.stringify(payload)
    if (serialized === lastWorkspaceSyncPayloadRef.current) return
    if (serialized === pendingWorkspaceSyncPayloadRef.current) return
    pendingWorkspaceSyncPayloadRef.current = serialized
    pendingWorkspaceSyncDataRef.current = payload
    if (workspaceSyncTimeoutRef.current !== null) window.clearTimeout(workspaceSyncTimeoutRef.current)
    if (options?.immediate) {
      void pushWorkspaceContextSync(payload, serialized).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to sync workspace context."
        setAuthError(message)
      })
      return
    }
    workspaceSyncTimeoutRef.current = window.setTimeout(async () => {
      workspaceSyncTimeoutRef.current = null
      const nextPayload = pendingWorkspaceSyncDataRef.current
      const nextSerialized = pendingWorkspaceSyncPayloadRef.current
      if (!nextPayload || !nextSerialized) return
      void pushWorkspaceContextSync(nextPayload, nextSerialized).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to sync workspace context."
        setAuthError(message)
      })
    }, 650)
  }, [pushWorkspaceContextSync])

  // ─── Auto-save ────────────────────────────────────────────────────────────

  const autoSave = useCallback((newSettings: UserSettings, options?: { syncWorkspace?: boolean }) => {
    setSettings(newSettings)
    saveUserSettings(newSettings)
    if (options?.syncWorkspace) queueWorkspaceContextSync(newSettings)
  }, [queueWorkspaceContextSync])

  // ─── Media libraries ──────────────────────────────────────────────────────

  const refreshMediaLibraries = useCallback(async () => {
    const assets = await listBackgroundVideoAssets()
    setBackgroundVideoAssets(assets)
    const selectedId = loadUserSettings().app.customBackgroundVideoAssetId ?? null
    setActiveBackgroundVideoAssetId(selectedId && assets.some((a) => a.id === selectedId) ? selectedId : null)
  }, [])

  // ─── Memory ───────────────────────────────────────────────────────────────

  const loadMemoryMarkdown = useCallback(async () => {
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      const res = await fetch("/api/workspace/memory-md", { cache: "no-store" })
      const data = await readJsonResponseOrThrow(res, "Invalid MEMORY.md response payload.")
      if (!res.ok || !data.ok) throw new Error(responseErrorMessage(data, "Failed to load MEMORY.md"))
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
      const data = await readJsonResponseOrThrow(res, "Invalid MEMORY.md save response payload.")
      if (!res.ok || !data.ok) throw new Error(responseErrorMessage(data, "Failed to save MEMORY.md"))
      setMemoryDirty(false)
      setMemorySavedAt(Date.now())
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Failed to save MEMORY.md")
    } finally {
      setMemorySaving(false)
    }
  }, [memoryMarkdown])

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const navigateToLogin = useCallback(() => {
    const nextPath = typeof window !== "undefined" ? window.location.pathname : "/home"
    router.push(`/login?next=${encodeURIComponent(nextPath || "/home")}`)
    onClose()
  }, [onClose, router])

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true)
    setAuthError("")
    try {
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
      throw new Error("Authentication not available in local-only mode.")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to send reset email.")
    } finally {
      setAuthBusy(false)
    }
  }, [])

  const handleRequestEmailChange = useCallback(async () => {
    setAccountBusy(true)
    setAccountMessage("")
    try {
      throw new Error("Authentication not available in local-only mode.")
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to request email change.")
    } finally {
      setAccountBusy(false)
    }
  }, [])

  const handleDeleteAccount = useCallback(async () => {
    setAccountBusy(true)
    setAccountMessage("")
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await readJsonResponseOrThrow(res, "Invalid account deletion response payload.")
      if (!res.ok) throw new Error(responseErrorMessage(data, "Failed to delete local data."))
      setActiveUserId(null)
      navigateToLogin()
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Failed to delete local data.")
    } finally {
      setAccountBusy(false)
    }
  }, [navigateToLogin])

  // ─── Profile updaters ─────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    const fresh = resetSettings()
    setSettings(fresh)
    queueWorkspaceContextSync(fresh, { immediate: true })
  }, [queueWorkspaceContextSync])

  const updateProfile = useCallback((key: string, value: string | null) => {
    if (!settings) return
    const newSettings = { ...settings, profile: { ...settings.profile, [key]: value } }
    autoSave(newSettings, { syncWorkspace: key === "name" })
  }, [settings, autoSave])

  const updateApp = useCallback((key: string, value: boolean | string | null) => {
    if (!settings) return
    const newSettings = { ...settings, app: { ...settings.app, [key]: value } }
    autoSave(newSettings)
  }, [settings, autoSave])

  const updateNotifications = useCallback((key: string, value: boolean) => {
    if (!settings) return
    const newSettings = { ...settings, notifications: { ...settings.notifications, [key]: value } }
    autoSave(newSettings)
  }, [settings, autoSave])

  const updatePersonalization = useCallback((key: string, value: string | string[]) => {
    if (!settings) return
    const nextValue =
      key === "assistantName" && typeof value === "string"
        ? (() => {
            const candidate = value.trim().slice(0, MAX_ASSISTANT_NAME_LENGTH)
            return isBlockedAssistantName(candidate) ? "Nova" : candidate
          })()
        : value
    const newSettings = { ...settings, personalization: { ...settings.personalization, [key]: nextValue } }
    autoSave(newSettings, { syncWorkspace: true })
    if (key === "communicationStyle" || key === "tone") {
      queueWorkspaceContextSync(newSettings, { immediate: true })
    }
  }, [settings, autoSave, queueWorkspaceContextSync])

  // ─── Avatar crop ──────────────────────────────────────────────────────────

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
        if (!ctx) { reject(new Error("Could not process image.")); return }
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

  // ─── Background video ─────────────────────────────────────────────────────

  const handleBackgroundVideoUpload = useCallback(async (file: File) => {
    if (!settings) return
    const normalizedName = file.name.toLowerCase()
    const isVideo = file.type === "video/mp4" || BACKGROUND_VIDEO_FILE_PATTERN.test(normalizedName)
    const isImage = file.type.startsWith("image/") || BACKGROUND_IMAGE_FILE_PATTERN.test(normalizedName)
    if (!isVideo && !isImage) { setBackgroundVideoError("Only MP4, JPG, PNG, WEBP, or GIF files are supported."); return }
    if (isVideo && file.size > 512 * 1024 * 1024) { setBackgroundVideoError("File is too large. Max size is 512MB."); return }
    if (isImage && file.size > 25 * 1024 * 1024) { setBackgroundVideoError("Image is too large. Max size is 25MB."); return }
    setBackgroundVideoError(null)
    // Stored in the data directory (survives closes, updates and origin changes); saving also makes it the active one.
    const saved = await saveBackgroundVideoBlob(file, file.name)
    await refreshMediaLibraries()
    autoSave({
      ...settings,
      app: {
        ...settings.app,
        customBackgroundVideoDataUrl: null,
        customBackgroundVideoFileName: saved.fileName,
        customBackgroundVideoMimeType: saved.mimeType,
        customBackgroundVideoAssetId: saved.id,
        darkModeBackground: "customVideo" as DarkBackgroundType,
      },
    })
  }, [settings, autoSave, refreshMediaLibraries])

  const removeBackgroundVideo = useCallback(async () => {
    if (!settings) return
    const targetId = activeBackgroundVideoAssetId || settings.app.customBackgroundVideoAssetId
    if (!targetId) return
    const remaining = backgroundVideoAssets.filter((a) => a.id !== targetId)
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
        darkModeBackground: (
          settings.app.darkModeBackground === "customVideo" && !nextActive
            ? "black"
            : settings.app.darkModeBackground
        ) as DarkBackgroundType,
      },
    }
    autoSave(newSettings)
    setBackgroundVideoError(null)
  }, [settings, autoSave, activeBackgroundVideoAssetId, backgroundVideoAssets, refreshMediaLibraries])

  const selectBackgroundVideoAsset = useCallback((assetId: string | null) => {
    if (!settings) return
    const selected = assetId ? backgroundVideoAssets.find((a) => a.id === assetId) ?? null : null
    void setActiveBackgroundVideoAsset(selected?.id ?? null).catch(() => {})
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        customBackgroundVideoDataUrl: null,
        customBackgroundVideoFileName: selected?.fileName ?? null,
        customBackgroundVideoMimeType: selected?.mimeType ?? null,
        customBackgroundVideoAssetId: selected?.id ?? null,
        darkModeBackground: (
          selected
            ? "customVideo"
            : settings.app.darkModeBackground === "customVideo"
              ? "black"
              : settings.app.darkModeBackground
        ) as DarkBackgroundType,
      },
    }
    autoSave(newSettings)
  }, [settings, backgroundVideoAssets, autoSave])

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    if (isOpen) {
      setSettings(loadUserSettings())
      setAuthConfigured(true)
      setAccountMessage("")
      // Local-only mode - no authentication
      setAuthAuthenticated(false)
      setAuthEmail("")
      void refreshMediaLibraries().catch(() => {
        if (cancelled) return
        setBackgroundVideoAssets([])
        setActiveBackgroundVideoAssetId(null)
      })
      void loadMemoryMarkdown()
    }
    return () => { cancelled = true }
  }, [isOpen, loadMemoryMarkdown, refreshMediaLibraries])

  useEffect(() => {
    return () => {
      if (workspaceSyncTimeoutRef.current !== null) window.clearTimeout(workspaceSyncTimeoutRef.current)
      workspaceSyncTimeoutRef.current = null
      const pendingPayload = pendingWorkspaceSyncDataRef.current
      const pendingSerialized = pendingWorkspaceSyncPayloadRef.current
      if (pendingPayload && pendingSerialized) {
        void pushWorkspaceContextSync(pendingPayload, pendingSerialized).catch((error) => {
          const message = error instanceof Error ? error.message : "Failed to sync workspace context."
          setAuthError(message)
        })
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
      void pushWorkspaceContextSync(pendingPayload, pendingSerialized).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to sync workspace context."
        setAuthError(message)
      })
    }
  }, [isOpen, pushWorkspaceContextSync])

  return {
    // Settings
    settings, setSettings,
    handleReset,
    updateProfile, updateApp, updateNotifications, updatePersonalization,
    // Auth
    authConfigured, authAuthenticated, authEmail, authBusy, authError,
    navigateToLogin, handleSignOut, handleSendPasswordReset,
    // Account modals
    emailModalOpen, setEmailModalOpen,
    deleteModalOpen, setDeleteModalOpen,
    pendingEmail, setPendingEmail,
    deletePassword, setDeletePassword,
    accountBusy, accountMessage,
    handleRequestEmailChange, handleDeleteAccount,
    // Media errors
    avatarError, setAvatarError,
    backgroundVideoError, setBackgroundVideoError,
    // Media libraries
    backgroundVideoAssets, activeBackgroundVideoAssetId,
    handleBackgroundVideoUpload, removeBackgroundVideo, selectBackgroundVideoAsset,
    // Memory
    memoryMarkdown, setMemoryMarkdown,
    memoryLoading, memorySaving, memoryDirty, setMemoryDirty,
    memoryError, memorySavedAt, setMemorySavedAt,
    loadMemoryMarkdown, saveMemoryMarkdown,
    // Avatar crop
    cropSource, setCropSource,
    cropZoom, setCropZoom,
    cropOffset, setCropOffset,
    imageSize, setImageSize,
    dragStart, setDragStart,
    getBaseScale, clampOffset,
    handleAvatarUpload, saveCroppedAvatar,
    CROP_FRAME: 240,
  }
}

