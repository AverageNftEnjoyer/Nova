import fs from "node:fs";
import path from "node:path";
import { resolveRuntimePaths, unwrapStoredSecret } from "../../providers/runtime.js";
import type { CoinbaseCredentialProvider, CoinbaseCredentials } from "./types.js";

interface ProviderCacheEntry {
  value: CoinbaseCredentials | null;
  cachedAtMs: number;
  mtimeMs: number;
}

export interface FileBackedCredentialProviderOptions {
  workspaceRoot?: string;
  cacheTtlMs?: number;
}

export class FileBackedCoinbaseCredentialProvider implements CoinbaseCredentialProvider {
  private readonly workspaceRoot: string;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, ProviderCacheEntry>();

  constructor(options?: FileBackedCredentialProviderOptions) {
    this.workspaceRoot = path.resolve(options?.workspaceRoot || process.cwd());
    this.cacheTtlMs = Math.max(1_000, Math.floor(Number(options?.cacheTtlMs || 15_000)));
  }

  public async resolve(userContextId: string): Promise<CoinbaseCredentials | null> {
    const normalizedUser = normalizeUserContextId(userContextId);
    if (!normalizedUser) return null;

    const paths = resolveRuntimePaths(this.workspaceRoot);
    const scopedConfigPath = path.join(paths.userContextRoot, normalizedUser, "state", "integrations-config.json");
    const scopedLegacyConfigPath = path.join(paths.userContextRoot, normalizedUser, "integrations-config.json");
    const globalConfigPath = paths.integrationsConfigPath;

    for (const candidatePath of [scopedConfigPath, scopedLegacyConfigPath]) {
      const scopedResult = this.resolveFromPath(normalizedUser, candidatePath, paths.workspaceRoot);
      if (scopedResult) return scopedResult;
    }
    return this.resolveFromPath(normalizedUser, globalConfigPath, paths.workspaceRoot);
  }

  private resolveFromPath(userContextId: string, filePath: string, workspaceRoot: string): CoinbaseCredentials | null {
    const key = `${userContextId}|${filePath}`;
    const now = Date.now();
    const stat = safeStat(filePath);
    const mtimeMs = stat ? Number(stat.mtimeMs || 0) : 0;
    const cached = this.cache.get(key);
    if (cached && now - cached.cachedAtMs < this.cacheTtlMs && cached.mtimeMs === mtimeMs) {
      return cached.value;
    }

    const loaded = loadCoinbaseCredentialsFromConfig(filePath, workspaceRoot);
    this.cache.set(key, {
      value: loaded,
      cachedAtMs: now,
      mtimeMs,
    });
    return loaded;
  }
}

function loadCoinbaseCredentialsFromConfig(filePath: string, workspaceRoot: string): CoinbaseCredentials | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const coinbaseRaw = toRecord(parsed.coinbase);
    const connected = coinbaseRaw.connected === true;
    const apiKey = unwrapStoredSecret(coinbaseRaw.apiKey, resolveRuntimePaths(workspaceRoot));
    const apiSecret = unwrapStoredSecret(coinbaseRaw.apiSecret, resolveRuntimePaths(workspaceRoot));
    if (!apiKey || !apiSecret) {
      return {
        connected: false,
        apiKey: apiKey || "",
        apiSecret: apiSecret || "",
      };
    }
    return {
      connected,
      apiKey,
      apiSecret,
    };
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
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

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
