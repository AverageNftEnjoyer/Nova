import { getActiveUserId } from "@/lib/auth/active-user"
import { loadUserSettings, saveUserSettings } from "@/lib/settings/userSettings"

// Custom background media lives in the app's data directory (server side, see src/media/background-assets.js), not
// in the browser: IndexedDB belongs to the window's origin, which is not part of backup/restore and can change.
// The exported functions keep their historical names; they now talk to /api/media/background.

const API_BASE = "/api/media/background"
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
const CHUNK_RETRIES = 3

const LEGACY_DB_NAME = "nova-assets"
const LEGACY_STORE_NAME = "background-video"
const LEGACY_ACTIVE_ASSET_ID_KEY = "active-id"
const LEGACY_ASSET_KEY_PREFIX = "asset:"

let urlCache: { assetId: string; url: string } | null = null
let urlCacheUserId: string | null = null

const IMAGE_FILE_NAME_PATTERN = /\.(png|jpe?g|webp|svg|gif|bmp)$/i
const VIDEO_FILE_NAME_PATTERN = /\.(mp4)$/i

export interface BackgroundVideoAssetMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

interface BackgroundAssetListResponse {
  ok?: boolean
  error?: string
  assets?: BackgroundVideoAssetMeta[]
  activeId?: string | null
}

interface LegacyAssetRecord {
  meta: BackgroundVideoAssetMeta
  blob: Blob
}

export function guessBackgroundMediaMimeType(fileName?: string | null): string | null {
  const normalized = String(fileName || "").trim().toLowerCase()
  if (!normalized) return null
  if (normalized.endsWith(".png")) return "image/png"
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg"
  if (normalized.endsWith(".webp")) return "image/webp"
  if (normalized.endsWith(".svg")) return "image/svg+xml"
  if (normalized.endsWith(".gif")) return "image/gif"
  if (normalized.endsWith(".bmp")) return "image/bmp"
  if (normalized.endsWith(".mp4")) return "video/mp4"
  return null
}

export function isBackgroundAssetImage(mimeType?: string | null, fileName?: string | null): boolean {
  const mime = String(mimeType || "").trim().toLowerCase()
  if (mime.startsWith("image/")) return true
  if (mime.startsWith("video/")) return false
  const normalizedName = String(fileName || "").trim().toLowerCase()
  if (!normalizedName) return false
  if (IMAGE_FILE_NAME_PATTERN.test(normalizedName)) return true
  if (VIDEO_FILE_NAME_PATTERN.test(normalizedName)) return false
  return false
}

function hasActiveUserScope(): boolean {
  return Boolean(getActiveUserId())
}

/** Streaming URL for an asset: supports HTTP Range, stable across reloads. */
export function getBackgroundAssetUrl(assetId: string): string {
  return `${API_BASE}/${encodeURIComponent(assetId)}`
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown }
    if (typeof data.error === "string" && data.error) return data.error
  } catch {
    // not JSON
  }
  return fallback
}

async function fetchList(): Promise<{ assets: BackgroundVideoAssetMeta[]; activeId: string | null }> {
  const res = await fetch(API_BASE, { cache: "no-store" })
  if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load backgrounds."))
  const data = (await res.json()) as BackgroundAssetListResponse
  return {
    assets: Array.isArray(data.assets) ? data.assets : [],
    activeId: typeof data.activeId === "string" && data.activeId ? data.activeId : null,
  }
}

function rememberUrl(assetId: string): string {
  const url = getBackgroundAssetUrl(assetId)
  urlCache = { assetId, url }
  urlCacheUserId = getActiveUserId() || null
  return url
}

function forgetUrl(assetId?: string): void {
  if (!urlCache) return
  if (!assetId || urlCache.assetId === assetId) {
    urlCache = null
    urlCacheUserId = null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------------------------

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
}

function withExtension(fileName: string, mimeType: string): string {
  if (/\.(png|jpe?g|webp|gif|mp4)$/i.test(fileName)) return fileName
  const ext = MIME_EXTENSIONS[mimeType.toLowerCase()]
  return ext ? `${fileName}${ext}` : fileName
}

async function putChunk(uploadId: string, offset: number, chunk: Blob): Promise<void> {
  let lastError: Error = new Error("Upload failed.")
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}/uploads/${encodeURIComponent(uploadId)}?offset=${offset}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      })
      if (res.ok) return
      const message = await readErrorMessage(res, "Upload failed.")
      // A 4xx will not improve by retrying (bad type, too large, offset mismatch).
      if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(message), { fatal: true })
      lastError = new Error(message)
    } catch (error) {
      if (error instanceof Error && (error as Error & { fatal?: boolean }).fatal) throw error
      lastError = error instanceof Error ? error : new Error("Upload failed.")
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
  }
  throw lastError
}

async function uploadBlob(
  blob: Blob,
  fileName: string,
  options: { legacyId?: string; activate: boolean },
): Promise<BackgroundVideoAssetMeta> {
  const beginRes = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, sizeBytes: blob.size, ...(options.legacyId ? { legacyId: options.legacyId } : {}) }),
  })
  if (!beginRes.ok) throw new Error(await readErrorMessage(beginRes, "Could not start the upload."))
  const begun = (await beginRes.json()) as { uploadId?: string; chunkBytes?: number; existing?: BackgroundVideoAssetMeta }
  if (begun.existing) return begun.existing
  const uploadId = begun.uploadId
  if (!uploadId) throw new Error("Could not start the upload.")
  const chunkBytes = Math.min(UPLOAD_CHUNK_BYTES, begun.chunkBytes || UPLOAD_CHUNK_BYTES)

  try {
    for (let offset = 0; offset < blob.size; offset += chunkBytes) {
      await putChunk(uploadId, offset, blob.slice(offset, Math.min(offset + chunkBytes, blob.size)))
    }
    const finishRes = await fetch(`${API_BASE}/uploads/${encodeURIComponent(uploadId)}${options.activate ? "" : "?activate=0"}`, {
      method: "POST",
    })
    if (!finishRes.ok) throw new Error(await readErrorMessage(finishRes, "Could not finish the upload."))
    const finished = (await finishRes.json()) as { asset?: BackgroundVideoAssetMeta }
    if (!finished.asset) throw new Error("Could not finish the upload.")
    return finished.asset
  } catch (error) {
    await fetch(`${API_BASE}/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => undefined)
    throw error
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One-time migration from the legacy browser-side IndexedDB copy
// ---------------------------------------------------------------------------------------------------------------

const migrations = new Map<string, Promise<void>>()
/** legacy id -> server id, for callers that still hold a pre-migration id for the rest of this page load. */
const legacyIdMap = new Map<string, string>()

function requestAsPromise<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"))
  })
}

function openLegacyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // No version: never create or upgrade anything. A database that did not exist is created empty and removed below.
    const request = indexedDB.open(LEGACY_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"))
    request.onblocked = () => reject(new Error("IndexedDB is blocked"))
  })
}

function deleteLegacyDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(LEGACY_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

function isLegacyRecord(value: unknown): value is LegacyAssetRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<LegacyAssetRecord>
  return (
    record.blob instanceof Blob &&
    !!record.meta &&
    typeof record.meta.id === "string" &&
    typeof record.meta.fileName === "string"
  )
}

async function migrateLegacyAssets(userId: string): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return
  const db = await openLegacyDb()
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
      db.close()
      await deleteLegacyDb()
      return
    }
    const userPrefix = `user:${userId}:`
    const assetPrefix = `${userPrefix}${LEGACY_ASSET_KEY_PREFIX}`
    const keys = (await requestAsPromise<IDBValidKey[]>(
      db.transaction(LEGACY_STORE_NAME, "readonly").objectStore(LEGACY_STORE_NAME).getAllKeys(),
    )).filter((key): key is string => typeof key === "string")
    const activeLegacyId = await requestAsPromise<unknown>(
      db.transaction(LEGACY_STORE_NAME, "readonly").objectStore(LEGACY_STORE_NAME).get(`${userPrefix}${LEGACY_ACTIVE_ASSET_ID_KEY}`),
    )

    const records: { key: string; record: LegacyAssetRecord }[] = []
    for (const key of keys.filter((k) => k.startsWith(assetPrefix))) {
      const value = await requestAsPromise<unknown>(db.transaction(LEGACY_STORE_NAME, "readonly").objectStore(LEGACY_STORE_NAME).get(key))
      if (isLegacyRecord(value)) records.push({ key, record: value })
    }
    records.sort((a, b) => String(a.record.meta.createdAt).localeCompare(String(b.record.meta.createdAt)))

    let networkFailed = false
    for (const { key, record } of records) {
      try {
        const migrated = await uploadBlob(
          record.blob,
          withExtension(record.meta.fileName, record.blob.type || record.meta.mimeType || ""),
          { legacyId: record.meta.id, activate: false },
        )
        legacyIdMap.set(record.meta.id, migrated.id)
        await requestAsPromise(db.transaction(LEGACY_STORE_NAME, "readwrite").objectStore(LEGACY_STORE_NAME).delete(key))
      } catch (error) {
        // Unsupported type (svg/bmp), too large or too many: keep the legacy copy, carry on with the rest.
        // A failed request (server down) stops the run; the next launch tries again.
        if (error instanceof TypeError) {
          networkFailed = true
          break
        }
      }
    }
    if (networkFailed) return

    const activeNewId = typeof activeLegacyId === "string" ? legacyIdMap.get(activeLegacyId) : undefined
    if (activeNewId) {
      const { activeId } = await fetchList()
      if (!activeId) {
        await fetch(API_BASE, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeId: activeNewId }),
        })
      }
      await requestAsPromise(
        db.transaction(LEGACY_STORE_NAME, "readwrite").objectStore(LEGACY_STORE_NAME).delete(`${userPrefix}${LEGACY_ACTIVE_ASSET_ID_KEY}`),
      )
    }

    // Point the saved settings at the new ids (the legacy ids no longer exist anywhere).
    const settings = loadUserSettings()
    const selected = settings.app.customBackgroundVideoAssetId
    const remapped = selected ? legacyIdMap.get(selected) : undefined
    if (remapped) {
      saveUserSettings({ ...settings, app: { ...settings.app, customBackgroundVideoAssetId: remapped } })
    }

    // Drop the whole legacy database once no background asset (any user) is left in it. This also discards the
    // retired boot-audio store, which nothing reads any more.
    const remaining = (await requestAsPromise<IDBValidKey[]>(
      db.transaction(LEGACY_STORE_NAME, "readonly").objectStore(LEGACY_STORE_NAME).getAllKeys(),
    )).filter((key) => typeof key === "string" && key.includes(`:${LEGACY_ASSET_KEY_PREFIX}`))
    if (remaining.length === 0) {
      db.close()
      await deleteLegacyDb()
    }
  } finally {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
}

/** Runs the legacy import once per user per page load. Never throws: an unavailable/corrupt IndexedDB is not an error. */
function ensureLegacyMigration(): Promise<void> {
  const userId = getActiveUserId()
  if (!userId) return Promise.resolve()
  let pending = migrations.get(userId)
  if (!pending) {
    pending = migrateLegacyAssets(userId).catch(() => undefined)
    migrations.set(userId, pending)
  }
  return pending
}

function resolveAssetId(assetId?: string | null): string | null {
  if (!assetId) return null
  return legacyIdMap.get(assetId) ?? assetId
}

// ---------------------------------------------------------------------------------------------------------------
// Public API (unchanged signatures)
// ---------------------------------------------------------------------------------------------------------------

export async function listBackgroundVideoAssets(): Promise<BackgroundVideoAssetMeta[]> {
  if (!hasActiveUserScope()) return []
  await ensureLegacyMigration()
  return (await fetchList()).assets
}

export async function getActiveBackgroundVideoAssetId(): Promise<string | null> {
  if (!hasActiveUserScope()) return null
  await ensureLegacyMigration()
  return (await fetchList()).activeId
}

export async function setActiveBackgroundVideoAsset(assetId: string | null): Promise<void> {
  if (!hasActiveUserScope()) return
  await ensureLegacyMigration()
  const res = await fetch(API_BASE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeId: resolveAssetId(assetId) }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the background."))
}

export async function saveBackgroundVideoBlob(blob: Blob, fileName = "Background Video.mp4"): Promise<BackgroundVideoAssetMeta> {
  if (!hasActiveUserScope()) throw new Error("Cannot save background video without an active user session.")
  await ensureLegacyMigration()
  const meta = await uploadBlob(blob, withExtension(fileName, blob.type), { activate: true })
  rememberUrl(meta.id)
  return meta
}

export async function loadBackgroundVideoBlob(assetId?: string | null): Promise<Blob | null> {
  if (!hasActiveUserScope()) return null
  await ensureLegacyMigration()
  const id = resolveAssetId(assetId) ?? (await fetchList()).activeId
  if (!id) return null
  const res = await fetch(getBackgroundAssetUrl(id))
  if (!res.ok) return null
  return res.blob()
}

/** Streaming URL of an asset already confirmed to exist in this session, else null (see loadBackgroundVideoObjectUrl). */
export function getCachedBackgroundVideoObjectUrl(assetId?: string | null): string | null {
  if (!hasActiveUserScope()) return null
  if (!urlCache) return null
  const userId = getActiveUserId() || null
  if (urlCacheUserId !== userId) return null
  const wanted = resolveAssetId(assetId)
  if (wanted && urlCache.assetId !== wanted) return null
  return urlCache.url
}

/**
 * Confirms the asset (or the active one) exists on the server and returns its streaming URL, or null when there is
 * none. The name is historical: the URL is served by the API with Range support, not a blob object URL.
 */
export async function loadBackgroundVideoObjectUrl(assetId?: string | null): Promise<string | null> {
  if (!hasActiveUserScope()) return null
  const cached = getCachedBackgroundVideoObjectUrl(assetId)
  if (cached) return cached
  await ensureLegacyMigration()
  const { assets, activeId } = await fetchList()
  const target = resolveAssetId(assetId) ?? activeId
  if (!target || !assets.some((asset) => asset.id === target)) return null
  return rememberUrl(target)
}

export async function removeBackgroundVideoAsset(assetId: string): Promise<void> {
  if (!hasActiveUserScope()) return
  await ensureLegacyMigration()
  const id = resolveAssetId(assetId) ?? assetId
  const res = await fetch(getBackgroundAssetUrl(id), { method: "DELETE" })
  if (!res.ok && res.status !== 404) throw new Error(await readErrorMessage(res, "Failed to delete the background."))
  forgetUrl(id)
}

export async function removeBackgroundVideoBlob(): Promise<void> {
  const active = await getActiveBackgroundVideoAssetId()
  if (!active) return
  await removeBackgroundVideoAsset(active)
}
