const DB_NAME = "nova-assets"
const DB_VERSION = 1
const STORE_NAME = "boot-audio"
const BOOT_MUSIC_KEY = "boot-music"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"))
  })
}

export async function saveBootMusicBlob(blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(blob, BOOT_MUSIC_KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error || new Error("Failed to save boot music"))
  })
  db.close()
}

export async function loadBootMusicBlob(): Promise<Blob | null> {
  const db = await openDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(BOOT_MUSIC_KEY)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error || new Error("Failed to load boot music"))
  })
  db.close()
  return blob
}

export async function removeBootMusicBlob(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(BOOT_MUSIC_KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error || new Error("Failed to remove boot music"))
  })
  db.close()
}

