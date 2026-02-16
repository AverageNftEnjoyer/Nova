import { getActiveUserId } from "@/lib/active-user"

const DB_NAME = "nova-assets"
const DB_VERSION = 3
const STORE_NAME = "boot-audio"
const LEGACY_BOOT_MUSIC_KEY = "boot-music"
const ACTIVE_ASSET_ID_KEY = "active-id"
const ASSET_KEY_PREFIX = "asset:"
const REQUIRED_STORES = ["boot-audio", "background-video"] as const

export interface BootMusicAssetMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

interface BootMusicAssetRecord {
  meta: BootMusicAssetMeta
  blob: Blob
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

  const legacyBlob = (await requestAsPromise<Blob | undefined>(store.get(`${prefix}${LEGACY_BOOT_MUSIC_KEY}`))) ?? null
  if (legacyBlob) {
    const id = makeAssetId()
    const meta: BootMusicAssetMeta = {
      id,
      fileName: "Imported Boot Music.mp3",
      mimeType: legacyBlob.type || "audio/mpeg",
      sizeBytes: legacyBlob.size,
      createdAt: new Date().toISOString(),
    }
    const record: BootMusicAssetRecord = { meta, blob: legacyBlob }
    await requestAsPromise(store.put(record, toScopedAssetKey(id)))
    await requestAsPromise(store.put(id, toScopedActiveKey()))
    await requestAsPromise(store.delete(`${prefix}${LEGACY_BOOT_MUSIC_KEY}`))
    return
  }

  // One-time migration from legacy unscoped keys to current user's scoped keys.
  const unscopedAssetKeys = keys
    .filter((k): k is string => typeof k === "string" && k.startsWith(ASSET_KEY_PREFIX))
  if (unscopedAssetKeys.length === 0) return

  let migratedAny = false
  for (const key of unscopedAssetKeys) {
    const value = await requestAsPromise<BootMusicAssetRecord | undefined>(store.get(key))
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

async function readAssetRecords(db: IDBDatabase): Promise<BootMusicAssetRecord[]> {
  const tx = db.transaction(STORE_NAME, "readonly")
  const store = tx.objectStore(STORE_NAME)
  const prefix = getUserScopePrefix()
  if (!prefix) return []
  const scopedAssetPrefix = `${prefix}${ASSET_KEY_PREFIX}`
  const keys = await requestAsPromise<IDBValidKey[]>(store.getAllKeys())
  const records: BootMusicAssetRecord[] = []
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith(scopedAssetPrefix)) continue
    const value = await requestAsPromise<BootMusicAssetRecord | undefined>(store.get(key))
    if (value?.meta && value?.blob instanceof Blob) {
      records.push(value)
    }
  }
  return records.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
}

export async function listBootMusicAssets(): Promise<BootMusicAssetMeta[]> {
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

export async function getActiveBootMusicAssetId(): Promise<string | null> {
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

export async function setActiveBootMusicAsset(assetId: string | null): Promise<void> {
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

export async function saveBootMusicBlob(blob: Blob, fileName = "Boot Music.mp3"): Promise<BootMusicAssetMeta> {
  if (!hasActiveUserScope()) throw new Error("Cannot save boot music without an active user session.")
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const id = makeAssetId()
    const meta: BootMusicAssetMeta = {
      id,
      fileName,
      mimeType: blob.type || "audio/mpeg",
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
    }
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestAsPromise(store.put({ meta, blob } as BootMusicAssetRecord, toScopedAssetKey(id)))
    await requestAsPromise(store.put(id, toScopedActiveKey()))
    return meta
  } finally {
    db.close()
  }
}

export async function loadBootMusicBlob(assetId?: string | null): Promise<Blob | null> {
  if (!hasActiveUserScope()) return null
  const db = await openDb()
  try {
    await migrateLegacyBlobIfNeeded(db)
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const id = assetId || ((await requestAsPromise<string | undefined>(store.get(toScopedActiveKey()))) ?? null)
    if (!id) return null
    const record = await requestAsPromise<BootMusicAssetRecord | undefined>(store.get(toScopedAssetKey(id)))
    return record?.blob instanceof Blob ? record.blob : null
  } finally {
    db.close()
  }
}

export async function removeBootMusicAsset(assetId: string): Promise<void> {
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

export async function removeBootMusicBlob(): Promise<void> {
  const active = await getActiveBootMusicAssetId()
  if (!active) return
  await removeBootMusicAsset(active)
}
