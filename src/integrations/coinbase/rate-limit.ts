import { isRateLimitedCoinbaseError } from "./errors.js";

type Deferred<T> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type QueueJob<T> = {
  execute: () => Promise<T>;
  deferred: Deferred<T>;
};

type UserLane = {
  active: number;
  nextAllowedAtMs: number;
  consecutiveRateLimits: number;
  queue: Array<QueueJob<any>>;
  timer: NodeJS.Timeout | null;
};

export interface CoinbaseRateLimitOptions {
  maxConcurrentPerUser?: number;
  queueLimitPerUser?: number;
  minIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class CoinbaseRateLimitAdapter {
  private readonly lanes = new Map<string, UserLane>();
  private readonly maxConcurrentPerUser: number;
  private readonly queueLimitPerUser: number;
  private readonly minIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options?: CoinbaseRateLimitOptions) {
    this.maxConcurrentPerUser = Math.max(1, Math.floor(Number(options?.maxConcurrentPerUser || 2)));
    this.queueLimitPerUser = Math.max(5, Math.floor(Number(options?.queueLimitPerUser || 64)));
    this.minIntervalMs = Math.max(0, Math.floor(Number(options?.minIntervalMs || 0)));
    this.baseBackoffMs = Math.max(50, Math.floor(Number(options?.baseBackoffMs || 250)));
    this.maxBackoffMs = Math.max(this.baseBackoffMs, Math.floor(Number(options?.maxBackoffMs || 10_000)));
  }

  public async run<T>(userContextId: string, execute: () => Promise<T>): Promise<T> {
    const key = String(userContextId || "").trim();
    if (!key) throw new Error("CoinbaseRateLimitAdapter requires non-empty userContextId.");

    const lane = this.getOrCreateLane(key);
    if (lane.queue.length >= this.queueLimitPerUser) {
      throw new Error(`Coinbase queue overflow for user ${key} (limit=${this.queueLimitPerUser}).`);
    }

    return await new Promise<T>((resolve, reject) => {
      lane.queue.push({ execute, deferred: { resolve, reject } });
      this.drain(key);
    });
  }

  public invalidateUser(userContextId: string): void {
    const key = String(userContextId || "").trim();
    if (!key) return;
    const lane = this.lanes.get(key);
    if (!lane) return;
    if (lane.timer) clearTimeout(lane.timer);
    this.lanes.delete(key);
  }

  private getOrCreateLane(userContextId: string): UserLane {
    const existing = this.lanes.get(userContextId);
    if (existing) return existing;
    const created: UserLane = {
      active: 0,
      nextAllowedAtMs: 0,
      consecutiveRateLimits: 0,
      queue: [],
      timer: null,
    };
    this.lanes.set(userContextId, created);
    return created;
  }

  private drain(userContextId: string): void {
    const lane = this.lanes.get(userContextId);
    if (!lane) return;

    if (lane.timer) {
      clearTimeout(lane.timer);
      lane.timer = null;
    }

    const now = Date.now();
    if (lane.nextAllowedAtMs > now) {
      lane.timer = setTimeout(() => this.drain(userContextId), lane.nextAllowedAtMs - now);
      return;
    }

    while (lane.active < this.maxConcurrentPerUser && lane.queue.length > 0) {
      const job = lane.queue.shift();
      if (!job) break;

      lane.active += 1;
      if (this.minIntervalMs > 0) {
        lane.nextAllowedAtMs = Math.max(lane.nextAllowedAtMs, Date.now() + this.minIntervalMs);
      }

      void job.execute()
        .then((value) => {
          lane.consecutiveRateLimits = 0;
          job.deferred.resolve(value);
        })
        .catch((error: unknown) => {
          if (isRateLimitedCoinbaseError(error)) {
            lane.consecutiveRateLimits += 1;
            const computedBackoff = Math.min(
              this.maxBackoffMs,
              this.baseBackoffMs * 2 ** Math.max(0, lane.consecutiveRateLimits - 1),
            );
            const retryAfterMs = Number(error.retryAfterMs || 0);
            lane.nextAllowedAtMs = Date.now() + Math.max(computedBackoff, retryAfterMs);
          }
          job.deferred.reject(error);
        })
        .finally(() => {
          lane.active = Math.max(0, lane.active - 1);
          this.drain(userContextId);
        });
    }
  }
}
