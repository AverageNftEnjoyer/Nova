interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
  insertedAtMs: number;
}

export class MemoryTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = Math.max(50, Number(options?.maxEntries || 1000));
  }

  public get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  public set(key: string, value: T, ttlMs: number): void {
    const safeTtl = Math.max(1, Math.floor(Number(ttlMs) || 0));
    const now = Date.now();
    this.entries.set(key, {
      value,
      insertedAtMs: now,
      expiresAtMs: now + safeTtl,
    });
    this.evictIfNeeded();
  }

  public invalidate(key: string): void {
    this.entries.delete(key);
  }

  public invalidatePrefix(prefix: string): void {
    if (!prefix) return;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public sweepExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const overflow = this.entries.size - this.maxEntries;
    // Deterministic eviction order: oldest first by insertion timestamp.
    const oldest = [...this.entries.entries()]
      .sort((a, b) => a[1].insertedAtMs - b[1].insertedAtMs)
      .slice(0, overflow);
    for (const [key] of oldest) this.entries.delete(key);
  }
}

