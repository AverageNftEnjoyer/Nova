export interface LruCacheEntry<T> {
  value: T
  expiresAt: number
}

export interface CreateLruCacheOptions {
  maxEntries?: number
}

export class PolymarketLruCache<T> {
  private readonly maxEntries: number
  private readonly store = new Map<string, LruCacheEntry<T>>()

  constructor(options: CreateLruCacheOptions = {}) {
    const maxEntries = Number(options.maxEntries ?? 500)
    this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 500
  }

  get size(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  delete(key: string): boolean {
    return this.store.delete(key)
  }

  get(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    // Promote to most-recently-used.
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): T {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return value
    }
    if (this.store.has(key)) {
      this.store.delete(key)
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + Math.floor(ttlMs),
    })
    this.evictIfNeeded()
    return value
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value
      if (!oldestKey) break
      this.store.delete(oldestKey)
    }
  }
}

type GlobalPolymarketCacheState = typeof globalThis & {
  __novaPolymarketCacheRegistry?: Map<string, PolymarketLruCache<unknown>>
}

export function getGlobalPolymarketLruCache<T>(id: string, options: CreateLruCacheOptions = {}): PolymarketLruCache<T> {
  const state = globalThis as GlobalPolymarketCacheState
  if (!state.__novaPolymarketCacheRegistry) {
    state.__novaPolymarketCacheRegistry = new Map<string, PolymarketLruCache<unknown>>()
  }
  const existing = state.__novaPolymarketCacheRegistry.get(id)
  if (existing) return existing as PolymarketLruCache<T>
  const next = new PolymarketLruCache<T>(options)
  state.__novaPolymarketCacheRegistry.set(id, next as PolymarketLruCache<unknown>)
  return next
}

