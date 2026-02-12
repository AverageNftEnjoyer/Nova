const DB_NAME = "nova-assets"
const DB_VERSION = 3
const STORE_NAME = "background-video"
const LEGACY_BACKGROUND_VIDEO_KEY = "custom-background-video"
const ACTIVE_ASSET_ID_KEY = "active-id"
const ASSET_KEY_PREFIX = "asset:"
const REQUIRED_STORES = ["boot-audio", "background-video"] as const
let objectUrlCache: { assetId: string | null; url: string } | null = null

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
  const keys = await requestAsPromise<IDBValidKey[]>(store.getAllKeys())
  const hasAsset = keys.some((k) => typeof k === "string" && k.startsWith(ASSET_KEY_PREFIX))
  if (hasAsset) return

  const legacyBlob = (await requestAsPromise<Blob | undefined>(store.get(LEGACY_BACKGROUND_VIDEO_KEY))) ?? null
  if (!legacyBlob) return

  const id = makeAssetId()
  const meta: BackgroundVideoAssetMeta = {
    id,
    fileName: "Imported Background Video.mp4",
    mimeType: legacyBlob.type || "video/mp4",
    sizeBytes: legacyBlob.size,
    createdAt: new Date().toISOString(),
  }
  const record: BackgroundVideoAssetRecord = { meta, blob: legacyBlob }
  await requestAsPromise(store.put(record, `${ASSET_KEY_PREFIX}${id}`))
  await requestAsPromise(store.put(id, ACTIVE_ASSET_ID_KEY))
  await requestAsPromise(store.delete(LEGACY_BACKGROUND_VIDEO_KEY))
}

async function readAssetRecords(db: IDBDatabase): Promise<BackgroundVideoAssetRecord[]> {
  const tx = db.transaction(STORE_NAME, "readonly")
  const store = tx.objectStore(STORE_NAME)
  const keys = await requestAsPromise<IDBValidKey[]>(store.getAllKeys())
  const records: BackgroundVideoAssetRecord[] = []
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith(ASSET_KEY_PREFIX)) continue
    const value = await requestAsPromise<BackgroundVideoAssetRecord | undefined>(store.get(key))
    if (value?.meta && value?.blob instanceof Blob) {
      records.push(value)
    }
  }
  return records.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
}

export async function listBackgroundVideoAssets(): Promise<BackgroundVideoAssetMeta[]> {
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
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const active = await requestAsPromise<string | undefined>(store.get(ACTIVE_ASSET_ID_KEY))
    return typeof active === "string" && active ? active : null
  } finally {
    db.close()
  }
}

export async function setActiveBackgroundVideoAsset(assetId: string | null): Promise<void> {
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    if (!assetId) {
      await requestAsPromise(store.delete(ACTIVE_ASSET_ID_KEY))
      return
    }
    await requestAsPromise(store.put(assetId, ACTIVE_ASSET_ID_KEY))
  } finally {
    db.close()
  }
}

export async function saveBackgroundVideoBlob(blob: Blob, fileName = "Background Video.mp4"): Promise<BackgroundVideoAssetMeta> {
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const id = makeAssetId()
    const meta: BackgroundVideoAssetMeta = {
      id,
      fileName,
      mimeType: blob.type || "video/mp4",
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
    }
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestAsPromise(store.put({ meta, blob } as BackgroundVideoAssetRecord, `${ASSET_KEY_PREFIX}${id}`))
    await requestAsPromise(store.put(id, ACTIVE_ASSET_ID_KEY))
    return meta
  } finally {
    db.close()
  }
}

export async function loadBackgroundVideoBlob(assetId?: string | null): Promise<Blob | null> {
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const id = assetId || ((await requestAsPromise<string | undefined>(store.get(ACTIVE_ASSET_ID_KEY))) ?? null)
    if (!id) return null
    const record = await requestAsPromise<BackgroundVideoAssetRecord | undefined>(store.get(`${ASSET_KEY_PREFIX}${id}`))
    return record?.blob instanceof Blob ? record.blob : null
  } finally {
    db.close()
  }
}

export function getCachedBackgroundVideoObjectUrl(assetId?: string | null): string | null {
  if (!objectUrlCache) return null
  if (assetId && objectUrlCache.assetId !== assetId) return null
  return objectUrlCache.url
}

export async function loadBackgroundVideoObjectUrl(assetId?: string | null): Promise<string | null> {
  if (objectUrlCache && (!assetId || objectUrlCache.assetId === assetId)) {
    return objectUrlCache.url
  }
  const blob = await loadBackgroundVideoBlob(assetId)
  if (!blob) return null
  const nextUrl = URL.createObjectURL(blob)
  if (objectUrlCache?.url) {
    URL.revokeObjectURL(objectUrlCache.url)
  }
  objectUrlCache = { assetId: assetId ?? null, url: nextUrl }
  return nextUrl
}

export async function removeBackgroundVideoAsset(assetId: string): Promise<void> {
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestAsPromise(store.delete(`${ASSET_KEY_PREFIX}${assetId}`))
    const activeId = await requestAsPromise<string | undefined>(store.get(ACTIVE_ASSET_ID_KEY))
    if (activeId === assetId) {
      await requestAsPromise(store.delete(ACTIVE_ASSET_ID_KEY))
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
