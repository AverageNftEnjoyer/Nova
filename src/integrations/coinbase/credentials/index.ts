import { getDb } from "../../../db/index.js";
import { resolveRuntimePaths, unwrapStoredSecret } from "../../../providers/runtime/index.js";
import type { CoinbaseCredentialProvider, CoinbaseCredentials } from "../types/index.js";

interface ProviderCacheEntry {
  value: CoinbaseCredentials | null;
  cachedAtMs: number;
}

export interface FileBackedCredentialProviderOptions {
  workspaceRoot?: string;
  cacheTtlMs?: number;
}

/**
 * Compatibility name retained for callers; credentials now come from the SQLite runtime snapshot.
 */
export class FileBackedCoinbaseCredentialProvider implements CoinbaseCredentialProvider {
  private readonly workspaceRoot: string;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, ProviderCacheEntry>();

  constructor(options?: FileBackedCredentialProviderOptions) {
    this.workspaceRoot = options?.workspaceRoot || process.cwd();
    this.cacheTtlMs = Math.max(1_000, Math.floor(Number(options?.cacheTtlMs || 15_000)));
  }

  public async resolve(userContextId: string): Promise<CoinbaseCredentials | null> {
    const uid = normalizeUserContextId(userContextId);
    if (!uid) return null;
    const now = Date.now();
    const cached = this.cache.get(uid);
    if (cached && now - cached.cachedAtMs < this.cacheTtlMs) return cached.value;

    let value: CoinbaseCredentials | null = null;
    try {
      const row = getDb()
        .prepare("SELECT value_json FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
        .get(uid) as { value_json: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.value_json) as Record<string, unknown>;
        const coinbase = toRecord(parsed.coinbase);
        const paths = resolveRuntimePaths(this.workspaceRoot);
        const apiKey = unwrapStoredSecret(coinbase.apiKey, paths);
        const apiSecret = unwrapStoredSecret(coinbase.apiSecret, paths);
        value = {
          connected: coinbase.connected === true && Boolean(apiKey) && Boolean(apiSecret),
          apiKey: apiKey || "",
          apiSecret: apiSecret || "",
        };
      }
    } catch {
      value = null;
    }
    this.cache.set(uid, { value, cachedAtMs: now });
    return value;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}
