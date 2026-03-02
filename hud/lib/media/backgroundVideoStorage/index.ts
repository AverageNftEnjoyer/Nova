import { getActiveUserId } from "@/lib/auth/active-user"

const DB_NAME = "nova-assets"
const DB_VERSION = 3
const STORE_NAME = "background-video"
const LEGACY_BACKGROUND_VIDEO_KEY = "custom-background-video"
const ACTIVE_ASSET_ID_KEY = "active-id"
const ASSET_KEY_PREFIX = "asset:"
const REQUIRED_STORES = ["boot-audio", "background-video"] as const
let objectUrlCache: { assetId: string | null; url: string } | null = null
let objectUrlCacheUserId: string | null = null

const IMAGE_FILE_NAME_PATTERN = /\.(png|jpe?g|webp|svg|gif|bmp)$/i
const VIDEO_FILE_NAME_PATTERN = /\.(mp4)$/i

export interface BackgroundVideoAssetMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

interface BackgroundVideoAssetRecord {
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

function getUserScopePrefix(): string {
  const userId = getActiveUserId()
  return userId ? `user:${userId}:` : ""
}

function hasActiveUserScope(): boolean {
  return Boolean(getActiveUserId())
}

function toScopedAssetKey(assetId: string): string {
  return `${getUserScopePrefix()}${ASSET_KEY_PREFIX}${assetId}`
}

function toScopedActiveKey(): string {
  return `${getUserScopePrefix()}${ACTIVE_ASSET_ID_KEY}`
}

function makeAssetId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function requestAsPromise<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"))
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of REQUIRED_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"))
  })
}

async function migrateLegacyBlobIfNeeded(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite")
  const store = tx.objectStore(STORE_NAME)
  const prefix = getUserScopePrefix()
  if (!prefix) return
  const keys = await requestAsPromise<IDBValidKey[]>(store.getAllKeys())
  const scopedAssetPrefix = `${prefix}${ASSET_KEY_PREFIX}`
  const hasAsset = keys.some((k) => typeof k === "string" && k.startsWith(scopedAssetPrefix))
  if (hasAsset) return

  const legacyBlob = (await requestAsPromise<Blob | undefined>(store.get(`${prefix}${LEGACY_BACKGROUND_VIDEO_KEY}`))) ?? null
  if (legacyBlob) {
    const id = makeAssetId()
    const meta: BackgroundVideoAssetMeta = {
      id,
      fileName: "Imported Background Video.mp4",
      mimeType: legacyBlob.type || guessBackgroundMediaMimeType("Imported Background Video.mp4") || "video/mp4",
      sizeBytes: legacyBlob.size,
      createdAt: new Date().toISOString(),
    }
    const record: BackgroundVideoAssetRecord = { meta, blob: legacyBlob }
    await requestAsPromise(store.put(record, toScopedAssetKey(id)))
    await requestAsPromise(store.put(id, toScopedActiveKey()))
    await requestAsPromise(store.delete(`${prefix}${LEGACY_BACKGROUND_VIDEO_KEY}`))
    return
  }

  // One-time migration from legacy unscoped keys to current user's scoped keys.
  const unscopedAssetKeys = keys
    .filter((k): k is string => typeof k === "string" && k.startsWith(ASSET_KEY_PREFIX))
  if (unscopedAssetKeys.length === 0) return

  let migratedAny = false
  for (const key of unscopedAssetKeys) {
    const value = await requestAsPromise<BackgroundVideoAssetRecord | undefined>(store.get(key))
    if (!value?.meta || !(value.blob instanceof Blob)) continue
    await requestAsPromise(store.put(value, `${prefix}${key}`))
    await requestAsPromise(store.delete(key))
    migratedAny = true
  }
  if (!migratedAny) return

  const unscopedActive = await requestAsPromise<string | undefined>(store.get(ACTIVE_ASSET_ID_KEY))
  if (typeof unscopedActive === "string" && unscopedActive) {
    await requestAsPromise(store.put(unscopedActive, toScopedActiveKey()))
    await requestAsPromise(store.delete(ACTIVE_ASSET_ID_KEY))
  }
}

async function readAssetRecords(db: IDBDatabase): Promise<BackgroundVideoAssetRecord[]> {
  const tx = db.transaction(STORE_NAME, "readonly")
  const store = tx.objectStore(STORE_NAME)
  const prefix = getUserScopePrefix()
  if (!prefix) return []
  const scopedAssetPrefix = `${prefix}${ASSET_KEY_PREFIX}`
  const keys = await requestAsPromise<IDBValidKey[]>(store.getAllKeys())
  const records: BackgroundVideoAssetRecord[] = []
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith(scopedAssetPrefix)) continue
    const value = await requestAsPromise<BackgroundVideoAssetRecord | undefined>(store.get(key))
    if (value?.meta && value?.blob instanceof Blob) {
      records.push(value)
    }
  }
  return records.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
}

export async function listBackgroundVideoAssets(): Promise<BackgroundVideoAssetMeta[]> {
  if (!hasActiveUserScope()) return []
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const records = await readAssetRecords(db)
    return records.map((r) => r.meta)
  } finally {
    db.close()
  }
}

export async function getActiveBackgroundVideoAssetId(): Promise<string | null> {
  if (!hasActiveUserScope()) return null
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const active = await requestAsPromise<string | undefined>(store.get(toScopedActiveKey()))
    return typeof active === "string" && active ? active : null
  } finally {
    db.close()
  }
}

export async function setActiveBackgroundVideoAsset(assetId: string | null): Promise<void> {
  if (!hasActiveUserScope()) return
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const activeKey = toScopedActiveKey()
    if (!assetId) {
      await requestAsPromise(store.delete(activeKey))
      return
    }
    await requestAsPromise(store.put(assetId, activeKey))
  } finally {
    db.close()
  }
}

export async function saveBackgroundVideoBlob(blob: Blob, fileName = "Background Video.mp4"): Promise<BackgroundVideoAssetMeta> {
  if (!hasActiveUserScope()) throw new Error("Cannot save background video without an active user session.")
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const id = makeAssetId()
    const meta: BackgroundVideoAssetMeta = {
      id,
      fileName,
      mimeType: blob.type || guessBackgroundMediaMimeType(fileName) || "application/octet-stream",
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
    }
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestAsPromise(store.put({ meta, blob } as BackgroundVideoAssetRecord, toScopedAssetKey(id)))
    await requestAsPromise(store.put(id, toScopedActiveKey()))
    return meta
  } finally {
    db.close()
  }
}

export async function loadBackgroundVideoBlob(assetId?: string | null): Promise<Blob | null> {
  if (!hasActiveUserScope()) return null
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const id = assetId || ((await requestAsPromise<string | undefined>(store.get(toScopedActiveKey()))) ?? null)
    if (!id) return null
    const record = await requestAsPromise<BackgroundVideoAssetRecord | undefined>(store.get(toScopedAssetKey(id)))
    return record?.blob instanceof Blob ? record.blob : null
  } finally {
    db.close()
  }
}

export function getCachedBackgroundVideoObjectUrl(assetId?: string | null): string | null {
  if (!hasActiveUserScope()) return null
  if (!objectUrlCache) return null
  const userId = getActiveUserId() || null
  if (objectUrlCacheUserId !== userId) return null
  if (assetId && objectUrlCache.assetId !== assetId) return null
  return objectUrlCache.url
}

export async function loadBackgroundVideoObjectUrl(assetId?: string | null): Promise<string | null> {
  if (!hasActiveUserScope()) return null
  const userId = getActiveUserId() || null
  if (objectUrlCache && objectUrlCacheUserId === userId && (!assetId || objectUrlCache.assetId === assetId)) {
    return objectUrlCache.url
  }
  const blob = await loadBackgroundVideoBlob(assetId)
  if (!blob) return null
  const nextUrl = URL.createObjectURL(blob)
  if (objectUrlCache?.url) {
    URL.revokeObjectURL(objectUrlCache.url)
  }
  objectUrlCache = { assetId: assetId ?? null, url: nextUrl }
  objectUrlCacheUserId = userId
  return nextUrl
}

export async function removeBackgroundVideoAsset(assetId: string): Promise<void> {
  if (!hasActiveUserScope()) return
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestAsPromise(store.delete(toScopedAssetKey(assetId)))
    const activeKey = toScopedActiveKey()
    const activeId = await requestAsPromise<string | undefined>(store.get(activeKey))
    if (activeId === assetId) {
      await requestAsPromise(store.delete(activeKey))
    }
  } finally {
    db.close()
  }
}

export async function removeBackgroundVideoBlob(): Promise<void> {
  const active = await getActiveBackgroundVideoAssetId()
  if (!active) return
  await removeBackgroundVideoAsset(active)
}
